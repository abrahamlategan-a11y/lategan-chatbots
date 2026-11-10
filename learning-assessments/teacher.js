let assignmentCode = localStorage.getItem("lategan_teacher_code") || "";
let assignmentClasses = [];
let classAssignments = [];
let sharedAssessments = [];
let assignmentSource = null;
let activeAssignment = null;
let resultsTrigger = null;
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
    classAssignments = result.assignments;
    $("assessmentLogin").hidden = true;
    $("connectionStatus").textContent = "";
    renderOtherAssignments();
    return true;
  } catch (error) {
    $("connectionStatus").textContent = error.message;
    if (error.status === 401) {
      assignmentCode = "";
      classAssignments = [];
      renderOtherAssignments();
      closeAssignmentResults();
      $("assessmentLogin").hidden = false;
    }
  }
}

function matchesAssignment(assignment, title, sourceIds, includeLegacy = true) {
  return assignment.source_id ? sourceIds.includes(assignment.source_id) : includeLegacy && assignment.title === title;
}

function renderOtherAssignments() {
  const other = classAssignments.filter(assignment =>
    !templates.some(template => matchesAssignment(assignment, template.title, [template.id, ownedShare(template.id)?.id])) &&
    !sharedAssessments.some(item => matchesAssignment(assignment, item.title,
      [item.id, item.is_owner ? item.template_id : null], Boolean(item.is_owner)))
  );
  $("otherAssignments").hidden = !other.length;
  $("assignmentList").innerHTML = other.map(a => `
    <div class="libraryCard">
      <span class="pill">${esc(a.class_name)}</span><h3>${esc(a.title)}</h3>
      <p>${a.assigned} assigned · ${a.started} started · ${a.submitted} submitted</p>
      <div class="row">
        <button type="button" data-other-results="${esc(a.id)}">Results</button>
        <button type="button" data-other-qr="${esc(a.id)}">Show QR</button>
      </div>
    </div>`).join("");
}

$("assignmentList").addEventListener("click", event => {
  const button = event.target.closest("[data-other-results], [data-other-qr]");
  if (!button) return;
  const assignment = classAssignments.find(a => a.id === (button.dataset.otherResults || button.dataset.otherQr));
  if (!assignment) return;
  if (button.dataset.otherResults) openAssignmentResults(assignment, "library", button);
  else showAssignmentQr(assignment.id, assignment.title);
});

document.addEventListener("assessment-library-updated", renderOtherAssignments);

$("assessmentLogin").onsubmit = async event => {
  event.preventDefault();
  assignmentCode = $("assessmentTeacherCode").value.trim();
  $("assessmentTeacherCode").value = "";
  await loadAssignments();
  if ($("assessmentLogin").hidden) {
    localStorage.setItem("lategan_teacher_code", assignmentCode);
    await loadSharedAssessments();
  }
};

async function openAssign(source) {
  assignmentSource = source;
  $("assignTitle").textContent = source.title;
  $("assignmentStatus").textContent = "Loading classes…";
  $("assignButton").disabled = true;
  if (!$("assignDialog").open) $("assignDialog").showModal();
  const available = await loadAssignments();
  if (assignmentSource !== source || !$("assignDialog").open) return;
  if (!available) {
    $("assignmentStatus").textContent = "Sign in with your teacher code to assign a test.";
    return;
  }
  const selector = $("assignmentClass");
  const selected = selector.value || String(assignmentClasses.find(c => c.name.trim().toUpperCase() === "4L")?.id || "");
  selector.replaceChildren(new Option("Choose a class", ""), ...assignmentClasses.map(c => new Option(c.name, c.id)));
  selector.value = selected;
  $("assignButton").disabled = !assignmentClasses.length;
  $("assignmentStatus").textContent = assignmentClasses.length ? "This test will appear in Student Hub for the selected class." : "You have no classes available.";
}

$("closeAssign").onclick = () => $("assignDialog").close();
$("assignDraft").onclick = () => {
  syncEditor();
  if (!current.title.trim() || !current.questions.length) {
    $("editStatus").textContent = "Add a title and at least one question first.";
    return;
  }
  openAssign({title: current.title, assessment: structuredClone(current), template_id: current.id});
};

