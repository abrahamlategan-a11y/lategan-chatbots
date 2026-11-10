let writtenGrid = null;

function closeWrittenGrid() {
  writtenGrid = null;
  $("writtenGrid").hidden = true;
  $("assignmentReport").hidden = false;
  $("responseReview").hidden = false;
  $("writtenGridTable").replaceChildren();
}

$("closeWrittenGrid").onclick = () => {
  closeWrittenGrid();
  $("openWrittenGrid")?.focus();
};

function openWrittenGrid(assignmentId, assessment, students) {
  responseRequest++;
  const questions = assessment.questions
    .map((question, index) => ({...question, number: index + 1}))
    .filter(question => question.type !== "mcq");
  const rows = new Map();
  const table = $("writtenGridTable");
  table.innerHTML = `<thead><tr><th scope="col">Student</th>${questions.map(q =>
    `<th scope="col">Q${q.number} · ${q.marks} ${q.marks === 1 ? "mark" : "marks"}
      <span class="gridQuestion">${esc(q.text)}</span></th>`).join("")}</tr></thead><tbody></tbody>`;
  const body = table.tBodies[0];
  for (const student of students) {
    const row = body.insertRow();
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = student.display_name || "Student";
    const status = document.createElement("p");
    status.className = "muted";
    status.textContent = student.submitted_at ? "Submitted" : student.started_at ? "In progress" : "Not started";
    heading.append(status);
    row.append(heading);
    const cells = questions.map(q => {
      const cell = row.insertCell();
      cell.textContent = student.submitted_at ? "Loading…" : "Awaiting submission";
      return {question: q, cell, update: null};
    });
    rows.set(student.student_id, {status, cells});
  }
  $("assignmentReport").hidden = true;
  $("responseReview").hidden = true;
  const className = classAssignments.find(assignment => assignment.id === assignmentId)?.class_name;
  $("writtenGridAssessment").textContent = className ? assessment.title + " · " + className : assessment.title;
  $("writtenGrid").hidden = false;
  const grid = {assignmentId, rows, loading: false, pending: false};
  writtenGrid = grid;
  $("closeWrittenGrid").focus();
  refreshWrittenGrid(grid, true);
}

function applyWrittenGridRow(grid, entry) {
  const row = grid.rows.get(entry.student_id);
  if (!row) return;
  row.status.textContent = entry.ai_status === "needs_review" ? "Some marks need review" : writtenStatus(entry.ai_status);
  for (const item of row.cells) {
    const {question, cell} = item;
    const ai = entry.ai_marks[question.id];
    const review = entry.reviews[question.id];
    if (!item.update) {
      cell.replaceChildren();
      const answer = document.createElement("p");
      answer.className = "answerText gridAnswer";
      answer.textContent = entry.answers[question.id] || "No response";
      cell.append(answer);
      const pending = document.createElement("p");
      pending.className = "muted";
      cell.append(pending);
      let overridden = Boolean(review);
      const updateMark = addMarking(cell, question, {
        assignment_id: grid.assignmentId, student_id: entry.student_id
      }, review, () => {
        overridden = true;
        pending.hidden = true;
      }, true);
      item.update = (mark, state) => {
        updateMark(mark);
        pending.textContent = state === "marking" ? "AI marking…" : "Needs a mark";
        pending.hidden = Boolean(mark || overridden);
      };
    }
    item.update(ai, entry.ai_status);
  }
}

async function refreshWrittenGrid(grid, poll = false) {
  if (!grid || grid !== writtenGrid || grid.loading) return;
  grid.loading = true;
  $("refreshWrittenGrid").disabled = true;
  $("writtenGridStatus").textContent = "Loading written marks…";
  try {
    let pending = false;
    let after = null;
    do {
      const page = await teacherAssessment("written_grid", {
        assignment_id: grid.assignmentId, after_student_id: after
      });
      if (grid !== writtenGrid) return;
      for (const entry of page.rows) {
        applyWrittenGridRow(grid, entry);
        if (entry.ai_status === "marking") pending = true;
      }
      after = page.next_student_id;
    } while (after !== null);
    grid.pending = pending;
    $("writtenGridStatus").textContent = pending
      ? "AI is still marking some responses. You can review or override marks as they arrive."
      : "Review the AI rationale and save any changes in the same cell.";
  } catch (error) {
    grid.pending = false;
    if (grid === writtenGrid) $("writtenGridStatus").textContent = error.message;
  } finally {
    grid.loading = false;
    if (grid === writtenGrid) $("refreshWrittenGrid").disabled = false;
  }
  if (!poll) return;
  for (let attempt = 0; attempt < 6 && grid.pending; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    if (grid !== writtenGrid || $("assessmentResults").hidden) return;
    await refreshWrittenGrid(grid);
  }
}

$("refreshWrittenGrid").onclick = () => refreshWrittenGrid(writtenGrid);
