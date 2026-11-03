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
function mathsTrekCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