$("assignForm").onsubmit = async event => {
  event.preventDefault();
  const classId = Number($("assignmentClass").value);
  const target = assignmentClasses.find(c => Number(c.id) === classId);
  if (!assignmentSource || !target) return;
  const {title, ...source} = assignmentSource;
  const payload = JSON.stringify({classId, source});
  if (pendingAssignment?.payload !== payload) pendingAssignment = {payload, id: crypto.randomUUID()};
  $("assignButton").disabled = true;
  $("closeAssign").disabled = true;
  $("assignmentStatus").textContent = "Assigning…";
  try {
    const result = await teacherAssessment("assign", {
      assignment_id: pendingAssignment.id, class_id: classId, ...source
    });
    pendingAssignment = null;
    $("assignDialog").close();
    const view = source.shared_id ? "shared" : "library";
    tab(view);
    await loadAssignments();
    if (!$(view).classList.contains("hidden")) {
      const assignment = classAssignments.find(a => a.id === result.assignment_id);
      await openAssignmentResults(assignment || {id: result.assignment_id, class_name: target.name}, view);
    }
  } catch (error) {
    $("assignmentStatus").textContent = error.message;
  } finally {
    $("assignButton").disabled = false;
    $("closeAssign").disabled = false;
  }
};
$("assignDialog").addEventListener("cancel", event => {
  if ($("closeAssign").disabled) event.preventDefault();
});

async function loadSharedAssessments() {
  if (!assignmentCode) {
    $("sharedStatus").textContent = "Sign in with your teacher code to see shared assessments.";
    return;
  }
  try {
    const {assessments} = await teacherAssessment("shared_list");
    sharedAssessments = assessments;
    $("sharedStatus").textContent = "";
    $("sharedCards").innerHTML = assessments.map(item => `
      <div class="libraryCard"><span class="pill">${esc(item.subject || "Assessment")}</span>
      <h3>${esc(item.title)}</h3>
      <p class="muted">${esc(item.teacher_name || "Teacher")} · ${item.year ? esc(item.year) + " · " : ""}${item.question_count} questions</p>
      <div class="row">
        <button type="button" class="primary" data-shared-assign="${esc(item.id)}">Assign to class</button>
        <button type="button" data-shared-qr="${esc(item.id)}">Show QR</button>
        <button type="button" data-shared-results="${esc(item.id)}">Results</button>
        ${item.is_owner ? `<button type="button" data-unshare="${esc(item.id)}">Stop sharing</button>` : ""}
      </div></div>`).join("") || "<p>No assessments have been shared yet.</p>";
    updateSharingPill();
    renderOtherAssignments();
  } catch (error) {
    $("sharedCards").replaceChildren();
    $("sharedStatus").textContent = error.message;
  }
}
document.querySelector('[data-tab="shared"]').addEventListener("click", loadSharedAssessments);
document.addEventListener("assessment-editor-opened", () => {
  $("sharingStatus").textContent = "";
  updateSharingPill();
});

function ownedShare(id) {
  return sharedAssessments.find(item => item.is_owner && item.template_id === id);
}

function updateSharingPill() {
  const shared = Boolean(ownedShare(current.id));
  $("shareDraft").setAttribute("aria-pressed", String(shared));
  $("shareDraft").textContent = shared ? "Shared with teachers" : "Share with teachers";
}

async function saveSharing(template, shared, status) {
  await teacherAssessment("share_set", {template_id: template.id, shared, assessment: shared ? template : undefined});
  status.textContent = shared ? "Available in Shared assessments." : "Removed from Shared assessments.";
  await loadSharedAssessments();
}

$("shareDraft").onclick = async () => {
  syncEditor();
  const template = structuredClone(current);
  const shared = !ownedShare(template.id);
  if (!assignmentCode) {
    $("sharingStatus").textContent = "Sign in with your teacher code to share a test.";
    return;
  }
  if (shared && !confirm(`Share “${template.title}” with Learning Hub teachers? They can assign it to their classes.`)) return;
  $("shareDraft").disabled = true;
  try {
    await saveSharing(template, shared, $("sharingStatus"));
    if (shared) {
      const index = templates.findIndex(t => t.id === template.id);
      if (index < 0) templates.push(template);
      else templates[index] = template;
      persist();
      drawLibrary();
      renderOtherAssignments();
    }
  } catch (error) {
    $("sharingStatus").textContent = error.message;
  } finally {
    $("shareDraft").disabled = false;
  }
};

