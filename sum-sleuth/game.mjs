import {generatePuzzle} from './generator.mjs';

const $ = id => document.getElementById(id);
const setup = $('setup'), flower = $('flower'), result = $('result');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let round, runningClock, timerVisible = true;
const labels = ['Top petal', 'Right petal', 'Bottom petal', 'Left petal'];

function timeText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function dailySeed() {
  const fields = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const date = Object.fromEntries(fields.map(({type, value}) => [type, value]));
  return 'daily-' + date.year + '-' + date.month + '-' + date.day;
}

function numberButton(number) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'number';
  button.textContent = number;
  return button;
}

function begin(level, seed) {
  round = {level, seed, puzzle: generatePuzzle(level, seed), solved: [false,false,false,false],
    finished: false};
  const multiply = round.puzzle.operation === 'multiplication';
  $('instruction').textContent = multiply
    ? 'Tap the product of two other numbers in each petal.'
    : 'Tap the sum of two other numbers in each petal.';
  const petals = round.puzzle.petals.map((petal, index) => {
    const section = document.createElement('section');
    section.className = 'petal';
    section.dataset.position = index;
    const heading = document.createElement('h2');
    heading.textContent = 'Petal ' + (index + 1);
    section.setAttribute('aria-label', labels[index]);
    const buttons = document.createElement('div');
    buttons.className = 'numbers';
    for (const number of petal.numbers) {
      const button = numberButton(number);
      button.onclick = () => tap(index, number, button, section);
      buttons.append(button);
    }
    section.append(heading, buttons);
    return section;
  });
  const centre = document.createElement('section');
  centre.className = 'centre';
  centre.setAttribute('aria-label', 'Final puzzle');
  const heading = document.createElement('h2');
  heading.textContent = 'Final puzzle';
  const slots = document.createElement('div');
  slots.className = 'numbers';
  slots.id = 'centreSlots';
  for (const [index, number] of round.puzzle.centre.numbers.entries()) {
    const slot = numberButton('·');
    slot.classList.add('empty');
    slot.disabled = true;
    slot.setAttribute('aria-label', 'Waiting for petal ' + (index + 1));
    slot.onclick = () => tap('centre', number, slot, centre);
    slots.append(slot);
  }
  centre.append(heading, slots);
  flower.replaceChildren(...petals, centre);
  $('announce').textContent = '';
  setup.hidden = true;
  $('play').hidden = $('clock').hidden = false;
  round.started = performance.now();
  $('time').textContent = '0:00';
  clearInterval(runningClock);
  runningClock = setInterval(() => {
    $('time').textContent = timeText(performance.now() - round.started);
  }, 250);
  petals[0].querySelector('button').focus();
}

function flyToCentre(source, destination) {
  if (motion.matches || !destination.animate) return;
  const from = source.getBoundingClientRect(), to = destination.getBoundingClientRect();
  destination.animate([
    {transform: 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px)', opacity: .65},
    {transform: 'translate(0,0)', opacity: 1}
  ], {duration: 420, easing: 'cubic-bezier(.2,.8,.25,1)'});
}

function tap(petal, number, button, section) {
  const isCentre = petal === 'centre';
  if (round.finished || (isCentre ? !round.solved.every(Boolean) : round.solved[petal])) return;
  const group = isCentre ? round.puzzle.centre : round.puzzle.petals[petal];
  if (number !== group.answer) {
    button.classList.remove('wrong');
    void button.offsetWidth;
    button.classList.add('wrong');
    setTimeout(() => button.classList.remove('wrong'), 300);
    $('announce').textContent = number + ' is not the answer. Try again.';
    return;
  }
  button.classList.add('correct');
  if (isCentre) return finish();
  round.solved[petal] = true;
  section.classList.add('done');
  for (const tile of section.querySelectorAll('button')) tile.setAttribute('aria-disabled', 'true');
  const slots = $('centreSlots');
  const slot = slots.children[petal];
  slot.textContent = number;
  slot.classList.remove('empty');
  slot.removeAttribute('aria-label');
  flyToCentre(button, slot);
  if (round.solved.every(Boolean)) {
    slots.closest('.centre').classList.add('ready');
    for (const centreButton of slots.children) centreButton.disabled = false;
    $('instruction').textContent = round.puzzle.operation === 'multiplication'
      ? 'Final puzzle: tap the product of two other numbers in the centre.'
      : 'Final puzzle: tap the sum of two other numbers in the centre.';
    $('announce').textContent = 'The final puzzle is ready.';
    slots.children[0].focus();
  } else {
    $('announce').textContent = labels[petal] + ' solved. ' + number + ' moved to the centre.';
    flower.querySelector('.petal:not(.done) button').focus();
  }
}

function celebrate() {
  if (motion.matches || !Element.prototype.animate) return;
  for (let index = 0; index < 24; index++) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.setAttribute('aria-hidden', 'true');
    const angle = index * (Math.PI * 2 / 24);
    const distance = 65 + (index % 5) * 23;
    Object.assign(piece.style, {left:'50%',top:'45%',width:'8px',height:'11px',
      background:['#8eddbf','#efbc57','#c8a5e7','#83bce7'][index % 4]});
    result.append(piece);
    const animation = piece.animate([
      {transform:'translate(0,0)',opacity:1},
      {transform:'translate('+Math.cos(angle)*distance+'px,'+Math.sin(angle)*distance+'px) rotate(180deg)',opacity:0}
    ], {duration:700,easing:'ease-out'});
    animation.onfinish = () => piece.remove();
  }
}

function finish() {
  round.finished = true;
  round.totalTimeMs = Math.round(performance.now() - round.started);
  clearInterval(runningClock);
  $('time').textContent = $('resultTime').textContent = timeText(round.totalTimeMs);
  result.showModal();
  celebrate();
}

$('daily').onclick = () => { $('seed').value = dailySeed(); };
$('toggleTime').onclick = () => {
  timerVisible = !timerVisible;
  $('time').hidden = !timerVisible;
  $('toggleTime').textContent = timerVisible ? 'Hide timer' : 'Show timer';
  $('toggleTime').setAttribute('aria-expanded', String(timerVisible));
};
setup.onsubmit = event => {
  event.preventDefault();
  begin(Number($('level').value), $('seed').value.trim() || crypto.randomUUID());
};
$('again').onclick = () => {
  result.close();
  $('play').hidden = $('clock').hidden = true;
  setup.hidden = false;
  $('level').focus();
};
result.addEventListener('cancel', event => { event.preventDefault(); $('again').click(); });
if (new URLSearchParams(location.search).get('from') === 'teacher') {
  $('hubLink').href = '../teacher/';
  $('hubLink').textContent = '← Teacher Hub';
}
