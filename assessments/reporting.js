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
function mathsTrekCommentSuggestions(studentName, test, summary) {
  const topic = item => item.name.split(' · ')[1];
  const topics = items => items.slice(0, 2).map(topic).join(' and ');
  const [strength] = summary.strengths;
  const [growth] = summary.growth;
  const result = `${studentName}, you scored ${summary.total} out of ${summary.available} on Maths Trek Test ${test}.`;
  const strengths = strength ? `You did especially well in ${topics(summary.strengths)}.` : '';
  const nextStep = growth ? `Next time, make sure you practise ${topics(summary.growth)}.` : '';
  const combine = (...sentences) => sentences.filter(Boolean).join(' ');
  return [
    ['Balanced', combine(result, strengths, nextStep)],
    ['Short', combine(
      `${studentName}, you scored ${summary.total}/${summary.available} on Test ${test}.`,
      strength && `Well done on your work with ${topic(strength)}.`,
      growth && `Keep practising ${topic(growth)}.`
    )],
    ['With marks by topic', combine(
      result,
      strength && `You earned ${strength.score} out of ${strength.max} marks on questions about ${topic(strength)}.`,
      growth && `You earned ${growth.score} out of ${growth.max} marks on questions about ${topic(growth)}, which gives you a focus for further practice.`
    )]
  ].filter(([, comment], index, suggestions) => suggestions.findIndex(([, text]) => text === comment) === index);
}
function mathsTrekCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function mathsTrekDownloadCsv(rows, filename) {
  const csv = "\uFEFF" + rows.map(row => row.map(mathsTrekCsvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
