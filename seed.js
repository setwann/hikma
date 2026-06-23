// ══════════════════════════════════════════════
//  seed.js — داتای سەرەتایی بنێرە بۆ KV
//  بەکارهێنان:  node seed.js
// ══════════════════════════════════════════════

const WORKER = "https://hikma.myrampro.workers.dev"; // ← URLی workerەکەت

const students = [
  {
    "fullName": "کامەران علی حسەن",
    "phone": "07701234567",
    "birthYear": "2012",
    "classGroup": "Class-5A",
    "parentName": "علی حسەن مەحموود",
    "grades": {
      "Kurdish":        { "q1": 88, "q2": 91, "final": null },
      "Arabic":         { "q1": 75, "q2": 80, "final": null },
      "Mathematics":    { "q1": 92, "q2": 95, "final": null },
      "Science":        { "q1": 85, "q2": 87, "final": null },
      "IslamicStudies": { "q1": 90, "q2": 93, "final": null },
      "History":        { "q1": 82, "q2": 84, "final": null },
      "English":        { "q1": 78, "q2": 81, "final": null }
    },
    "attendance": [],
    "culturalNotes": [],
    "behavioralNotes": []
  },
  {
    "fullName": "ژیان عومەر ڕەسوول",
    "phone": "07509876543",
    "birthYear": "2011",
    "classGroup": "Class-6B",
    "parentName": "عومەر ڕەسوول کەریم",
    "grades": {
      "Kurdish":        { "q1": null, "q2": null, "final": null },
      "Arabic":         { "q1": null, "q2": null, "final": null },
      "Mathematics":    { "q1": null, "q2": null, "final": null },
      "Science":        { "q1": null, "q2": null, "final": null },
      "IslamicStudies": { "q1": null, "q2": null, "final": null },
      "History":        { "q1": null, "q2": null, "final": null },
      "English":        { "q1": null, "q2": null, "final": null }
    },
    "attendance": [],
    "culturalNotes": [],
    "behavioralNotes": []
  }
];

const teachers = [
  {
    "fullName": "شیرین عومەر ئەحمەد",
    "phone": "07701111111",
    "assignedClasses": ["Class-5A", "Class-5B"],
    "subjects": ["کوردی", "ئینگلیزی"],
    "email": "",
    "students": []
  },
  {
    "fullName": "اركان دارا رشید",
    "phone": "07701217949",
    "assignedClasses": ["Class-6A"],
    "subjects": ["بیرکاری", "زانست"],
    "email": "",
    "students": []
  }
];

async function seed() {
  console.log("📤 داتا دەنێرێت بۆ KV...");

  const res = await fetch(`${WORKER}/api/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ students, teachers }),
  });

  const data = await res.json();

  if (res.ok) {
    console.log("✅ سەرکەوتوو! داتا چووە KV.");
    console.log(`   قوتابی: ${students.length} کەس`);
    console.log(`   مامۆستا: ${teachers.length} کەس`);
  } else {
    console.error("❌ هەڵە:", data.error);
  }
}

seed();