$("saveTemplate").addEventListener("click", async () => {
  if (!ownedShare(current.id) || !current.title.trim() || !current.questions.length) return;
  try {
    await saveSharing(structuredClone(current), true, $("sharingStatus"));
  } catch (error) {
    $("sharingStatus").textContent = "Saved in this browser. Shared version could not update. " + error.message;
  }
});

$("libraryCards").addEventListener("click", event => {
  const button = event.target.closest("[data-assign-template], [data-qr-template], [data-results-template]");
  if (!button) return;
  const template = templates.find(t => t.id === (button.dataset.assignTemplate || button.dataset.qrTemplate || button.dataset.resultsTemplate));
  if (!template) return;
  if (button.dataset.assignTemplate) openAssign({title: template.title, assessment: structuredClone(template), template_id: template.id});
  else chooseClassAssignment(template.title, [template.id, ownedShare(template.id)?.id], true,
    "library", button, Boolean(button.dataset.resultsTemplate));
});

$("sharedCards").addEventListener("click", async event => {
  const button = event.target.closest("[data-shared-assign], [data-shared-qr], [data-shared-results], [data-unshare]");
  if (!button) return;
  const item = sharedAssessments.find(a => a.id === (button.dataset.sharedAssign || button.dataset.sharedQr || button.dataset.sharedResults || button.dataset.unshare));
  if (!item) return;
  if (button.dataset.sharedAssign) openAssign({title: item.title, shared_id: item.id});
  else if (button.dataset.sharedQr || button.dataset.sharedResults) {
    chooseClassAssignment(item.title, [item.id, item.is_owner ? item.template_id : null], Boolean(item.is_owner),
      "shared", button, Boolean(button.dataset.sharedResults));
  }
  else {
    button.disabled = true;
    try {
      await saveSharing({id: item.template_id}, false, $("sharedStatus"));
    } catch (error) {
      $("sharedStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
});

async function chooseClassAssignment(title, sourceIds, includeLegacy, view, trigger, results) {
  const available = await loadAssignments();
  if ($(view).classList.contains("hidden")) return;
  const matches = available ? classAssignments.filter(a => matchesAssignment(a, title, sourceIds, includeLegacy)) : [];
  const open = assignment => {
    if (results) openAssignmentResults(assignment, view, trigger);
    else showAssignmentQr(assignment.id, title);
  };
  if (matches.length === 1) {
    open(matches[0]);
    return;
  }
  $("chooseClassTitle").textContent = results ? "Assessment results" : "Show assessment QR";
  $("chooseClassStatus").textContent = !available
    ? "Sign in with your teacher code to see class assignments."
    : matches.length ? "Choose a class assignment."
    : results ? "Assign this test to a class first to see its results."
    : "Assign this test to a class first to get its QR code.";
  $("chooseClassOptions").replaceChildren(...matches.map(a => {
    const button = document.createElement("button");
    button.type = "button";
    const date = new Date(a.assigned_at.replace(" ", "T") + "Z");
    button.textContent = a.class_name + " · " + date.toLocaleString("en-AU", {
      timeZone: "Australia/Perth", dateStyle: "short", timeStyle: "short"
    });
    button.onclick = () => {
      $("chooseClassDialog").close();
      open(a);
    };
    return button;
  }));
  if (!$("chooseClassDialog").open) $("chooseClassDialog").showModal();
}

function openAssignmentResults(assignment, view, trigger) {
  resultsTrigger = trigger;
  const panel = $("assessmentResults");
  $(view === "shared" ? "sharedResultsHost" : "libraryResultsHost").append(panel);
  $("resultsHeading").textContent = assignment.class_name ? `Assessment results · ${assignment.class_name}` : "Assessment results";
  panel.hidden = false;
  $("resultsHeading").focus({preventScroll: true});
  panel.scrollIntoView({block: "start"});
  return showAssignment(assignment.id);
}

function closeAssignmentResults() {
  activeAssignment = null;
  responseRequest++;
  closeWrittenGrid();
  $("assessmentResults").hidden = true;
  $("assignmentReport").replaceChildren();
  $("responseReview").replaceChildren();
}

$("closeAssignmentResults").onclick = () => {
  closeAssignmentResults();
  if (resultsTrigger?.isConnected) resultsTrigger.focus();
  else document.querySelector(".tabs button.active")?.focus();
};
$("refreshAssignments").onclick = async () => {
  const id = activeAssignment;
  if (!id) return;
  await loadAssignments();
  if (activeAssignment === id) await showAssignment(id);
};
document.addEventListener("assessment-tab-changed", closeAssignmentResults);

async function showAssignment(id) {
  closeWrittenGrid();
  activeAssignment = id;
  const request = ++responseRequest;
  $("assignmentReport").replaceChildren();
  $("responseReview").replaceChildren();
  $("reportStatus").textContent = "Loading progress…";
  try {
    const {assessment, counts, students} = await teacherAssessment("results", {assignment_id: id});
    if (request !== responseRequest) return;
    const maximum = assessment.questions.filter(q => q.type === "mcq").reduce((sum, q) => sum + q.marks, 0);
    const hasWritten = assessment.questions.some(q => q.type !== "mcq");
    $("reportStatus").textContent = "";
    $("assignmentReport").innerHTML = `
      <div class="sectionTitle"><h3>${esc(assessment.title)}</h3>
        <div class="row">
          ${hasWritten ? '<button type="button" class="primary" id="openWrittenGrid">Written marking grid</button>' : ""}
          <button type="button" id="reportAssignmentQr">Show full-screen QR</button>
        </div>
      </div>
      <p>${counts.assigned} assigned · ${counts.started} started (including submitted) · ${counts.submitted} submitted</p>
      <table><thead><tr><th>Student</th><th>Status</th><th>Multiple choice</th>${hasWritten ? "<th>Written marking</th>" : ""}<th>Responses</th></tr></thead>
      <tbody>${students.map(student => `<tr><td>${esc(student.display_name || "Student")}</td>
        <td>${student.submitted_at ? "Submitted" : student.started_at ? "Started" : "Assigned"}</td>
        <td>${student.submitted_at && maximum ? `${student.mcq_score} / ${maximum}` : "—"}</td>
        ${hasWritten ? `<td data-written-status="${student.student_id}">${student.submitted_at ? writtenStatus(student.ai_status) : "—"}</td>` : ""}
        <td>${student.started_at ? `<button type="button" data-student="${student.student_id}">View</button>` : "—"}</td></tr>`).join("")}</tbody></table>`;
    $("reportAssignmentQr").onclick = () => showAssignmentQr(id, assessment.title);
    if (hasWritten) $("openWrittenGrid").onclick = () => openWrittenGrid(id, assessment, students);
    $("assignmentReport").querySelectorAll("[data-student]").forEach(button => {
      const student = students.find(s => String(s.student_id) === button.dataset.student);
      button.onclick = () => showResponse(id, assessment, student);
    });
  } catch (error) {
    if (request === responseRequest) $("reportStatus").textContent = error.message;
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

  if (!dialog.open) dialog.showModal();
  dialog.requestFullscreen?.().catch(() => {});
}

$("assignmentQrDialog").addEventListener("close", () => {
  if (document.fullscreenElement === $("assignmentQrDialog")) {
    document.exitFullscreen().catch(() => {});
  }
});

function writtenStatus(state) {
  if (state === "marked") return "Marked";
  if (state === "marking") return "Marking…";
  if (state === "needs_review") return "Check marks";
  return "Pending";
}

async function showResponse(id, assessment, student) {
  const request = ++responseRequest;
  const target = $("responseReview");
  target.textContent = "Loading response…";
  const identity = {assignment_id: id, student_id: student.student_id};
  try {
    const result = await teacherAssessment("response", identity);
    if (request !== responseRequest) return;
    target.innerHTML = `<h3>${esc(student.display_name || "Student")}</h3><p>${result.submitted_at ? "Submitted responses" : "Draft responses"}</p>`;
    const writtenForms = new Map();
    const reviews = result.reviews;
    const progress = document.createElement("p");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry missing AI marks";
    retry.hidden = true;
    progress.setAttribute("role", "status");
    if (result.submitted_at && assessment.questions.some(q => q.type !== "mcq")) target.append(progress, retry);
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
      if (result.submitted_at) {
        writtenForms.set(q.id, addMarking(panel, q, identity, reviews[q.id], review => {
          reviews[q.id] = review;
          displayStatus();
        }));
      }
    });
    let aiStatus = result.ai_status;
    let aiMarks = result.ai_marks || {};
    function displayStatus() {
      if (!writtenForms.size) return;
      const missing = [...writtenForms.keys()].filter(q => !reviews[q] && !aiMarks[q]).length;
      retry.hidden = aiStatus !== "needs_review" || !missing;
      progress.textContent = !missing ? "Written marks are ready to review."
        : aiStatus === "marking" ? "AI is marking the written responses…"
        : "Some responses still need a mark. You can mark them yourself or retry AI marking.";
      const cell = $("assignmentReport").querySelector(`[data-written-status="${student.student_id}"]`);
      if (cell) cell.textContent = !missing ? "Marked" : writtenStatus(aiStatus);
    }
    function applyAi(result) {
      aiStatus = result.ai_status;
      aiMarks = result.ai_marks || {};
      for (const [id, update] of writtenForms) update(aiMarks[id]);
      displayStatus();
    }
    async function pollAi() {
      for (let attempt = 0; attempt < 14 && aiStatus === "marking"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2200));
        if (request !== responseRequest) return;
        try {
          const update = await teacherAssessment("response", identity);
          if (request !== responseRequest) return;
          applyAi(update);
        } catch {
          break;
        }
      }
      if (request === responseRequest && aiStatus === "marking") {
        progress.textContent = "AI is still marking. Reopen this response to check again.";
      }
    }
    retry.onclick = async () => {
      retry.disabled = true;
      progress.textContent = "Retrying AI marking…";
      try {
        const update = await teacherAssessment("retry_ai", identity);
        if (request !== responseRequest) return;
        applyAi(update);
        await pollAi();
      } catch (error) {
        progress.textContent = error.message;
      } finally {
        retry.disabled = false;
      }
    };
    if (writtenForms.size) {
      applyAi(result);
      pollAi();
    }
    target.scrollIntoView({block: "start"});
  } catch (error) {
    if (request === responseRequest) target.textContent = error.message;
  }
}

