import assert from 'node:assert/strict';
import {LEVELS, generatePuzzle, multiplicationTier} from './generator.mjs';

function assertGroup(group, size, level) {
  const {numbers, answer} = group;
  assert.equal(numbers.length, size);
  assert.equal(new Set(numbers).size, size);
  assert(numbers.every(number => Number.isInteger(number) && number > 0 && number <= LEVELS[level].limit));
  const solutions = numbers.filter((target, index) => numbers.some((left, a) =>
    a !== index && numbers.some((right, b) => b !== index && b !== a &&
      (LEVELS[level].operation === 'multiplication' ? left * right : left + right) === target)));
  assert.deepEqual(solutions, [answer]);
}

for (const level of Object.keys(LEVELS).map(Number)) {
  const layouts = new Set();
  let saw13By16 = false;
  for (let i = 0; i < 1000; i++) {
    const seed = 'daily-' + i;
    const puzzle = generatePuzzle(level, seed);
    assert.deepEqual(generatePuzzle(level, seed), puzzle);
    assertGroup(puzzle.centre, 4, level);
    if (level >= 4) {
      const groups = level === 4 ? [puzzle.centre, ...puzzle.petals] : [puzzle.centre];
      for (const {numbers, answer} of groups) {
        assert(numbers.some(a => numbers.some(b => a !== b && a * b === answer &&
          multiplicationTier(a, b) === level - 4)));
      }
    }
    assert.equal(puzzle.petals.length, 4);
    for (const [position, petal] of puzzle.petals.entries()) {
      assertGroup(petal, 5, level);
      assert.equal(petal.answer, puzzle.centre.numbers[position]);
      if (level === 6) {
        const nearby = Math.max(4, Math.ceil(petal.answer * .18));
        const close = petal.numbers.filter(number => number > petal.answer &&
          number - petal.answer <= nearby);
        if (petal.answer < LEVELS[level].limit) assert(close.length > 0);
        if (petal.answer === 208 && petal.numbers.includes(13) && petal.numbers.includes(16)) saw13By16 = true;
      }
    }
    layouts.add(JSON.stringify(puzzle));
  }
  assert(layouts.size > 990);
  if (level === 6) assert(saw13By16);
  console.log('Level ' + level + ': 1,000 seeds passed.');
}
console.log('6,000 centres and 24,000 petals passed uniqueness, bounds and seeded replay checks.');
