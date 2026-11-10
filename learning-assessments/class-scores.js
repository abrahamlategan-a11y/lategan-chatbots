let classScoreReport = null;
let activeScoreQuestion = null;

function renderClassScores(assignmentId, assessment, students) {
  const root = $("classScoreTable");
  const questions = assessment.questions.map((q, index) => ({...q, number: index + 1}))
    .filter(q => q.type !== "mcq");
  const mcqMax = assessment.questions.filter(q => q.type === "mcq").reduce((sum, q) => sum + q.marks, 0);
  const maximum = assessment.questions.reduce((sum, q) => sum + q.marks, 0);
  const report = {assignmentId, assessment, questions, mcqMax, maximum, root, rows: [], entries: new Map()};
  classScoreReport = report;
  const headings = ["Student", ...(mcqMax ? ["Multiple choice"] : []), ...questions.map(q => "Q" + q.number), "Total", "%"];
  root.innerHTML = `<table aria-label="Class marks"><thead><tr>${headings.map(name =>
    `<th scope="col">${name}</th>`).join("")}</tr></thead><tbody></tbody></table>`;
  const body = root.querySelector("tbody");
  for (const student of students) {
    const row = body.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    const status = document.createElement("span");
    status.className = "muted scoreStatus";
    status.textContent = submissionStatus(student);
    if (student.started_at || student.submitted_at) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "studentScoreLink";
      open.textContent = student.display_name || "Student";
      open.onclick = () => showResponse(assignmentId, assessment, student);
      name.append(open, status);
    } else {
      name.append(student.display_name || "Student", status);
    }
    row.append(name);
    const mcq = mcqMax ? row.insertCell() : null;
    const written = questions.map(question => {
      const cell = row.insertCell();
      const button = document.createElement("button");
      button.type = "button";
      button.onclick = () => openClassScoreQuestion(report, student, question);
      cell.append(button);
      return button;
    });
    report.rows.push({student, status, mcq, written, total: row.insertCell(), percent: row.insertCell()});
  }
  $("exportClassScores").onclick = () => exportClassScores(report);
  updateClassScores(assignmentId, report.entries);
}

function submissionStatus(student) {
  return student.submitted_at ? "Submitted" : student.started_at ? "In progress" : "Not started";
}

function studentScores(report, student) {
  const entry = report.entries.get(student.student_id);
  const submitted = Boolean(student.submitted_at || entry);
  const mcq = submitted && Number.isFinite(student.mcq_score) ? student.mcq_score : null;
  const written = report.questions.map(q => {
    const review = entry?.reviews[q.id];
    const mark = review ?? entry?.ai_marks[q.id];
    return {score: mark?.score ?? null, provisional: Boolean(mark && !review)};
  });
  const complete = submitted && (!report.mcqMax || mcq !== null) && written.every(mark => mark.score !== null);
  const total = complete ? (mcq ?? 0) + written.reduce((sum, mark) => sum + mark.score, 0) : null;
  const percent = total === null || !report.maximum ? null : Math.round(1000 * total / report.maximum) / 10;
  return {submitted, entry, mcq, written, total, percent, provisional: written.some(mark => mark.provisional)};
}

function updateClassScores(assignmentId, entries) {
  const report = classScoreReport;
  if (!report || report.assignmentId !== assignmentId || !report.root.isConnected) return;
  report.entries = entries;
  for (const row of report.rows) {
    const scores = studentScores(report, row.student);
    if (scores.submitted) row.status.textContent = "Submitted";
    if (row.mcq) row.mcq.textContent = scores.mcq === null ? "—" : `${scores.mcq} / ${report.mcqMax}`;
    row.written.forEach((button, index) => {
      const mark = scores.written[index];
      const question = report.questions[index];
      const label = mark.score === null ? scores.submitted ? "Pending" : "—" : `${mark.score} / ${question.marks}`;
      button.textContent = mark.provisional ? label + " *" : label;
      button.classList.toggle("provisionalScore", mark.provisional);
      button.disabled = !scores.entry;
      button.setAttribute("aria-label", `Question ${question.number}, ${row.student.display_name || "student"}: ${label}${mark.provisional ? ", suggested mark" : ""}`);
    });
    row.total.textContent = scores.total === null ? "—" : `${scores.total} / ${report.maximum}${scores.provisional ? " *" : ""}`;
    row.percent.textContent = scores.percent === null ? "—" : `${scores.percent}%${scores.provisional ? " *" : ""}`;
  }
  if (activeScoreQuestion?.report === report) {
    const {studentId, questionId, update} = activeScoreQuestion;
    update(entries.get(studentId)?.ai_marks[questionId]);
  }
}

function openClassScoreQuestion(report, student, question) {
  const entry = report.entries.get(student.student_id);
  if (!entry) return;
  $("scoreQuestionTitle").textContent = `Q${question.number} · ${student.display_name || "Student"}`;
  const body = $("scoreQuestionBody");
  body.innerHTML = `<p class="answerText">${esc(question.text)}</p>
    <p class="answer answerText">${esc(entry.answers[question.id] || "No response")}</p>`;
  const update = addMarking(body, question, {assignment_id: report.assignmentId, student_id: student.student_id},
    entry.reviews[question.id], review => recordWrittenReview(report.assignmentId, student.student_id, question.id, review));
  activeScoreQuestion = {report, studentId: student.student_id, questionId: question.id, update};
  update(entry.ai_marks[question.id]);
  $("scoreQuestionDialog").showModal();
}

function closeClassScoreQuestion() {
  activeScoreQuestion = null;
  if ($("scoreQuestionDialog").open) $("scoreQuestionDialog").close();
}

$("scoreQuestionDialog").addEventListener("close", () => { activeScoreQuestion = null; });

function exportClassScores(report) {
  const headers = ["Student", "Status",
    ...(report.mcqMax ? [`Multiple choice (out of ${report.mcqMax})`] : []),
    ...report.questions.map(q => `Q${q.number} (out of ${q.marks})`),
    `Total (out of ${report.maximum})`, "Percentage", "Marking status"];
  const rows = report.rows.map(({student}) => {
    const marks = studentScores(report, student);
    const status = !marks.submitted ? "" : marks.total === null ? "Incomplete"
      : marks.provisional ? "Provisional" : "Complete";
    return [student.display_name || "Student", marks.submitted ? "Submitted" : submissionStatus(student),
      ...(report.mcqMax ? [marks.mcq] : []), ...marks.written.map(mark => mark.score),
      marks.total, marks.percent, status];
  });
  const csvCell = value => {
    if (value == null) return "";
    if (typeof value === "number") return String(value);
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const className = classAssignments.find(a => a.id === report.assignmentId)?.class_name;
  const filename = [report.assessment.title, className, "results"].filter(Boolean).join(" - ")
    .replace(/[^a-z0-9 _-]/gi, "").trim() + ".csv";
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
