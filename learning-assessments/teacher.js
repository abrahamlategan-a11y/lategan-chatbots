let assignmentCode = localStorage.getItem("lategan_teacher_code") || "";
let assignmentClasses = [];
let activeAssignment = null;
let pendingAssignment = null;
let responseRequest = 0;

function teacherAssessment(action, data) {
  return assessmentApi.post("teacher", assignmentCode, action, data);
}

async function loadAssignments() {
  if (!assignmentCode) {
    $("assessmentLogin").hidden = false;
    return;
  }
  $("connectionStatus").textContent = "Checking assessment access…";
  try {
    const result = await teacherAssessment("list");
    assignmentClasses = result.classes;
    const selector = $("assignmentClass");
    const selected = selector.value || String(assignmentClasses.find(c => c.name.trim().toUpperCase() === "4L")?.id || "");
    selector.replaceChildren(new Option("Choose a class", ""), ...assignmentClasses.map(c => new Option(c.name, c.id)));
    selector.value = selected;
    $("assignButton").disabled = !assignmentClasses.length;
    $("assessmentLogin").hidden = true;
    $("connectionStatus").textContent = "";
    $("assignmentList").innerHTML = result.assignments.map(a => `
      <div class="libraryCard">
        <span class="pill">${esc(a.class_name)}</span><h3>${esc(a.title)}</h3>
        <p>${a.assigned} assigned · ${a.started} started · ${a.submitted} submitted</p>
        <div class="row">
          <button type="button" data-assignment="${esc(a.id)}">View progress</button>
          <button type="button" data-qr="${esc(a.id)}">Show full-screen QR</button>
        </div>
      </div>`).join("") || "<p>No class assignments yet.</p>";
    for (const assignment of result.assignments) {
      $("assignmentList").querySelector(`[data-assignment="${CSS.escape(assignment.id)}"]`).onclick =
        () => showAssignment(assignment.id);
      $("assignmentList").querySelector(`[data-qr="${CSS.escape(assignment.id)}"]`).onclick =
        () => showAssignmentQr(assignment.id, assignment.title);
    }
  } catch (error) {
    $("connectionStatus").textContent = error.message;
    if (error.status === 401) {
      assignmentCode = "";
      $("assessmentLogin").hidden = false;
    }
  }
}

$("assessmentLogin").onsubmit = async event => {
  event.preventDefault();
  assignmentCode = $("assessmentTeacherCode").value.trim();
  $("assessmentTeacherCode").value = "";
  await loadAssignments();
  if ($("assessmentLogin").hidden) localStorage.setItem("lategan_teacher_code", assignmentCode);
};

$("assignForm").onsubmit = async event => {
  event.preventDefault();
  syncEditor();
  const classId = Number($("assignmentClass").value);
  const target = assignmentClasses.find(c => Number(c.id) === classId);
  if (!target || !current.title.trim() || !current.questions.length) {
    $("assignmentStatus").textContent = "Add a title and questions, and choose a class.";
    return;
  }
  if (!confirm(`Assign “${current.title}” to ${target.name}? It will appear in Student Hub for the current class roll.`)) return;
  const assessment = structuredClone(current);
  const payload = JSON.stringify({classId, assessment});
  if (pendingAssignment?.payload !== payload) pendingAssignment = {payload, id: crypto.randomUUID()};
  $("assignButton").disabled = true;
  $("assignmentStatus").textContent = "Assigning…";
  try {
    const result = await teacherAssessment("assign", {
      assignment_id: pendingAssignment.id, class_id: classId, assessment
    });
    pendingAssignment = null;
    $("assignmentStatus").textContent = `Assigned to ${result.assigned} students in ${target.name}.`;
    tab("reports");
    await loadAssignments();
    await showAssignment(result.assignment_id);
  } catch (error) {
    $("assignmentStatus").textContent = error.message;
  } finally {
    $("assignButton").disabled = false;
  }
};

$("refreshAssignments").onclick = async () => {
  await loadAssignments();
  if (activeAssignment) await showAssignment(activeAssignment);
};
document.querySelector('[data-tab="reports"]').addEventListener("click", loadAssignments);

async function showAssignment(id) {
  activeAssignment = id;
  responseRequest++;
  $("assignmentReport").replaceChildren();
  $("responseReview").replaceChildren();
  $("reportStatus").textContent = "Loading progress…";
  try {
    const {assessment, counts, students} = await teacherAssessment("results", {assignment_id: id});
    if (activeAssignment !== id) return;
    const maximum = assessment.questions.filter(q => q.type === "mcq").reduce((sum, q) => sum + q.marks, 0);
    $("reportStatus").textContent = "";
    $("assignmentReport").innerHTML = `
      <div class="sectionTitle"><h3>${esc(assessment.title)}</h3>
        <button type="button" id="reportAssignmentQr">Show full-screen QR</button>
      </div>
      <p>${counts.assigned} assigned · ${counts.started} started (including submitted) · ${counts.submitted} submitted</p>
      <table><thead><tr><th>Student</th><th>Status</th><th>Multiple choice</th><th>Responses</th></tr></thead>
      <tbody>${students.map(student => `<tr><td>${esc(student.display_name || "Student")}</td>
        <td>${student.submitted_at ? "Submitted" : student.started_at ? "Started" : "Assigned"}</td>
        <td>${student.submitted_at && maximum ? `${student.mcq_score} / ${maximum}` : "—"}</td>
        <td>${student.started_at ? `<button type="button" data-student="${student.student_id}">View</button>` : "—"}</td></tr>`).join("")}</tbody></table>`;
    $("reportAssignmentQr").onclick = () => showAssignmentQr(id, assessment.title);
    $("assignmentReport").querySelectorAll("[data-student]").forEach(button => {
      const student = students.find(s => String(s.student_id) === button.dataset.student);
      button.onclick = () => showResponse(id, assessment, student);
    });
  } catch (error) {
    if (activeAssignment === id) $("reportStatus").textContent = error.message;
  }
}

