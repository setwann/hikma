// ══════════════════════════════════════════════
//  Hikma Worker — GitHub Primary + KV for attendance/grades
//  GitHub files:
//    students.json   → لیستی قوتابیان (سەرەکی)
//    teachers.json   → لیستی مامۆستایان (سەرەکی)
//    archive-data.json → غیابات، نمرە، blacklist (هەفتانە)
//  KV keys:
//    "attendance"  → { studentName: [...logs] }
//    "grades"      → { studentName: { subj: {q1,q2,final} } }
//    "blacklist"   → JSON array
//    "lastLesson"  → { studentName: { quran, tajweed, edu } }
//    "notes"       → { studentName: [...notes] }
//  Secrets: GH_TOKEN
//  Cron: every Sunday 22:00 UTC
// ══════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const GH_REPO   = "setwann/hikma";
const GH_BRANCH = "main";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── KV helpers ──
async function getKV(env, key) {
  const val = await env.HIKMA_KV.get(key);
  return val ? JSON.parse(val) : null;
}
async function putKV(env, key, data) {
  await env.HIKMA_KV.put(key, JSON.stringify(data));
}
async function deleteKV(env, key) {
  await env.HIKMA_KV.delete(key);
}

// ── GitHub: خوێندنەوەی فایل (raw — بەبێ تۆکین بۆ public ریپۆ) ──
async function ghRead(env, filename) {
  // خوێندنەوە لە raw بەبێ تۆکین (ریپۆ public ە)
  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${filename}`,
    { headers: { "User-Agent": "hikma-worker" } }
  );
  if (rawRes.status === 404) return null;
  if (!rawRes.ok) throw new Error(`GitHub GET ${filename} failed: ${rawRes.status}`);
  const data = JSON.parse(await rawRes.text());
  // SHA بۆ نووسینەوە پێویستە — لە API بخوێنەوە (بە تۆکین ئەگەر هەبوو)
  const apiHeaders = { "User-Agent": "hikma-worker" };
  if (env.GH_TOKEN) apiHeaders["Authorization"] = `Bearer ${env.GH_TOKEN}`;
  const apiRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${filename}?ref=${GH_BRANCH}`,
    { headers: apiHeaders }
  );
  const sha = apiRes.ok ? (await apiRes.json()).sha : null;
  return { data, sha };
}

// ── GitHub: نووسینەوەی فایل ──
async function ghWrite(env, filename, content, sha) {
  const body = {
    message: `update: ${filename} ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${filename}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "hikma-worker",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${filename} failed: ${res.status} — ${err.message || ""}`);
  }
  const result = await res.json();
  return result.content?.sha || null;
}

// ── students.json helpers ──
async function readStudents(env) {
  const r = await ghRead(env, "students.json");
  return r ? { list: r.data, sha: r.sha } : { list: [], sha: null };
}

async function writeStudents(env, list, sha) {
  return ghWrite(env, "students.json", list, sha);
}

// ── teachers.json helpers ──
async function readTeachers(env) {
  const r = await ghRead(env, "teachers.json");
  return r ? { list: r.data, sha: r.sha } : { list: [], sha: null };
}

async function writeTeachers(env, list, sha) {
  return ghWrite(env, "teachers.json", list, sha);
}

// ══════════════════════════════════════════════
//  ئەرشیفکردنی هەفتانە (KV → archive-data.json)
//  قوتابی و مامۆستا دەست نادات
// ══════════════════════════════════════════════
async function runWeeklyArchive(env) {
  const attendance = (await getKV(env, "attendance")) || {};
  const grades     = (await getKV(env, "grades"))     || {};
  const blacklist  = (await getKV(env, "blacklist"))  || [];
  const lastLesson = (await getKV(env, "lastLesson")) || {};
  const notes      = (await getKV(env, "notes"))      || {};

  const existing = await ghRead(env, "archive-data.json");
  const sha = existing ? existing.sha : null;

  const archive = {
    archivedAt: new Date().toISOString(),
    attendance,
    grades,
    blacklist,
    lastLesson,
    notes,
  };

  await ghWrite(env, "archive-data.json", archive, sha);

  // KV بەتاڵ بکەوە
  await deleteKV(env, "attendance");
  await deleteKV(env, "grades");
  await deleteKV(env, "blacklist");
  await deleteKV(env, "lastLesson");
  await deleteKV(env, "notes");
}

