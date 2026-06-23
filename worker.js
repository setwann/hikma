// ══════════════════════════════════════════════
//  Hikma Worker — KV Only (بێ GitHub)
//  KV: HIKMA_KV
//  keys: "students"  → JSON array
//        "teachers"  → JSON array
// ══════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

// ══════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    try {

      // ── GET /api/data ── هەموو داتا
      if (method === "GET" && path === "/api/data") {
        const teachers = (await getKV(env, "teachers")) || [];
        const students  = (await getKV(env, "students"))  || [];
        return json({ teachers, students });
      }

      // POST /api/student - زیادکردنی قوتابی نوێ
      if (method === "POST" && path === "/api/student") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const students = (await getKV(env, "students")) || [];
        if (students.some(s => s.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newStudent = {
          fullName,
          phone,
          age:              body.age              || "",
          fatherJob:        body.fatherJob        || "",
          financialStatus:  body.financialStatus  || "",
          neighborhood:     body.neighborhood     || "",
          landmark:         body.landmark         || "",
          illness:          body.illness          || "نیەتی",
          illnessDetail:    body.illnessDetail    || "",
          educationLevel:   body.educationLevel   || "",
          studentLevel:     body.studentLevel     || "",
          memorization:     body.memorization     || [],
          teacherQuran:     body.teacherQuran     || "",
          teacherEducation: body.teacherEducation || "",
          teacherTajweed:   body.teacherTajweed   || "",
          notes:            body.notes            || "",
          birthYear: "", classGroup: "", parentName: "",
          grades: {}, attendance: [], culturalNotes: [], behavioralNotes: [],
        };

        students.push(newStudent);
        await putKV(env, "students", students);
        return json({ ok: true });
      }

      // ── PUT /api/student ── نووسینەوەی زانیارییەکانی قوتابی
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

      // ── DELETE /api/student ── سڕینەوەی قوتابی
      if (method === "DELETE" && path === "/api/student") {
        const { fullName } = await request.json();
        if (!fullName) return json({ error: "ناو پێویستە" }, 400);

        let students = (await getKV(env, "students")) || [];
        const before = students.length;
        students = students.filter(s => s.fullName !== fullName);
        if (students.length === before)
          return json({ error: "قوتابی نەدۆزرایەوە" }, 404);

        // لە مامۆستاکانیشەوە دەسڕێتەوە
        const teachers = (await getKV(env, "teachers")) || [];
        const updatedTeachers = teachers.map(t => ({
          ...t,
          students: (t.students || []).filter(s => s.fullName !== fullName),
        }));

        await putKV(env, "students", students);
        await putKV(env, "teachers", updatedTeachers);
        return json({ ok: true });
      }

      // ── POST /api/teacher ── زیادکردنی مامۆستای نوێ
      if (method === "POST" && path === "/api/teacher") {
        const body = await request.json();
        const { fullName, phone } = body;
        if (!fullName || !phone)
          return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const teachers = (await getKV(env, "teachers")) || [];
        if (teachers.some(t => t.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newTeacher = {
          fullName,
          phone,
          address:         body.address         || "",
          job:             body.job             || "",
          ijaza:           body.ijaza           || "نەخێر",
          ijazaDetail:     body.ijazaDetail     || "",
          subjects:        body.subjects        || [],
          assignedClasses: body.assignedClasses || [],
          students:        [],
        };

        teachers.push(newTeacher);
        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // ── PUT /api/teacher ── نووسینەوەی زانیارییەکانی مامۆستا
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

      // ── DELETE /api/teacher ── سڕینەوەی مامۆستا
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

      // ── POST /api/accept ── قبووڵکردنی قوتابی لە لایەن مامۆستا
      if (method === "POST" && path === "/api/accept") {
        const { teacherName, studentName } = await request.json();
        if (!teacherName || !studentName)
          return json({ error: "زانیاری ناتەواو" }, 400);

        const teachers = (await getKV(env, "teachers")) || [];
        const idx = teachers.findIndex(t => t.fullName === teacherName);
        if (idx === -1) return json({ error: "مامۆستا نەدۆزرایەوە" }, 404);

        const already = (teachers[idx].students || []).some(s => s.fullName === studentName);
        if (already) return json({ error: "قوتابی پێشتر قبووڵکراوە" }, 409);

        teachers[idx].students = [
          ...(teachers[idx].students || []),
          { fullName: studentName, acceptedAt: new Date().toISOString() },
        ];

        await putKV(env, "teachers", teachers);
        return json({ ok: true });
      }

      // ── POST /api/seed ── بارکردنی داتای سەرەتایی (تەنها یەک جار)
      if (method === "POST" && path === "/api/seed") {
        const body = await request.json();
        // دڵنیابوون لەوەی KV بەتاڵە پێش نووسین
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