function addMarking(panel, question, identity, review, onSave, compact = false) {
  if (question.rubric && !compact) panel.insertAdjacentHTML("beforeend", `<p class="answerText">Marking guide: ${esc(question.rubric)}</p>`);
  const automatic = document.createElement("p");
  automatic.className = "answerText muted";
  automatic.hidden = true;
  panel.append(automatic);
  const form = document.createElement("form");
  form.innerHTML = `<label>${compact ? "Teacher mark / " : "Mark out of "}${question.marks}<input name="mark" type="number" min="0" max="${question.marks}" required></label>
    <label>${compact ? "Teacher feedback" : "Feedback"}<textarea name="feedback" maxlength="1000"></textarea></label>
    <button class="primary">${compact ? "Save override" : "Save teacher mark"}</button>
    <p class="muted" role="status"></p>`;
  panel.append(form);
  const mark = form.elements.mark;
  const feedback = form.elements.feedback;
  const status = form.querySelector("[role=status]");
  const data = {...identity, question_id: question.id};
  mark.value = review?.score ?? "";
  feedback.value = review?.feedback ?? "";
  let edited = false;
  form.addEventListener("input", () => { edited = true; });
  const savedMessage = compact ? "Override saved" : "Teacher mark saved and used for this response.";
  if (review) status.textContent = savedMessage;
  const run = async work => {
    const controls = Array.from(form.elements);
    controls.forEach(control => { control.disabled = true; });
    try { await work(); } catch (error) { status.textContent = error.message; }
    finally { controls.forEach(control => { control.disabled = false; }); }
  };
  form.onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const saved = await teacherAssessment("review", {...data, score: Number(mark.value), feedback: feedback.value});
      review = saved.review;
      status.textContent = savedMessage;
      onSave(review);
    });
  };
  return ai => {
    if (!ai) return;
    automatic.hidden = false;
    automatic.textContent = `${ai.blank ? "Automatic mark" : "AI mark"}: ${ai.score} / ${question.marks} · ${ai.feedback}`;
    if (!review && !edited) {
      mark.value = ai.score;
      feedback.value = ai.feedback;
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  loadAssignments();
  loadSharedAssessments();
});
