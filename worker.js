// ══════════════════════════════════════════════
//  Hikma Worker — KV + GitHub Archive
//  KV: HIKMA_KV
//  keys: "students"  → JSON array
//        "teachers"  → JSON array
//        "blacklist" → JSON array
//  Secrets: GH_TOKEN
//  Cron: every Sunday 22:00 UTC (01:00 Iraq)
// ══════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const GH_REPO  = "setwann/hikma";
const GH_FILE  = "archive-data.json";
const GH_BRANCH = "main";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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

// ── GitHub: دۆزینەوەی SHA ی فایلی ئێسستا ──
async function getGHFileSHA(env) {
  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, "User-Agent": "hikma-worker" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  return data.sha || null;
}

// ── GitHub: نووسینەوەی فایلی ئەرشیف ──
async function writeArchiveToGH(env, content) {
  const sha = await getGHFileSHA(env);
  const body = {
    message: `archive: ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha; // نوێکردنەوە — پێویستی بە SHA هەیە

  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`,
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
    throw new Error(`GitHub PUT failed: ${res.status} — ${err.message || ""}`);
  }
}

// ── GitHub: خوێندنەوەی فایلی ئەرشیف ──
async function readArchiveFromGH(env) {
  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, "User-Agent": "hikma-worker" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
  return JSON.parse(decoded);
}

// ══════════════════════════════════════════════
//  ئەرشیفکردنی هەفتانە
// ══════════════════════════════════════════════
async function runWeeklyArchive(env) {
  const students  = (await getKV(env, "students"))  || [];
  const teachers  = (await getKV(env, "teachers"))  || [];
  const blacklist = (await getKV(env, "blacklist")) || [];

  const archive = {
    archivedAt: new Date().toISOString(),
    students,
    teachers,
    blacklist,
  };

  // ١. بنووسە بۆ GitHub
  await writeArchiveToGH(env, archive);

  // ٢. KV بەتاڵ بکەوە
  await deleteKV(env, "students");
  await deleteKV(env, "teachers");
  await deleteKV(env, "blacklist");
}