// ══════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════
export default {

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWeeklyArchive(env));
  },

  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    try {

      // ── GET /api/data ── هەموو داتا لە GitHub
      if (method === "GET" && path === "/api/data") {
        const [studentsRes, teachersRes] = await Promise.all([
          readStudents(env),
          readTeachers(env),
        ]);
        return json({ students: studentsRes.list, teachers: teachersRes.list });
      }

      // ── POST /api/student ── زیادکردن بۆ students.json
      if (method === "POST" && path === "/api/student") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const { list, sha } = await readStudents(env);
        if (list.some(s => s.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newStudent = {
          fullName, phone,
          age: body.age || "", fatherJob: body.fatherJob || "",
          financialStatus: body.financialStatus || "", neighborhood: body.neighborhood || "",
          landmark: body.landmark || "", illness: body.illness || "نیەتی",
          illnessDetail: body.illnessDetail || "", educationLevel: body.educationLevel || "",
          studentLevel: body.studentLevel || "", memorization: body.memorization || [],
          teacherQuran: body.teacherQuran || "", teacherEducation: body.teacherEducation || "",
          teacherTajweed: body.teacherTajweed || "", notes: body.notes || "",
          birthYear: "", classGroup: "", parentName: "",
        };

        list.push(newStudent);
        await writeStudents(env, list, sha);
        return json({ ok: true });
      }

      // ── PUT /api/student ── نوێکردنەوە لە students.json
      if (method === "PUT" && path === "/api/student") {
        const body = await request.json();
        if (!body.fullName) return json({ error: "ناو پێویستە" }, 400);

        // فیلدە KV-یەکان جیا بکەرەوە
        const { attendance, grades, lastLesson, culturalNotes, behavioralNotes, ...studentFields } = body;

        // students.json نوێ بکەوە
        const { list, sha } = await readStudents(env);
        const idx = list.findIndex(s => s.fullName === body.fullName);
        if (idx === -1) return json({ error: "قوتابی نەدۆزرایەوە" }, 404);
        list[idx] = { ...list[idx], ...studentFields };
        await writeStudents(env, list, sha);

        // ئەگەر غیابات هاتن، KV نوێ بکەوە
        if (attendance !== undefined) {
          const allAtt = (await getKV(env, "attendance")) || {};
          allAtt[body.fullName] = attendance;
          await putKV(env, "attendance", allAtt);
        }
        // ئەگەر نمرەکان هاتن
        if (grades !== undefined) {
          const allGrades = (await getKV(env, "grades")) || {};
          allGrades[body.fullName] = grades;
          await putKV(env, "grades", allGrades);
        }
        // ئەگەر درسەکان هاتن
        if (lastLesson !== undefined) {
          const allLessons = (await getKV(env, "lastLesson")) || {};
          allLessons[body.fullName] = lastLesson;
          await putKV(env, "lastLesson", allLessons);
        }
        // ئەگەر تێبینییەکان هاتن
        const newNotes = [...(culturalNotes || []), ...(behavioralNotes || [])];
        if (newNotes.length > 0) {
          const allNotes = (await getKV(env, "notes")) || {};
          allNotes[body.fullName] = newNotes;
          await putKV(env, "notes", allNotes);
        }

        return json({ ok: true });
      }

      // ── DELETE /api/student ──
      if (method === "DELETE" && path === "/api/student") {
        const { fullName } = await request.json();
        if (!fullName) return json({ error: "ناو پێویستە" }, 400);

        const { list, sha } = await readStudents(env);
        const filtered = list.filter(s => s.fullName !== fullName);
        if (filtered.length === list.length)
          return json({ error: "قوتابی نەدۆزرایەوە" }, 404);
        await writeStudents(env, filtered, sha);

        // KV پاک بکەوە
        const allAtt  = (await getKV(env, "attendance"))  || {};
        const allGr   = (await getKV(env, "grades"))      || {};
        const allLes  = (await getKV(env, "lastLesson"))  || {};
        const allNotes= (await getKV(env, "notes"))        || {};
        delete allAtt[fullName]; delete allGr[fullName];
        delete allLes[fullName]; delete allNotes[fullName];
        await putKV(env, "attendance", allAtt);
        await putKV(env, "grades",     allGr);
        await putKV(env, "lastLesson", allLes);
        await putKV(env, "notes",      allNotes);

        // teachers.json نوێ بکەوە
        const { list: tList, sha: tSha } = await readTeachers(env);
        const updatedTeachers = tList.map(t => ({
          ...t,
          students: (t.students || []).filter(s => s.fullName !== fullName),
        }));
        await writeTeachers(env, updatedTeachers, tSha);

        // blacklist
        const bl = (await getKV(env, "blacklist")) || [];
        await putKV(env, "blacklist", bl.filter(b => b.studentName !== fullName));

        return json({ ok: true });
      }

      // ── POST /api/teacher ── زیادکردن بۆ teachers.json
      if (method === "POST" && path === "/api/teacher") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const { list, sha } = await readTeachers(env);
        if (list.some(t => t.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newTeacher = {
          fullName, phone,
          address: body.address || "", job: body.job || "",
          ijaza: body.ijaza || "نەخێر", ijazaDetail: body.ijazaDetail || "",
          subjects: body.subjects || [], assignedClasses: body.assignedClasses || [],
          students: [],
        };

        list.push(newTeacher);
        await writeTeachers(env, list, sha);
        return json({ ok: true });
      }

      // ── PUT /api/teacher ──
      if (method === "PUT" && path === "/api/teacher") {
        const body = await request.json();
        if (!body.fullName) return json({ error: "ناو پێویستە" }, 400);

        const { list, sha } = await readTeachers(env);
        const idx = list.findIndex(t => t.fullName === body.fullName);
        if (idx === -1) return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);
        list[idx] = { ...list[idx], ...body };
        await writeTeachers(env, list, sha);
        return json({ ok: true });
      }

      // ── DELETE /api/teacher ──
      if (method === "DELETE" && path === "/api/teacher") {
        const { fullName } = await request.json();
        if (!fullName) return json({ error: "ناو پێویستە" }, 400);

        const { list, sha } = await readTeachers(env);
        const filtered = list.filter(t => t.fullName !== fullName);
        if (filtered.length === list.length)
          return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);
        await writeTeachers(env, filtered, sha);
        return json({ ok: true });
      }

      // ── POST /api/accept ──
      if (method === "POST" && path === "/api/accept") {
        const { teacherName, studentName, subject } = await request.json();
        if (!teacherName || !studentName)
          return json({ error: "زانیاری ناتەواو" }, 400);

        const { list, sha } = await readTeachers(env);
        const idx = list.findIndex(t => t.fullName === teacherName);
        if (idx === -1) return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);

        const already = (list[idx].students || []).some(
          s => s.fullName === studentName && ((s.subject || "") === (subject || ""))
        );
        if (already) return json({ error: "قوتابی پێشتر بۆ ئەم بەشە قبووڵکراوە" }, 409);

        list[idx].students = [
          ...(list[idx].students || []),
          { fullName: studentName, subject: subject || "", acceptedAt: new Date().toISOString() },
        ];
        await writeTeachers(env, list, sha);
        return json({ ok: true });
      }

      // ── POST /api/transfer ──
      if (method === "POST" && path === "/api/transfer") {
        const { fromTeacher, toTeacher, studentName, subject } = await request.json();
        if (!fromTeacher || !toTeacher || !studentName)
          return json({ error: "زانیاری ناتەواو" }, 400);

        const norm = v => (v == null ? "" : String(v).trim());
        const subj = norm(subject);

        const { list, sha } = await readTeachers(env);
        const fromIdx = list.findIndex(t => t.fullName === fromTeacher);
        const toIdx   = list.findIndex(t => t.fullName === toTeacher);
        if (fromIdx === -1) return json({ error: "مامۆستای کۆن نەدۆزرایەوە" }, 404);
        if (toIdx   === -1) return json({ error: "مامۆستای نوێ نەدۆزرایەوە" }, 404);

        let entry = (list[fromIdx].students || []).find(
          s => s.fullName === studentName && norm(s.subject) === subj
        );
        if (!entry && subj === "") {
          entry = (list[fromIdx].students || []).find(s => s.fullName === studentName);
        }
        if (!entry) return json({ error: "قوتابی لای ئەم مامۆستایە نەدۆزرایەوە" }, 404);

        const entrySubj = norm(entry.subject);
        list[fromIdx].students = (list[fromIdx].students || []).filter(
          s => !(s.fullName === studentName && norm(s.subject) === entrySubj)
        );

        const alreadyAt = (list[toIdx].students || []).some(
          s => s.fullName === studentName && norm(s.subject) === entrySubj
        );
        if (!alreadyAt) {
          list[toIdx].students = [
            ...(list[toIdx].students || []),
            { fullName: studentName, subject: entry.subject || "", acceptedAt: new Date().toISOString() },
          ];
        }
        await writeTeachers(env, list, sha);

        // students.json: فیلدی مامۆستا نوێ بکەوە
        const { list: sList, sha: sSha } = await readStudents(env);
        const sIdx = sList.findIndex(s => s.fullName === studentName);
        if (sIdx !== -1) {
          const s = norm(entry.subject);
          if (s === "quran")        sList[sIdx].teacherQuran     = toTeacher;
          else if (s === "tajweed") sList[sIdx].teacherTajweed   = toTeacher;
          else if (s === "edu")     sList[sIdx].teacherEducation = toTeacher;
          else {
            if ((sList[sIdx].teacherQuran     || "") === fromTeacher) sList[sIdx].teacherQuran     = toTeacher;
            if ((sList[sIdx].teacherEducation || "") === fromTeacher) sList[sIdx].teacherEducation = toTeacher;
            if ((sList[sIdx].teacherTajweed   || "") === fromTeacher) sList[sIdx].teacherTajweed   = toTeacher;
          }
          await writeStudents(env, sList, sSha);
        }

        return json({ ok: true });
      }

      // ── GET /api/blacklist ──
      if (method === "GET" && path === "/api/blacklist") {
        const blacklist = (await getKV(env, "blacklist")) || [];
        return json({ blacklist });
      }

      // ── POST /api/blacklist ──
      if (method === "POST" && path === "/api/blacklist") {
        const { studentName, reason, addedBy } = await request.json();
        if (!studentName) return json({ error: "ناوی قوتابی پێویستە" }, 400);

        const blacklist = (await getKV(env, "blacklist")) || [];
        if (blacklist.some(b => b.studentName === studentName))
          return json({ error: "قوتابی پێشتر لە لیستی ڕەشدایە" }, 409);

        blacklist.push({
          studentName, reason: reason || "",
          addedBy: addedBy || "", addedAt: new Date().toISOString(),
        });
        await putKV(env, "blacklist", blacklist);
        return json({ ok: true });
      }

      // ── DELETE /api/blacklist ──
      if (method === "DELETE" && path === "/api/blacklist") {
        const { studentName } = await request.json();
        if (!studentName) return json({ error: "ناوی قوتابی پێویستە" }, 400);

        let blacklist = (await getKV(env, "blacklist")) || [];
        const before = blacklist.length;
        blacklist = blacklist.filter(b => b.studentName !== studentName);
        if (blacklist.length === before)
          return json({ error: "قوتابی لە لیستی ڕەش نەدۆزرایەوە" }, 404);

        await putKV(env, "blacklist", blacklist);
        return json({ ok: true });
      }

      // ── GET /api/student-detail ── خوێندنەوەی داتای KV بۆ قوتابی
      if (method === "GET" && path === "/api/student-detail") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "ناو پێویستە" }, 400);

        const allAtt    = (await getKV(env, "attendance"))  || {};
        const allGrades = (await getKV(env, "grades"))      || {};
        const allLes    = (await getKV(env, "lastLesson"))  || {};
        const allNotes  = (await getKV(env, "notes"))        || {};

        return json({
          attendance:     allAtt[name]    || [],
          grades:         allGrades[name] || {},
          lastLesson:     allLes[name]    || null,
          culturalNotes:  (allNotes[name] || []).filter(n => n.category !== "negative"),
          behavioralNotes:(allNotes[name] || []).filter(n => n.category === "negative"),
        });
      }

      return json({ error: "نەدۆزرایەوە" }, 404);

    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};