export const LEVELS = Object.freeze({
  1: Object.freeze({operation: 'addition', limit: 20}),
  2: Object.freeze({operation: 'addition', limit: 100}),
  3: Object.freeze({operation: 'multiplication', limit: 144, factorLimit: 12}),
});

function seededRandom(seed) {
  let state = 2166136261;
  for (const symbol of String(seed)) state = Math.imul(state ^ symbol.codePointAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function range(first, last) {
  return Array.from({length: Math.max(0, last - first + 1)}, (_, index) => first + index);
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function validAnswers(numbers, operation) {
  const answers = new Set();
  for (let a = 0; a < numbers.length; a++) {
    for (let b = a + 1; b < numbers.length; b++) {
      const result = operation === 'multiplication' ? numbers[a] * numbers[b] : numbers[a] + numbers[b];
      if (numbers.some((number, index) => index !== a && index !== b && number === result)) answers.add(result);
    }
  }
  return [...answers];
}

export function generatePuzzle(level, seed) {
  const settings = LEVELS[level];
  if (!settings) throw new RangeError('Choose level 1, 2 or 3.');
  const random = seededRandom(seed);
  const {operation, limit, factorLimit} = settings;
  const multiply = operation === 'multiplication';
  const values = range(multiply ? 2 : 1, limit);
  const operands = range(multiply ? 2 : 1, factorLimit ?? limit);
  const pairsByTarget = new Map();

  for (const [index, left] of operands.entries()) {
    for (const right of operands.slice(index + 1)) {
      const result = multiply ? left * right : left + right;
      if (result > limit) continue;
      if (!pairsByTarget.has(result)) pairsByTarget.set(result, []);
      pairsByTarget.get(result).push([left, right]);
    }
  }

  function buildGroup(cards, pool, size) {
    if (cards.length === size) return shuffled(cards, random);
    for (const number of shuffled(pool, random)) {
      if (cards.includes(number)) continue;
      const candidate = [...cards, number];
      // The original relationship stays present, so any extra answer is a conflict.
      if (validAnswers(candidate, operation).length !== 1) continue;
      const filled = buildGroup(candidate, pool, size);
      if (filled) return filled;
    }
    return null;
  }

  const solvable = [...pairsByTarget.keys()];
  const eligibleCentrePairs = [];
  for (const [target, pairs] of pairsByTarget) {
    if (target < (multiply ? 24 : 10)) continue;
    for (const pair of pairs) {
      if (pair.every(number => pairsByTarget.has(number))) eligibleCentrePairs.push([...pair, target]);
    }
  }

  for (const triple of shuffled(eligibleCentrePairs, random)) {
    const numbers = buildGroup(triple, solvable, 4);
    if (!numbers) continue;
    const petals = numbers.map(answer => {
      for (const pair of shuffled(pairsByTarget.get(answer), random)) {
        const cards = buildGroup([...pair, answer], values, 5);
        if (cards) return {numbers: cards, answer};
      }
      return null;
    });
    if (petals.every(Boolean)) return {operation, petals, centre: {numbers, answer: triple[2]}};
  }
  throw new Error('No valid puzzle could be generated.');
}
