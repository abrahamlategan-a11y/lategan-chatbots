import assert from 'node:assert/strict';
import {LEVELS, generatePuzzle} from './generator.mjs';

function assertGroup(group, size, level) {
  const {numbers, answer} = group;
  assert.equal(numbers.length, size);
  assert.equal(new Set(numbers).size, size);
  assert(numbers.every(number => Number.isInteger(number) && number > 0 && number <= LEVELS[level].limit));
  const solutions = numbers.filter((target, index) => numbers.some((left, a) =>
    a !== index && numbers.some((right, b) => b !== index && b !== a &&
      (level === 3 ? left * right : left + right) === target)));
  assert.deepEqual(solutions, [answer]);
}

for (const level of [1, 2, 3]) {
  const layouts = new Set();
  for (let i = 0; i < 1000; i++) {
    const seed = 'daily-' + i;
    const puzzle = generatePuzzle(level, seed);
    assert.deepEqual(generatePuzzle(level, seed), puzzle);
    assertGroup(puzzle.centre, 4, level);
    assert.equal(puzzle.petals.length, 4);
    for (const [position, petal] of puzzle.petals.entries()) {
      assertGroup(petal, 5, level);
      assert.equal(petal.answer, puzzle.centre.numbers[position]);
    }
    layouts.add(JSON.stringify(puzzle));
  }
  assert(layouts.size > 990);
  console.log('Level ' + level + ': 1,000 seeds passed.');
}
console.log('3,000 centres and 12,000 petals passed uniqueness, bounds and seeded replay checks.');
