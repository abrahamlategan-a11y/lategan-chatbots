import {createHash} from 'node:crypto';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/v2/https';

initializeApp();

export const saveSumSleuthRound = onRequest({
  cors: ['https://abrahamlategan-a11y.github.io'],
  region: 'australia-southeast1'
}, async (request, response) => {
  if (request.method !== 'POST') return response.sendStatus(405);
  const {studentCode, level, seed, totalTimeMs, wrongTaps, runId} = request.body ?? {};
  const limits = {1:20, 2:100, 3:144};
  const limit = limits[level];
  if (typeof studentCode !== 'string' || !studentCode.trim() || studentCode.length > 128 ||
      !Number.isInteger(level) || !limit || typeof seed !== 'string' || !seed.trim() || seed.length > 80 ||
      !Number.isSafeInteger(totalTimeMs) || totalTimeMs < 0 ||
      typeof runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(runId) ||
      !Array.isArray(wrongTaps) || wrongTaps.length > 20000 || !wrongTaps.every(tap =>
        tap && ['centre', 1, 2, 3, 4].includes(tap.petal) &&
        Number.isInteger(tap.numberTapped) && tap.numberTapped >= 1 && tap.numberTapped <= limit)) {
    return response.sendStatus(400);
  }
  let login;
  try {
    login = await fetch('https://lategan-chatbot.abrahamlategan.workers.dev', {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(6000),
      body:JSON.stringify({action:'student_login',student_code:studentCode.trim()})
    });
    if (!login.ok) return response.sendStatus(login.status >= 500 ? 502 : 401);
    const {student} = await login.json();
    const studentId = student?.id ?? student?.student_id;
    if ((typeof studentId !== 'number' && typeof studentId !== 'string') || studentId === '') {
      return response.sendStatus(401);
    }
    const id = createHash('sha256').update(JSON.stringify([studentId, runId])).digest('hex');
    try {
      await getFirestore().collection('sumSleuthRounds').doc(id).create({
        studentId, level, seed, totalTimeMs,
        wrongTaps:wrongTaps.map(({petal,numberTapped})=>({petal,numberTapped}))
      });
    } catch (error) {
      if (error.code !== 6) return response.sendStatus(503);
    }
    return response.sendStatus(204);
  } catch {
    return response.sendStatus(502);
  }
});
