const classCommentSets = new Map();
let openCommentSet;

function markedCommentResults(test) {
 const marksByStudent = new Map(results.filter(result =>
  Number(result.test ?? result.test_number) === test && Array.isArray(result.marks) && result.marks.length === 40
 ).map(result => [Number(result.student_id), result]));
 return students.filter(student => marksByStudent.has(Number(student.id))).map(student => ({
  student,
  summary: mathsTrekSummary([marksByStudent.get(Number(student.id))], metadata)
 }));
}

function updateClassCommentProgress(set) {
 if (openCommentSet !== set) return;
 const approved = set.rows.filter(row => row.approved).length;
 const generating = set.rows.filter(row => row.pending || row.running).length;
 el("classCommentProgress").textContent = approved + " of " + set.rows.length + " approved" +
  (generating ? " · " + generating + " drafting" : "") +
  (set.unmarked ? " · " + set.unmarked + " without saved marks" : "");
 el("downloadClassComments").disabled = !approved;
}

function anonymiseCommentInput(text, name) {
 const firstName = name.trim().split(/\s+/)[0];
 for (const value of new Set([name, firstName])) {
  if (value) text = text.replaceAll(new RegExp(
   "(?<![\\p{L}\\p{N}])" + RegExp.escape(value) + "(?![\\p{L}\\p{N}])", "giu"
  ), "[[STUDENT]]");
 }
 return text;
}

async function generateClassComment(set, row, feedback = "", revise = false) {
 row.pending = false;
 row.running = true;
 row.error = "";
 row.preview = "";
 row.refresh();
 updateClassCommentProgress(set);
 try {
  const name = row.student.display_name;
  const response = await post({
   action: "lh_assessment_teacher_maths_comment",
   student_id: Number(row.student.id),
   test_number: set.test,
   teacher_feedback: anonymiseCommentInput(feedback, name),
   previous_draft: revise ? anonymiseCommentInput(row.draft, name) : ""
  });
  const draft = response.comment.replaceAll("[[STUDENT]]", () => name);
  if (row.draft) row.preview = draft;
  else row.draft = draft;
 } catch (error) {
  row.error = error.message;
 } finally {
  row.running = false;
  row.refresh();
  updateClassCommentProgress(set);
 }
}

function renderClassCommentRow(set, row) {
 const name = row.student.display_name;
 const section = reportNode("section", null, "classCommentRow");
 const heading = reportNode("h3", name + " · " + row.summary.total + " / " + row.summary.available);
 const state = reportNode("p", null, "sub");
 state.setAttribute("role", "status");
 const draft = reportNode("textarea");
 draft.rows = 3;
 draft.setAttribute("aria-label", name + " comment");
 const actions = reportNode("div", null, "toolbar");
 const approve = reportNode("button", "Approve");
 const regenerate = reportNode("button", "Regenerate", "secondary");
 const edit = reportNode("details");
 const editLabel = reportNode("summary", "Ask AI for edits");
 const feedback = reportNode("textarea");
 feedback.rows = 2;
 feedback.maxLength = 500;
 feedback.placeholder = "For example, remind them to check each answer.";
 feedback.setAttribute("aria-label", "AI edit request for " + name);
 const requestEdit = reportNode("button", "Request edit", "secondary");
 const preview = reportNode("div", null, "commentSuggestion");
 const previewText = reportNode("p");
 const use = reportNode("button", "Use suggestion", "secondary");
 preview.append(reportNode("strong", "AI suggestion"), previewText, use);
 edit.append(editLabel, feedback, reportNode("p", "Leave out identifying details in comments and requests sent to AI.", "sub"), requestEdit);
 actions.append(approve, regenerate, edit);
 section.append(heading, state, draft, actions, preview);

 row.refresh = () => {
  const waiting = row.pending || row.running;
  if (draft.value !== row.draft) draft.value = row.draft;
  state.textContent = waiting ? (row.pending ? "Waiting to draft…" : "Drafting with AI…") :
   row.error || (row.approved ? "Approved" : row.draft ? "Ready for review" : "Enter a comment or retry AI.");
  draft.disabled = row.pending;
  approve.disabled = waiting || !row.draft.trim();
  approve.textContent = row.approved ? "Undo approval" : "Approve";
  regenerate.disabled = waiting;
  regenerate.textContent = row.draft ? "Regenerate" : "Retry AI";
  requestEdit.disabled = waiting || !feedback.value.trim();
  preview.hidden = !row.preview;
  previewText.textContent = row.preview;
 };
 draft.oninput = () => {
  row.draft = draft.value;
  row.approved = false;
  row.refresh();
  updateClassCommentProgress(set);
 };
 approve.onclick = () => {
  row.approved = !row.approved;
  row.refresh();
  updateClassCommentProgress(set);
 };
 feedback.oninput = row.refresh;
 regenerate.onclick = () => generateClassComment(set, row, "", true);
 requestEdit.onclick = () => generateClassComment(set, row, feedback.value.trim(), true);
 use.onclick = () => {
  row.draft = row.preview;
  row.preview = "";
  row.approved = false;
  row.refresh();
  updateClassCommentProgress(set);
  draft.focus();
 };
 row.refresh();
 return section;
}

