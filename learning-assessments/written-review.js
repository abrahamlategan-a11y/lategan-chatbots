let writtenReview = null;

function resetWrittenReview() {
  writtenReview = null;
  $("writtenReview").hidden = true;
  $("writtenReviewCard").hidden = true;
}

function prepareWrittenReview(assignmentId, assessment, students) {
  const questions = assessment.questions.map((question, index) => ({...question, number: index + 1}))
    .filter(question => question.type !== "mcq");
  const state = {
    assignmentId, questions, students, entries: new Map(), saved: new Map(),
    current: null, waiting: 0, loading: false, saving: false, completed: 0
  };
  writtenReview = state;
  $("openWrittenReview").onclick = () => {
    responseRequest++;
    $("assignmentReport").hidden = true;
    $("responseReview").hidden = true;
    $("writtenReview").hidden = false;
    renderWrittenReview(state);
    $("writtenReviewTitle").focus();
  };
  refreshWrittenReview(state);
}

function reviewItems(state) {
  const ready = [];
  let waiting = 0;
  for (const question of state.questions) {
    for (const student of state.students) {
      const entry = state.entries.get(student.student_id);
      if (!entry || entry.reviews[question.id]) continue;
      const mark = entry.ai_marks[question.id];
      if (!mark && entry.ai_status === "marking") {
        waiting++;
        continue;
      }
      ready.push({question, student, entry, mark, key: student.student_id + "/" + question.id});
    }
  }
  return {ready, waiting};
}

async function refreshWrittenReview(state) {
  if (state !== writtenReview || state.loading) return;
  state.loading = true;
  const entries = new Map();
  try {
    await readWrittenPages(state.assignmentId, entry => entries.set(entry.student_id, entry), () => state === writtenReview);
    if (state !== writtenReview) return;
    for (const [studentId, reviews] of state.saved) {
      const entry = entries.get(studentId);
      if (entry) Object.assign(entry.reviews, reviews);
    }
    state.entries = entries;
    updateReviewNotification(state);
  } catch (error) {
    if (state === writtenReview) $("readyReviewCount").textContent = "Couldn’t load written responses. Use Refresh results to try again.";
    return;
  } finally {
    state.loading = false;
  }
  if (state.waiting && (state.polls ?? 0) < 7) {
    state.polls = (state.polls ?? 0) + 1;
    setTimeout(() => refreshWrittenReview(state), 4000);
  }
}

function updateReviewNotification(state) {
  const {ready, waiting} = reviewItems(state);
  state.waiting = waiting;
  const label = ready.length === 1 ? "1 response ready for review" : `${ready.length} responses ready for review`;
  $("readyReviewCount").textContent = waiting ? `${label} · ${waiting} still marking` : label;
  $("openWrittenReview").disabled = !ready.length;
  if (!$("writtenReview").hidden && !state.saving) renderWrittenReview(state, ready);
}

function recordWrittenReview(assignmentId, studentId, questionId, review) {
  const state = writtenReview;
  if (!state || state.assignmentId !== assignmentId) return;
  const saved = state.saved.get(studentId) || {};
  saved[questionId] = review;
  state.saved.set(studentId, saved);
  const entry = state.entries.get(studentId);
  if (entry) entry.reviews[questionId] = review;
  updateReviewNotification(state);
}

function renderWrittenReview(state, ready = reviewItems(state).ready) {
  const item = ready.find(candidate => candidate.key === state.current?.key) || ready[0];
  $("writtenReviewProgress").textContent = item
    ? `${ready.length} left to review${state.completed ? ` · ${state.completed} reviewed this session` : ""}`
    : state.waiting ? "You’re caught up. More responses are being marked."
    : "You’re caught up. All submitted written responses have been reviewed.";
  if (!item || item.key === state.current?.key) {
    $("writtenReviewCard").hidden = !item;
    if (!item) state.current = null;
    return;
  }
  state.current = item;
  $("writtenReviewCard").hidden = false;
  $("reviewQuestionNumber").textContent = `Question ${item.question.number}`;
  $("reviewQuestionText").textContent = item.question.text;
  $("reviewStudent").textContent = item.student.display_name || "Student";
  $("reviewAnswer").textContent = item.entry.answers[item.question.id] || "No response";
  $("reviewSuggestedMark").textContent = item.mark
    ? `Suggested mark · ${item.mark.score} / ${item.question.marks}`
    : "Teacher mark needed";
  $("reviewReason").textContent = item.mark?.feedback || "Enter your mark to continue.";
  $("confirmWrittenReview").hidden = !item.mark;
  $("overrideWrittenReview").textContent = item.mark ? "Override" : "Enter mark";
  $("writtenOverrideForm").hidden = true;
  $("reviewActions").hidden = false;
  $("writtenReviewError").textContent = "";
}

$("closeWrittenReview").onclick = () => {
  $("writtenReview").hidden = true;
  $("assignmentReport").hidden = false;
  $("responseReview").hidden = false;
  $("openWrittenReview").focus();
};

$("overrideWrittenReview").onclick = () => {
  const item = writtenReview?.current;
  if (!item) return;
  $("writtenOverrideMark").max = item.question.marks;
  $("writtenOverrideMark").value = item.mark?.score ?? "";
  $("writtenOverrideFeedback").value = item.mark?.feedback ?? "";
  $("reviewActions").hidden = true;
  $("writtenOverrideForm").hidden = false;
  $("writtenOverrideMark").focus();
};

$("cancelWrittenOverride").onclick = () => {
  $("writtenOverrideForm").hidden = true;
  $("reviewActions").hidden = false;
  $("overrideWrittenReview").focus();
};

async function saveWrittenReview(score, feedback) {
  const state = writtenReview;
  const item = state?.current;
  if (!item || state.saving) return;
  state.saving = true;
  const controls = $("writtenReviewCard").querySelectorAll("button, input, textarea");
  controls.forEach(control => { control.disabled = true; });
  $("writtenReviewError").textContent = "";
  try {
    const {review} = await teacherAssessment("review", {
      assignment_id: state.assignmentId, student_id: item.student.student_id,
      question_id: item.question.id, score, feedback
    });
    if (state !== writtenReview) return;
    state.completed++;
    state.current = null;
    state.saving = false;
    recordWrittenReview(state.assignmentId, item.student.student_id, item.question.id, review);
    if (!$("writtenReview").hidden) $("writtenReviewTitle").focus();
  } catch (error) {
    if (state === writtenReview) $("writtenReviewError").textContent = error.message;
  } finally {
    state.saving = false;
    controls.forEach(control => { control.disabled = false; });
  }
}

$("confirmWrittenReview").onclick = () => {
  const mark = writtenReview?.current?.mark;
  if (mark) saveWrittenReview(mark.score, mark.feedback);
};

$("writtenOverrideForm").onsubmit = event => {
  event.preventDefault();
  saveWrittenReview(Number($("writtenOverrideMark").value), $("writtenOverrideFeedback").value);
};