// ══════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════
export default {

  // ── Cron Trigger: هەر یەکشەممە ٢٢:٠٠ UTC ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWeeklyArchive(env));
  },

  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    try {

      // ── GET /api/data ── هەموو داتا (KV)
      if (method === "GET" && path === "/api/data") {
        const teachers = (await getKV(env, "teachers")) || [];
        const students  = (await getKV(env, "students"))  || [];
        return json({ teachers, students });
      }

      // ── GET /api/archive ── خوێندنەوەی ئەرشیف لە GitHub
      if (method === "GET" && path === "/api/archive") {
        const archive = await readArchiveFromGH(env);
        if (!archive) return json({ archive: null });
        return json({ archive });
      }

      // ── POST /api/restore ── گەڕاندنەوەی داتا لە ئەرشیف بۆ KV
      if (method === "POST" && path === "/api/restore") {
        const archive = await readArchiveFromGH(env);
        if (!archive) return json({ error: "ئەرشیف نەدۆزرایەوە" }, 404);

        await putKV(env, "students",  archive.students  || []);
        await putKV(env, "teachers",  archive.teachers  || []);
        await putKV(env, "blacklist", archive.blacklist || []);
        return json({ ok: true, restoredAt: archive.archivedAt });
      }

      // POST /api/student
      if (method === "POST" && path === "/api/student") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const students = (await getKV(env, "students")) || [];
        if (students.some(s => s.fullName === fullName))
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
          grades: {}, attendance: [], culturalNotes: [], behavioralNotes: [],
        };

        students.push(newStudent);
        await putKV(env, "students", students);
        return json({ ok: true });
      }

      // PUT /api/student
      if (method === "PUT" && path === "/api/student") {
        const body = await request.json();
        if (!body.fullName) return json({ error: "ناو پێویستە" }, 400);

        const students = (await getKV(env, "students")) || [];
        const idx = students.findIndex(s => s.fullName === body.fullName);
        if (idx === -1) return json({ error: "قوتابی نەدۆزرایەوە" }, 404);

        students[idx] = { ...students[idx], ...body };
        await putKV(env, "students", students);
        return json({ ok: true });
      }

      // DELETE /api/student
      if (method === "DELETE" && path === "/api/student") {
        const { fullName } = await request.json();
        if (!fullName) return json({ error: "ناو پێویستە" }, 400);

        let students = (await getKV(env, "students")) || [];
        const before = students.length;
        students = students.filter(s => s.fullName !== fullName);
        if (students.length === before)
          return json({ error: "قوتابی نەدۆزرایەوە" }, 404);

        const teachers = (await getKV(env, "teachers")) || [];
        const updatedTeachers = teachers.map(t => ({
          ...t,
          students: (t.students || []).filter(s => s.fullName !== fullName),
        }));

        const blacklist = (await getKV(env, "blacklist")) || [];
        const updatedBlacklist = blacklist.filter(b => b.studentName !== fullName);

        await putKV(env, "students", students);
        await putKV(env, "teachers", updatedTeachers);
        await putKV(env, "blacklist", updatedBlacklist);
        return json({ ok: true });
      }

      // POST /api/teacher
      if (method === "POST" && path === "/api/teacher") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const teachers = (await getKV(env, "teachers")) || [];
        if (teachers.some(t => t.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newTeacher = {
          fullName, phone,
          address: body.address || "", job: body.job || "",
          ijaza: body.ijaza || "نەخێر", ijazaDetail: body.ijazaDetail || "",
          subjects: body.subjects || [], assignedClasses: body.assignedClasses || [],
          students: [],
        };

        teachers.push(newTeacher);
        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // PUT /api/teacher
      if (method === "PUT" && path === "/api/teacher") {
        const body = await request.json();
        if (!body.fullName) return json({ error: "ناو پێویستە" }, 400);

        const teachers = (await getKV(env, "teachers")) || [];
        const idx = teachers.findIndex(t => t.fullName === body.fullName);
        if (idx === -1) return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);

        teachers[idx] = { ...teachers[idx], ...body };
        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // DELETE /api/teacher
      if (method === "DELETE" && path === "/api/teacher") {
        const { fullName } = await request.json();
        if (!fullName) return json({ error: "ناو پێویستە" }, 400);

        let teachers = (await getKV(env, "teachers")) || [];
        const before = teachers.length;
        teachers = teachers.filter(t => t.fullName !== fullName);
        if (teachers.length === before)
          return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);

        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // POST /api/accept
      if (method === "POST" && path === "/api/accept") {
        const { teacherName, studentName, subject } = await request.json();
        if (!teacherName || !studentName)
          return json({ error: "زانیاری ناتەواو" }, 400);

        const teachers = (await getKV(env, "teachers")) || [];
        const idx = teachers.findIndex(t => t.fullName === teacherName);
        if (idx === -1) return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);

        const already = (teachers[idx].students || []).some(
          s => s.fullName === studentName && ((s.subject || "") === (subject || ""))
        );
        if (already) return json({ error: "قوتابی پێشتر بۆ ئەم بەشە قبووڵکراوە" }, 409);

        teachers[idx].students = [
          ...(teachers[idx].students || []),
          { fullName: studentName, subject: subject || "", acceptedAt: new Date().toISOString() },
        ];

        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // POST /api/transfer
      if (method === "POST" && path === "/api/transfer") {
        const { fromTeacher, toTeacher, studentName, subject } = await request.json();
        if (!fromTeacher || !toTeacher || !studentName)
          return json({ error: "زانیاری ناتەواو" }, 400);

        const norm = v => (v == null ? "" : String(v).trim());
        const subj = norm(subject);

        const teachers = (await getKV(env, "teachers")) || [];
        const fromIdx = teachers.findIndex(t => t.fullName === fromTeacher);
        const toIdx   = teachers.findIndex(t => t.fullName === toTeacher);
        if (fromIdx === -1) return json({ error: "مامۆستای کۆن نەدۆزرایەوە" }, 404);
        if (toIdx   === -1) return json({ error: "مامۆستای نوێ نەدۆزرایەوە" }, 404);

        let entry = (teachers[fromIdx].students || []).find(
          s => s.fullName === studentName && norm(s.subject) === subj
        );
        if (!entry && subj === "") {
          entry = (teachers[fromIdx].students || []).find(s => s.fullName === studentName);
        }
        if (!entry) return json({ error: "قوتابی لای ئەم مامۆستایە نەدۆزرایەوە" }, 404);

        const entrySubj = norm(entry.subject);

        teachers[fromIdx].students = (teachers[fromIdx].students || []).filter(
          s => !(s.fullName === studentName && norm(s.subject) === entrySubj)
        );

        const alreadyAt = (teachers[toIdx].students || []).some(
          s => s.fullName === studentName && norm(s.subject) === entrySubj
        );
        if (!alreadyAt) {
          teachers[toIdx].students = [
            ...(teachers[toIdx].students || []),
            { fullName: studentName, subject: entry.subject || "", acceptedAt: new Date().toISOString() },
          ];
        }

        const students = (await getKV(env, "students")) || [];
        const sIdx = students.findIndex(s => s.fullName === studentName);
        if (sIdx !== -1) {
          const s = norm(entry.subject);
          if (s === "quran")        students[sIdx].teacherQuran     = toTeacher;
          else if (s === "tajweed") students[sIdx].teacherTajweed   = toTeacher;
          else if (s === "edu")     students[sIdx].teacherEducation = toTeacher;
          else {
            if ((students[sIdx].teacherQuran     || "") === fromTeacher) students[sIdx].teacherQuran     = toTeacher;
            if ((students[sIdx].teacherEducation || "") === fromTeacher) students[sIdx].teacherEducation = toTeacher;
            if ((students[sIdx].teacherTajweed   || "") === fromTeacher) students[sIdx].teacherTajweed   = toTeacher;
          }
          await putKV(env, "students", students);
        }

        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // GET /api/blacklist
      if (method === "GET" && path === "/api/blacklist") {
        const blacklist = (await getKV(env, "blacklist")) || [];
        return json({ blacklist });
      }

      // POST /api/blacklist
      if (method === "POST" && path === "/api/blacklist") {
        const { studentName, reason, addedBy } = await request.json();
        if (!studentName) return json({ error: "ناوی قوتابی پێویستە" }, 400);

        const blacklist = (await getKV(env, "blacklist")) || [];
        if (blacklist.some(b => b.studentName === studentName))
          return json({ error: "قوتابی پێشتر لە لیستی ڕەشدایە" }, 409);

        blacklist.push({
          studentName,
          reason: reason || "",
          addedBy: addedBy || "",
          addedAt: new Date().toISOString(),
        });
        await putKV(env, "blacklist", blacklist);
        return json({ ok: true });
      }

      // DELETE /api/blacklist
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

      // POST /api/seed
      if (method === "POST" && path === "/api/seed") {
        const body = await request.json();
        const existing = await getKV(env, "students");
        if (existing && existing.length > 0)
          return json({ error: "داتا پێشتر هەیە، seed نادرێت" }, 409);

        if (body.students) await putKV(env, "students", body.students);
        if (body.teachers) await putKV(env, "teachers", body.teachers);
        return json({ ok: true, seeded: true });
      }

      return json({ error: "نەدۆزرایەوە" }, 404);

    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
