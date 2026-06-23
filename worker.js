// ══════════════════════════════════════════════
//  Hikma Worker
//  KV: HIKMA_KV
//  Secret: GH_TOKEN
// ══════════════════════════════════════════════

const GH_OWNER  = "setwann";
const GH_REPO   = "hikma";
const GH_BRANCH = "main";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

// GitHub لە خوێندنەوەی ئاساسی
async function ghGet(env, path) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github.raw+json",
      "User-Agent": "hikma-worker",
    },
  });
  if (!r.ok) throw new Error(`ghGet ${path}: ${r.status}`);
  return r.json();
}

async function ghPut(env, path, content) {
  const metaUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const headers = {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "hikma-worker",
  };
  const meta = await fetch(metaUrl, { headers });
  if (!meta.ok) throw new Error(`ghPut meta: ${meta.status}`);
  const { sha } = await meta.json();

  const res = await fetch(metaUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `update ${path}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      sha,
      branch: GH_BRANCH,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `ghPut ${path}: ${res.status}`);
  }
  return res.json();
}

// بارکردنی داتا — پێشتر KV چەک دەکات
async function loadData(env) {
  let teachers = await getKV(env, "teachers");
  let students  = await getKV(env, "students");

  if (!teachers || !students) {
    [teachers, students] = await Promise.all([
      ghGet(env, "teachers.json"),
      ghGet(env, "students.json"),
    ]);
    await putKV(env, "teachers", teachers);
    await putKV(env, "students", students);
  }
  return { teachers, students };
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
      // GET /api/data — هەموو داتا
      if (method === "GET" && path === "/api/data") {
        const data = await loadData(env);
        return json(data);
      }

      // POST /api/student — زیادکردنی قوتابی نوێ
      if (method === "POST" && path === "/api/student") {
        const { fullName, phone } = await request.json();
        if (!fullName || !phone) return json({ error: "ناو و تەلەفۆن پێویستن" }, 400);

        const { students } = await loadData(env);
        if (students.some(s => s.fullName === fullName))
          return json({ error: "ئەم ناوە پێشتر تۆمارکراوە" }, 409);

        const newStudent = {
          fullName, phone,
          birthYear: "", classGroup: "", parentName: "",
          grades: {}, attendance: [], culturalNotes: [], behavioralNotes: [],
        };
        const updated = [...students, newStudent];
        await ghPut(env, "students.json", updated);
        await putKV(env, "students", updated);
        return json({ ok: true });
      }

      // POST /api/accept — قبووڵکردنی قوتابی
      if (method === "POST" && path === "/api/accept") {
        const { teacherName, studentName } = await request.json();
        if (!teacherName || !studentName) return json({ error: "زانیاری ناتەواو" }, 400);

        const { teachers } = await loadData(env);
        const updated = teachers.map(t => {
          if (t.fullName !== teacherName) return t;
          const students = t.students || [];
          if (students.some(s => s.fullName === studentName)) return t;
          return { ...t, students: [...students, { fullName: studentName, acceptedAt: new Date().toISOString() }] };
        });
        await ghPut(env, "teachers.json", updated);
        await putKV(env, "teachers", updated);
        return json({ ok: true });
      }

      return json({ error: "نەدۆزرایەوە" }, 404);

    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