function showClassCommentSet(test) {
 const marked = markedCommentResults(test);
 if (!marked.length) return;
 const classPicker = el("class");
 const key = JSON.stringify([classPicker.value, test]);
 let set = classCommentSets.get(key);
 const isNew = !set;
 if (isNew) {
  set = {
   test,
   className: classPicker.selectedOptions[0].textContent,
   unmarked: students.length - marked.length,
   rows: marked.map(result => ({...result, draft: "", preview: "", pending: true, approved: false}))
  };
  classCommentSets.set(key, set);
 }
 openCommentSet = set;
 el("reports").hidden = true;
 classPicker.closest(".panel").hidden = true;
 el("classComments").hidden = false;
 el("classCommentsTitle").textContent = set.className + " · Test " + test + " comments";
 el("classCommentRows").replaceChildren(...set.rows.map(row => renderClassCommentRow(set, row)));
 updateClassCommentProgress(set);
 el("classCommentsTitle").focus();
 if (isNew) {
  const queue = [...set.rows];
  async function draftNext() {
   while (queue.length) await generateClassComment(set, queue.shift());
  }
  const workers = Math.min(3, queue.length);
  for (let i = 0; i < workers; i++) void draftNext();
 }
}

el("openClassComments").onclick = () => {
 const eligible = [1, 2, 3, 4].filter(test => markedCommentResults(test).length);
 if (!eligible.length) {
  message("Save marks for at least one student in this class before generating comments.");
  return;
 }
 const selected = selectedReportTests();
 const tests = selected.length ? eligible.filter(test => selected.includes(test)) : eligible;
 if (!tests.length) {
  message("The selected tests have no saved marks for this class.");
  return;
 }
 if (tests.length === 1) {
  showClassCommentSet(tests[0]);
  return;
 }
 options("commentTestNumber", tests.map(test => ({test, label: "Test " + test})), "test", "label");
 el("commentTestPicker").showModal();
};
el("commentTestForm").onsubmit = event => {
 event.preventDefault();
 el("commentTestPicker").close();
 showClassCommentSet(Number(el("commentTestNumber").value));
};
el("cancelCommentTest").onclick = () => el("commentTestPicker").close();
el("backFromComments").onclick = () => {
 openCommentSet = undefined;
 el("classComments").hidden = true;
 el("class").closest(".panel").hidden = false;
 el("reports").hidden = false;
 el("openClassComments").focus();
};
el("downloadClassComments").onclick = () => {
 const set = openCommentSet;
 const approved = set.rows.filter(row => row.approved);
 if (!approved.length) return;
 const rows = [["Student", "Class", "Test", "Score", "Comment"], ...approved.map(row => [
  row.student.display_name, set.className, set.test, row.summary.total + " / " + row.summary.available, row.draft.trim()
 ])];
 mathsTrekDownloadCsv(rows, "maths-trek-test-" + set.test + "-class-comments.csv");
};