function showAssignmentQr(id, title) {
  const dialog = $("assignmentQrDialog");
  const url = new URL("assigned.html", location.href);
  url.searchParams.set("assignment", id);
  $("assignmentQrTitle").textContent = title;
  $("assignmentQrLink").href = url.href;

  const image = $("assignmentQrImage");
  const status = $("assignmentQrStatus");
  image.replaceChildren();
  image.hidden = false;
  status.textContent = "";
  try {
    new QRCode(image, {
      text: url.href, width: 640, height: 640, correctLevel: QRCode.CorrectLevel.M
    });
  } catch {
    image.hidden = true;
    status.textContent = "The QR code couldn’t load. Use the student link below.";
  }

  dialog.showModal();
  dialog.requestFullscreen?.().catch(() => {});
}

$("assignmentQrDialog").addEventListener("close", () => {
  if (document.fullscreenElement === $("assignmentQrDialog")) {
    document.exitFullscreen().catch(() => {});
  }
});

async function showResponse(id, assessment, student) {
  const request = ++responseRequest;
  const target = $("responseReview");
  target.textContent = "Loading response…";
  const identity = {assignment_id: id, student_id: student.student_id};
  try {
    const result = await teacherAssessment("response", identity);
    if (request !== responseRequest) return;
    target.innerHTML = `<h3>${esc(student.display_name || "Student")}</h3><p>${result.submitted_at ? "Submitted responses" : "Draft responses"}</p>`;
    assessment.questions.forEach((q, index) => {
      const panel = document.createElement("div");
      panel.className = "question";
      const raw = result.answers[q.id];
      const answer = q.type === "mcq" && raw ? q.options[Number(raw)] : raw;
      panel.innerHTML = `<h4>${index + 1}. ${esc(q.text)} · ${q.marks} marks</h4><p class="answerText">${esc(answer || "No response")}</p>`;
      target.append(panel);
      if (q.type === "mcq") {
        panel.insertAdjacentHTML("beforeend", `<p>Answer key: ${esc(q.options[Number(q.correct)])}${result.submitted_at ? ` · ${raw === q.correct ? q.marks : 0} / ${q.marks}` : ""}</p>`);
        return;
      }
      if (result.submitted_at) addMarking(panel, q, identity, result.reviews[q.id]);
    });
    target.scrollIntoView({block: "start"});
  } catch (error) {
    if (request === responseRequest) target.textContent = error.message;
  }
}

function addMarking(panel, question, identity, review) {
  if (question.rubric) panel.insertAdjacentHTML("beforeend", `<p class="answerText">Marking guide: ${esc(question.rubric)}</p>`);
  const form = document.createElement("form");
  form.innerHTML = `<label>Mark out of ${question.marks}<input name="mark" type="number" min="0" max="${question.marks}" required></label>
    <label>Feedback<textarea name="feedback" maxlength="1000"></textarea></label>
    <div class="row"><button class="primary">Save teacher mark</button>
    ${question.rubric ? '<button type="button" class="suggest" title="Sends the question, marking guide and written response to the AI marking service">Suggest with AI</button>' : ""}</div>
    <p class="muted" role="status"></p>`;
  panel.append(form);
  const mark = form.elements.mark;
  const feedback = form.elements.feedback;
  const status = form.querySelector("[role=status]");
  const data = {...identity, question_id: question.id};
  mark.value = review?.score ?? "";
  feedback.value = review?.feedback ?? "";
  if (review) status.textContent = "Teacher mark saved.";
  const run = async work => {
    const controls = Array.from(form.elements);
    controls.forEach(control => { control.disabled = true; });
    try { await work(); } catch (error) { status.textContent = error.message; }
    finally { controls.forEach(control => { control.disabled = false; }); }
  };
  form.onsubmit = event => {
    event.preventDefault();
    run(async () => {
      await teacherAssessment("review", {...data, score: Number(mark.value), feedback: feedback.value});
      status.textContent = "Teacher mark saved.";
    });
  };
  const suggest = form.querySelector(".suggest");
  if (suggest) suggest.onclick = () => run(async () => {
    status.textContent = "Requesting a suggested mark…";
    const {suggestion} = await teacherAssessment("suggest", data);
    mark.value = suggestion.score;
    feedback.value = suggestion.feedback;
    status.textContent = "AI suggestion ready. Review it and save the teacher mark.";
  });
}

loadAssignments();
