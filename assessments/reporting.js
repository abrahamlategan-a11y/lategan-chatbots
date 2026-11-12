/* Shared calculations for screen, print and spreadsheet reports. */
function mathsTrekSummary(records, metadata) {
  const parts = [0, 0, 0].map(() => ({score: 0, max: 0}));
  const strands = Object.fromEntries(['NA', 'MG', 'SP'].map(key => [key, {score: 0, max: 0}]));
  const concepts = new Map();
  let total = 0, available = 0;
  for (const record of records) {
    const test = Number(record.test ?? record.test_number);
    if (!metadata[test - 1] || !Array.isArray(record.marks) || record.marks.length !== 40) continue;
    for (let i = 0; i < 40; i++) {
      const part = i < 24 ? 0 : i < 36 ? 1 : 2;
      const max = part + 1, score = Number(record.marks[i]);
      if (!Number.isInteger(score) || score < 0 || score > max) throw Error('Invalid saved question marks.');
      const [strand, concept] = metadata[test - 1][i];
      if (!strands[strand]) throw Error('Unknown question strand.');
      parts[part].score += score; parts[part].max += max;
      strands[strand].score += score; strands[strand].max += max;
      const key = strand + ' · ' + concept;
      const item = concepts.get(key) || {name: key, score: 0, max: 0};
      item.score += score; item.max += max; concepts.set(key, item);
      total += score; available += max;
    }
  }
  const ranked = [...concepts.values()].filter(x => x.max >= 2).map(x => ({...x, pct: x.score / x.max}));
  return {total, available, parts, strands,
    strengths: ranked.filter(x => x.pct >= .75).sort((a,b) => b.pct-a.pct || b.max-a.max || a.name.localeCompare(b.name)).slice(0,3),
    growth: ranked.filter(x => x.pct < .6).sort((a,b) => a.pct-b.pct || b.max-a.max || a.name.localeCompare(b.name)).slice(0,3)};
}
function mathsTrekTestJson(test, students, results, metadata, includeNames) {
  const byStudent = new Map(results.filter(result =>
    Number(result.test ?? result.test_number) === test && Array.isArray(result.marks) && result.marks.length === 40
  ).map(result => [Number(result.student_id), result]));
  return {
    format: "Maths Trek test feedback",
    version: 1,
    ai_instructions: {
      first_response: "Ask the teacher these questions and wait for their answers before drafting any comments.",
      questions: [
        "Who should the comments be written to: the student or their parent/carer?",
        "What tone and length would you like? You can paste an example of your own writing.",
        "Is there any feedback to include for the whole class or for individual students, such as a reminder to check their work?"
      ],
      drafting_rules: [
        "Write one comment per listed student in the teacher's chosen tone and length, using Australian English.",
        "For student-facing comments, speak directly to the student using you and your. For parent/carer-facing comments, describe the student's learning in the third person.",
        "Use a specific strength and an actionable next step when supported by the marks or teacher feedback. Never infer effort, behaviour or progress over time from a single test.",
        "Use only the evidence in this file and the teacher's notes. Do not invent question wording, student names or results. A mark of zero is a saved mark.",
        "Label each comment with the student's reference, plus their first name when supplied. Omit numeric marks from the comments unless the teacher asks for them."
      ]
    },
    test: {
      name: "Maths Trek Test " + test,
      number: test,
      maximum_marks: 60,
      questions: metadata[test - 1].map(([strand, topic], index) => ({
        number: index + 1, strand, topic, maximum_marks: index < 24 ? 1 : index < 36 ? 2 : 3
      }))
    },
    strands: {NA: "Number and Algebra", MG: "Measurement and Geometry", SP: "Statistics and Probability"},
    students: students.flatMap((student, index) => {
      const result = byStudent.get(Number(student.id));
      if (!result) return [];
      const summary = mathsTrekSummary([result], metadata);
      return [{
        reference: "Student " + (index + 1),
        ...(includeNames ? {first_name: student.display_name.trim().split(/\s+/)[0]} : {}),
        total_marks: summary.total,
        strands: summary.strands,
        strengths: summary.strengths.map(({name, score, max}) => ({topic: name, marks: score, maximum_marks: max})),
        areas_to_practise: summary.growth.map(({name, score, max}) => ({topic: name, marks: score, maximum_marks: max})),
        marks_in_question_order: result.marks.map(Number)
      }];
    })
  };
}
function mathsTrekCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function mathsTrekDownloadCsv(rows, filename) {
  const csv = "\uFEFF" + rows.map(row => row.map(mathsTrekCsvCell).join(",")).join("\r\n");
  mathsTrekDownload(csv, "text/csv;charset=utf-8", filename);
}
function mathsTrekDownload(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
