const byId = id => document.getElementById(id);
const escapeText = assessmentApi.escape;
let studentCode = localStorage.getItem("lategan_student_code") || "";
let linkedAssignment = new URLSearchParams(location.search).get("assignment");
let attempt = null;
let timer;
let saving = null;
let submitting = false;

function studentAssessment(action, data) {
  return assessmentApi.post("student", studentCode, action, data);
}

async function loadList() {
  byId("attempt").hidden = true;
  byId("list").hidden = true;
  byId("listStatus").textContent = "";
  if (!studentCode) {
    byId("studentLogin").hidden = false;
    return;
  }
  byId("listStatus").textContent = "Loading your assessments…";
  try {
    const {assignments} = await studentAssessment("list");
    byId("studentLogin").hidden = true;
    byId("list").hidden = false;
    byId("listStatus").textContent = "";
    const list = byId("assignments");
    list.innerHTML = assignments.map(a => `
      <div class="card"><h3>${escapeText(a.title)}</h3>
        <p>${escapeText(a.subject)}${a.subject ? " · " : ""}${a.submitted_at ? "Submitted" : a.started_at ? "In progress" : "Ready to start"}</p>
        <button class="primary" data-id="${escapeText(a.id)}">${a.submitted_at ? "View submitted assessment" : a.started_at ? "Continue" : "Start"}</button>
      </div>`).join("") || "<p>You have no assigned assessments.</p>";
    list.querySelectorAll("button").forEach(button => button.onclick = () => openAssessment(button.dataset.id, button));
    localStorage.setItem("lategan_student_code", studentCode);
    if (linkedAssignment) {
      const button = Array.from(list.querySelectorAll("button")).find(item => item.dataset.id === linkedAssignment);
      linkedAssignment = null;
      if (button) await openAssessment(button.dataset.id, button);
      else byId("listStatus").textContent = "That assessment isn’t assigned to this student.";
    }
  } catch (error) {
    byId("listStatus").textContent = error.message;
    if (error.status === 401) {
      studentCode = "";
      localStorage.removeItem("lategan_student_code");
      byId("studentLogin").hidden = false;
    }
  }
}

byId("studentLogin").onsubmit = event => {
  event.preventDefault();
  studentCode = byId("code").value.trim();
  byId("code").value = "";
  loadList();
};

async function openAssessment(id, button) {
  const buttons = Array.from(byId("assignments").querySelectorAll("button"));
  buttons.forEach(control => { control.disabled = true; });
  byId("listStatus").textContent = "Opening assessment…";
  try {
    const {assessment, answers, revision, submitted} = await studentAssessment("open", {assignment_id: id});
    attempt = {id, revision, dirty: false, submitted};
    byId("title").textContent = assessment.title;
    byId("instructions").textContent = assessment.instructions;
    byId("questions").innerHTML = assessment.questions.map((q, index) => {
      const answer = answers[q.id] ?? "";
      const controls = q.type === "mcq" ? q.options.map((option, optionIndex) => `
        <label class="option"><input type="radio" name="${q.id}" value="${optionIndex}" ${answer === String(optionIndex) ? "checked" : ""}> ${escapeText(option)}</label>
      `).join("") : `<textarea name="${q.id}" aria-label="Answer to question ${index + 1}" maxlength="4000">${escapeText(answer)}</textarea>`;
      return `<fieldset><legend>${index + 1}. ${escapeText(q.text)} (${q.marks} ${q.marks === 1 ? "mark" : "marks"})</legend>${controls}</fieldset>`;
    }).join("");
    lockAnswers(submitted);
    byId("saveStatus").textContent = submitted ? "Submitted to your teacher." : "Your answers save automatically.";
    byId("listStatus").textContent = "";
    byId("list").hidden = true;
    byId("attempt").hidden = false;
    byId("title").scrollIntoView();
  } catch (error) {
    byId("listStatus").textContent = error.message;
    button.focus();
  } finally {
    buttons.forEach(control => { control.disabled = false; });
  }
}

function lockAnswers(locked) {
  byId("questions").querySelectorAll("fieldset").forEach(field => { field.disabled = locked; });
  byId("save").disabled = locked;
  byId("submit").disabled = locked;
}

function readAnswers() {
  return Object.fromEntries(new FormData(byId("answers")));
}

function queueSave() {
  clearTimeout(timer);
  timer = setTimeout(saveDraft, 650);
}

byId("questions").oninput = () => {
  if (!attempt || attempt.submitted || submitting) return;
  attempt.dirty = true;
  byId("saveStatus").textContent = "Saving…";
  queueSave();
};

async function saveDraft() {
  clearTimeout(timer);
  if (!attempt || attempt.submitted || submitting) return;
  if (saving) return saving;
  if (!attempt.dirty) return;
  const answers = readAnswers();
  attempt.dirty = false;
  byId("saveStatus").textContent = "Saving…";
  saving = (async () => {
    try {
      const result = await studentAssessment("save", {assignment_id: attempt.id, revision: attempt.revision, answers});
      attempt.revision = result.revision;
      byId("saveStatus").textContent = attempt.dirty ? "Saving…" : "Answers saved.";
      if (attempt.dirty && !submitting) queueSave();
    } catch (error) {
      clearTimeout(timer);
      attempt.dirty = true;
      byId("saveStatus").textContent = "Answers still on this screen. " + error.message;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

byId("save").onclick = saveDraft;

byId("answers").onsubmit = async event => {
  event.preventDefault();
  if (!attempt || attempt.submitted || submitting) return;
  if (!confirm("Submit your assessment to your teacher? You won’t be able to change your answers after submitting.")) return;
  const answers = readAnswers();
  submitting = true;
  clearTimeout(timer);
  lockAnswers(true);
  byId("back").disabled = true;
  try {
    if (saving) await saving;
    byId("saveStatus").textContent = "Submitting…";
    await studentAssessment("submit", {assignment_id: attempt.id, revision: attempt.revision, answers});
    attempt.submitted = true;
    attempt.dirty = false;
    byId("saveStatus").textContent = "Submitted to your teacher.";
  } catch (error) {
    byId("saveStatus").textContent = error.message;
  } finally {
    submitting = false;
    lockAnswers(attempt.submitted);
    byId("back").disabled = false;
  }
};

byId("back").onclick = async () => {
  if (submitting) return;
  byId("back").disabled = true;
  try {
    await saveDraft();
    if (attempt.dirty && !confirm("Some answers haven’t saved. Leave this assessment anyway?")) return;
    clearTimeout(timer);
    attempt = null;
    byId("questions").replaceChildren();
    await loadList();
  } finally {
    byId("back").disabled = false;
  }
};

window.addEventListener("beforeunload", event => {
  if (attempt?.dirty || saving || submitting) event.preventDefault();
});

loadList();
