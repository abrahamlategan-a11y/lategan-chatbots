import {generatePuzzle} from './generator.mjs?v=challenge';

const $ = id => document.getElementById(id);
const setup = $('setup'), flower = $('flower'), result = $('result');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let round, runningClock, timerVisible = true;
const labels = ['Top petal', 'Right petal', 'Bottom petal', 'Left petal'];

function timeText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function numberButton(number) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'number';
  button.textContent = number;
  button.setAttribute('aria-pressed', 'false');
  return button;
}

function begin(level, seed) {
  round = {level, seed, puzzle: generatePuzzle(level, seed), solved: [false,false,false,false],
    finished: false, selections: new Map()};
  const multiply = round.puzzle.operation === 'multiplication';
  $('instruction').textContent = multiply
    ? 'Tap two factors, then their product.'
    : 'Tap two numbers, then their sum.';
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
  void showBests('playBests',level);
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
  const selected = round.selections.get(petal) ?? [];
  const repeated = selected.findIndex(item => item.number === number);
  if (repeated !== -1) {
    selected.splice(repeated, 1);
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  if (selected.length < 2) {
    selected.push({number, button});
    round.selections.set(petal, selected);
    button.setAttribute('aria-pressed', 'true');
    $('announce').textContent = selected.length === 1 ? 'Pick the second number.' : 'Now pick the result.';
    return;
  }
  const [first, second] = selected;
  const multiply = round.puzzle.operation === 'multiplication';
  const expected = multiply ? first.number * second.number : first.number + second.number;
  round.selections.delete(petal);
  if (expected !== number || number !== group.answer) {
    for (const item of selected) item.button.setAttribute('aria-pressed', 'false');
    button.classList.remove('wrong');
    void button.offsetWidth;
    button.classList.add('wrong');
    setTimeout(() => button.classList.remove('wrong'), 300);
    $('announce').textContent = 'That equation doesn’t work. Start with two numbers and try again.';
    return;
  }
  button.setAttribute('aria-pressed', 'true');
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
      ? 'Final puzzle: tap two factors, then their product.'
      : 'Final puzzle: tap two numbers, then their sum.';
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
  void showBests('resultBests',round.level,round.totalTimeMs);
}

const bestRequests = new Map();
async function showBests(id, level, timeMs) {
  const panel = $(id);
  const request = Symbol();
  bestRequests.set(id, request);
  panel.hidden = false;
  panel.replaceChildren();
  const status = document.createElement('p');
  status.setAttribute('role','status');
  const preview = id === 'setupRecordStrip';
  const compact = id === 'playBests' || preview;
  const labels = preview ? ['My Best', 'Year 4 Best', 'Teacher Best'] : ['My Best', 'Year 4 Best'];
  const records = compact ? labels.map(label => {
    const item = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = label;
    const value = document.createElement(preview ? 'b' : 'span');
    const name = preview ? document.createElement('small') : null;
    value.textContent = '—';
    item.append(title,value);
    if (name) item.append(name);
    panel.append(item);
    return {value,name};
  }) : [];
  panel.append(status);
  const fromTeacher = new URLSearchParams(location.search).get('from') === 'teacher';
  const hub = fromTeacher ? 'Teacher Hub' : 'Student Hub';
  let code = '';
  try { code = localStorage.getItem(fromTeacher ? 'lategan_teacher_code' : 'lategan_student_code') || ''; } catch {}
  if (!code) {
    status.textContent = 'Sign in through ' + hub + ' to see best times.';
    return;
  }
  const credentials = fromTeacher ? {teacher_code:code} : {student_code:code};
  status.textContent = 'Loading best times…';
  try {
    const response = await fetch('https://lategan-chatbot.abrahamlategan.workers.dev', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'sumflowers_best',...credentials,level,time_ms:timeMs})
    });
    const data = await response.json();
    if (bestRequests.get(id) !== request) return;
    if (!response.ok) {
      status.textContent = data.error === 'Unknown action.' ? 'Year 4 bests are coming soon.' : (data.error || 'Best times are unavailable right now.');
      return;
    }
    if (!Array.isArray(data.year4Best)) throw Error('Invalid leaderboard');
    status.textContent = '';
    if (compact) {
      records[0].value.textContent = data.myBest == null ? '—' : bestTimeText(data.myBest);
      const leaders = preview ? [data.year4Best[0],data.teacherBest?.[0]] : [data.year4Best[0]];
      leaders.forEach((leader,index) => {
        if (!leader) return;
        const {value,name} = records[index+1];
        const label = leader.name+(leader.className ? ' ('+leader.className+')' : '');
        value.textContent = bestTimeText(leader.timeMs)+(preview ? '' : ' · '+label);
        if (name) name.textContent = label;
      });
      return;
    }
    const heading = document.createElement('h3');
    heading.textContent = 'My Best';
    const mine = document.createElement('p');
    mine.textContent = data.myBest == null ? 'Finish a round to set a time.' : bestTimeText(data.myBest);
    panel.append(heading,mine);
    appendBestList(panel,'Year 4 Best',data.year4Best);
    if (Array.isArray(data.teacherBest)) appendBestList(panel,'Teacher Best',data.teacherBest);

  } catch {
    if (bestRequests.get(id) === request) status.textContent = 'Best times are unavailable right now.';
  }
}
function appendBestList(panel, title, rows) {
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('ol');
  for (const row of rows) {
    const item = document.createElement('li');
    const label = row.className ? row.name + ' (' + row.className + ')' : row.name;
    item.textContent = label + ' · ' + bestTimeText(row.timeMs);
    list.append(item);
  }
  const empty = document.createElement('p');
  empty.textContent = 'No times yet for this level.';
  panel.append(heading,rows.length?list:empty);
}
function bestTimeText(ms) {
  return timeText(ms) + '.' + String(Math.floor(ms / 100) % 10);
}
$('showBests').onclick = () => { void showBests('setupBests',Number($('level').value)); };
$('level').addEventListener('change', () => {
  void showBests('setupRecordStrip',Number($('level').value));
  if (!$('setupBests').hidden) void showBests('setupBests',Number($('level').value));
});

$('toggleTime').onclick = () => {
  timerVisible = !timerVisible;
  $('time').hidden = !timerVisible;
  $('toggleTime').textContent = timerVisible ? 'Hide timer' : 'Show timer';
  $('toggleTime').setAttribute('aria-expanded', String(timerVisible));
};
setup.onsubmit = event => {
  event.preventDefault();
  begin(Number($('level').value), crypto.randomUUID());
};
$('again').onclick = () => {
  result.close();
  $('play').hidden = $('clock').hidden = true;
  setup.hidden = false;
  if (!$('setupBests').hidden) void showBests('setupBests',Number($('level').value));
  void showBests('setupRecordStrip',Number($('level').value));
  $('level').focus();
};
result.addEventListener('cancel', event => { event.preventDefault(); $('again').click(); });
if (new URLSearchParams(location.search).get('from') === 'teacher') {
  $('hubLink').href = '../teacher/';
  $('hubLink').textContent = '← Teacher Hub';
}
void showBests('setupRecordStrip',Number($('level').value));
