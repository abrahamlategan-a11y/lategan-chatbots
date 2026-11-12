import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE teachers(id INTEGER PRIMARY KEY, teacher_code TEXT, active INTEGER, display_name TEXT);
  CREATE TABLE classes(id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
  CREATE TABLE teacher_classes(teacher_id INTEGER, class_id INTEGER);
  CREATE TABLE students(id INTEGER PRIMARY KEY, student_code TEXT, class_id INTEGER, active INTEGER, display_name TEXT);
  INSERT INTO teachers VALUES(1,'teacher',1,'Teacher One'),(2,'other-teacher',1,'Teacher Two');
  INSERT INTO classes VALUES(10,'4L',1),(11,'4A',1);
  INSERT INTO teacher_classes VALUES(1,10),(2,11);
  INSERT INTO students VALUES(101,'one',10,1,'One'),(102,'two',10,1,'Two'),
    (103,'other-student',11,1,'Other'),(104,'inactive',10,0,'Inactive');
`);
db.exec(`
  ALTER TABLE students ADD COLUMN teacher_id INTEGER;
  UPDATE students SET teacher_id=CASE class_id WHEN 10 THEN 1 ELSE 2 END;
  CREATE TABLE maths_trek_results(student_id INTEGER, teacher_id INTEGER, test_number INTEGER, marks_json TEXT);
  INSERT INTO maths_trek_results VALUES(101,1,1,'${JSON.stringify(Array(40).fill(1))}');
`);
for (let n = 0; n < 2; n++) db.exec(read("./schema.sql"));

const env = {DB: {
  prepare(sql) {
    return {bind(...params) {
      const statement = db.prepare(sql);
      return {
        async first() { return statement.get(...params) || null; },
        async all() { return {results: statement.all(...params)}; },
        async run() { return {meta: statement.run(...params)}; }
      };
    }};
  },
  async batch(statements) {
    db.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}};
const getTeacher = (_, code) => db.prepare("SELECT id FROM teachers WHERE active=1 AND teacher_code=?").get(code);
const getStudent = (_, code) => db.prepare("SELECT id,class_id FROM students WHERE active=1 AND student_code=?").get(code);
const teacherClasses = (_, id) => db.prepare("SELECT c.* FROM classes c JOIN teacher_classes t ON c.id=t.class_id WHERE t.teacher_id=? AND c.active=1").all(id);
const teacherClassAccess = (_, id, classId) => teacherClasses(_, id).find(c => c.id === classId);
let openHours = true;
let providerCalls = 0;
let providerFails = false;
let receivedCommentEvidence;
const background = [];
const context = {waitUntil(work) { background.push(work); }};
async function drainBackground() {
  while (background.length) await Promise.all(background.splice(0));
}
env.OPENAI_API_KEY = "local-test-only";
const handle = new Function("getTeacher", "getStudent", "teacherClasses", "teacherClassAccess", "perthStudentAccessOpen",
  "studentHoursClosedResponse", "fetch", `return async function(body, env, assessmentContext) {
    const action = body.action;
    const json = (data, status=200) => Response.json(data, {status});
    ${read("./worker-actions.js.txt").replace("/* MATHS_TREK_QUESTION_METADATA */ []", read("../../assessments/question-metadata.json"))}
    throw Error("Unhandled action");
  }`)(getTeacher, getStudent, teacherClasses, teacherClassAccess, () => openHours,
    json => json({error: "Closed"}, 403), async (url, request) => {
      providerCalls++;
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const payload = JSON.parse(request.body);
      assert.equal(payload.store, false);
      const items = JSON.parse(payload.messages[1].content);
      if (items.test === 1) {
        assert.equal(items.score, 40);
        const {teacherFeedback, ...results} = items;
        assert.deepEqual(Object.keys(results).sort(), ["maximum", "nextSteps", "score", "strengths", "test"]);
        receivedCommentEvidence = items;
        if (providerFails) return new Response(null, {status: 503});
        return Response.json({choices: [{message: {content: "[[STUDENT]] scored 40 out of 60."}}]});
      }
      for (const item of items) assert.deepEqual(Object.keys(item).sort(), ["answer", "guide", "id", "maximum", "question"]);
      if (providerFails) return new Response(null, {status: 503});
      const marks = items.map(item => ({id: item.id, score: 2, feedback: "Clear answer."}));
      return Response.json({choices: [{message: {content: JSON.stringify({marks})}}]});
    });
const assignment_id = crypto.randomUUID();
const action = async (role, operation, data, code, expected = 200) => {
  const response = await handle({action: `lh_assessment_${role}_${operation}`,
    assignment_id, [role + "_code"]: code, ...data}, env, context);
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
};
const teacher = (op, data = {}, expected = 200, code = "teacher") => action("teacher", op, data, code, expected);
const student = (op, data = {}, expected = 200, code = "one") => action("student", op, data, code, expected);
const assessment = {title: "Test assessment", questions: [
  {type: "mcq", text: "Choose the correct option.", marks: 1, options: ["A", "B"], correct: "0"},
  {type: "short", text: "Explain your choice.", marks: 2, rubric: "Give a clear reason."}
]};
const assignment = {class_id: 10, assessment};
await teacher("list", {}, 401, "bad");
await teacher("assign", {...assignment, class_id: 11}, 403);
assert.equal((await teacher("list")).classes[0].name, "4L");
assert.equal((await teacher("assign", assignment)).assigned, 2);
db.exec("INSERT INTO students(id,student_code,class_id,active,display_name) VALUES(105,'new',10,1,'New')");
assert.equal((await teacher("assign", assignment)).assigned, 2);
await teacher("assign", {...assignment, assessment: {...assessment, title: "Changed"}}, 409);
await teacher("results", {}, 404, "other-teacher");
assert.deepEqual((await teacher("results")).counts, {assigned: 2, started: 0, submitted: 0});
assert.equal((await student("list")).assignments.length, 1);
assert.equal((await student("list", {}, 200, "other-student")).assignments.length, 0);
await student("open", {}, 404, "other-student");
openHours = false;
await student("list", {}, 403);
openHours = true;
const opened = await student("open");
assert.equal(opened.revision, 0);
assert.ok(!JSON.stringify(opened).includes('"correct":'));
assert.ok(!JSON.stringify(opened).includes('"rubric":'));
assert.deepEqual((await teacher("results")).counts, {assigned: 2, started: 1, submitted: 0});
const answers = {"1": "0", "2": "A reasonable explanation."};
assert.equal((await student("save", {revision: 0, answers})).revision, 1);
assert.deepEqual((await student("open")).answers, answers);
await student("save", {revision: 0, answers}, 409);
assert.deepEqual((await teacher("response", {student_id: 101})).answers, answers);
await teacher("review", {student_id: 101, question_id: "2", score: 1}, 409);
assert.equal((await student("submit", {revision: 1, answers})).submitted, true);
assert.equal((await student("submit", {revision: 1, answers})).submitted, true);
await student("save", {revision: 2, answers}, 409);
const result = await teacher("results");
assert.deepEqual(result.counts, {assigned: 2, started: 1, submitted: 1});
assert.equal(result.students[0].mcq_score, 1);
const review = {student_id: 101, question_id: "2"};
await drainBackground();
assert.equal(providerCalls, 1);
const marked = await teacher("response", {student_id: 101});
assert.equal(marked.ai_status, "marked");
assert.deepEqual(marked.ai_marks["2"], {score: 2, feedback: "Clear answer."});
assert.deepEqual(marked.reviews, {});
await teacher("review", {...review, score: 3}, 400);
await teacher("review", {...review, score: 1, feedback: "Teacher feedback"});
const overridden = await teacher("response", {student_id: 101});
assert.equal(overridden.reviews["2"].score, 1);
assert.equal(overridden.ai_marks["2"].score, 2);
assert.equal(providerCalls, 1);

providerFails = true;
await student("open", {}, 200, "two");
await student("submit", {revision: 0, answers}, 200, "two");
await drainBackground();
assert.equal((await teacher("response", {student_id: 102})).ai_status, "needs_review");
providerFails = false;
await teacher("retry_ai", {student_id: 102});
await drainBackground();
assert.equal((await teacher("response", {student_id: 102})).ai_marks["2"].score, 2);
assert.equal(providerCalls, 3);
const grid = await teacher("written_grid");
assert.equal(grid.next_student_id, null);
assert.deepEqual(grid.rows.map(row => row.student_id), [101, 102]);
assert.deepEqual(grid.rows[0].answers, {"2": answers["2"]});
assert.equal(grid.rows[0].ai_marks["2"].feedback, "Clear answer.");
assert.equal(grid.rows[0].reviews["2"].score, 1);
assert.deepEqual((await teacher("written_grid", {after_student_id: 101})).rows.map(row => row.student_id), [102]);
await teacher("written_grid", {}, 404, "other-teacher");
const share = {template_id: "template-1", shared: true, assessment};
await teacher("share_set", share, 401, "bad");
await teacher("share_set", {...share, assessment: {...assessment, questions: [{type: "mcq"}]}}, 400);
await teacher("share_set", share);
const shared = (await teacher("shared_list", {}, 200, "other-teacher")).assessments[0];
assert.equal(shared.is_owner, 0);
assert.equal(shared.title, assessment.title);
assert.ok(!("assessment_json" in shared));
await teacher("share_set", {template_id: share.template_id, shared: false}, 200, "other-teacher");
const otherId = crypto.randomUUID();
await teacher("assign", {assignment_id: otherId, class_id: 10, shared_id: shared.id}, 403, "other-teacher");
assert.equal((await teacher("assign", {assignment_id: otherId, class_id: 11, shared_id: shared.id}, 200, "other-teacher")).assigned, 1);
assert.equal((await teacher("list", {}, 200, "other-teacher")).assignments[0].source_id, shared.id);
assert.equal((await student("list", {}, 200, "other-student")).assignments[0].id, otherId);
await teacher("share_set", {template_id: share.template_id, shared: false});
assert.deepEqual((await teacher("shared_list", {}, 200, "other-teacher")).assessments, []);
await teacher("assign", {assignment_id: crypto.randomUUID(), class_id: 11, shared_id: shared.id}, 404, "other-teacher");
assert.equal((await teacher("results", {assignment_id: otherId}, 200, "other-teacher")).counts.assigned, 1);
const uniqueTemplate = {title: "Once per class", questions: assessment.questions};
const firstId = crypto.randomUUID();
const templateArgs = {class_id: 10, template_id: "unique-template", assessment: uniqueTemplate};
assert.equal((await teacher("assign", {...templateArgs, assignment_id: firstId})).already_assigned, false);
const again = await teacher("assign", {...templateArgs, assignment_id: crypto.randomUUID()});
assert.equal(again.assignment_id, firstId);
assert.equal(again.already_assigned, true);
await teacher("share_set", {template_id: "unique-template", shared: true, assessment: uniqueTemplate});
const uniqueShared = (await teacher("shared_list")).assessments.find(item => item.template_id === "unique-template");
assert.equal((await teacher("assign", {class_id: 10, assignment_id: crypto.randomUUID(), shared_id: uniqueShared.id})).assignment_id, firstId);
db.exec("INSERT INTO teacher_classes VALUES(2,10)");
await teacher("assign", {class_id: 10, assignment_id: crypto.randomUUID(), shared_id: uniqueShared.id}, 409, "other-teacher");
assert.equal((await teacher("assign", {class_id: 11, assignment_id: crypto.randomUUID(), shared_id: uniqueShared.id}, 200, "other-teacher")).already_assigned, false);
db.prepare("UPDATE lh_assessment_assignments SET assessment_json=json_remove(assessment_json,'$.assignment_key') WHERE id=?").run(firstId);
const legacy = await teacher("assign", {...templateArgs, assignment_id: crypto.randomUUID(),
  assessment: {...uniqueTemplate, title: "Edited title"}});
assert.equal(legacy.assignment_id, firstId);
assert.equal(legacy.already_assigned, true);
await teacher("archive", {}, 409);
const empty = crypto.randomUUID();
const unused = {class_id: 10, template_id: "unused-template", assessment: {...uniqueTemplate, title: "Unused assessment"}};
await teacher("assign", {...unused, assignment_id: empty});
await teacher("archive", {assignment_id: empty}, 404, "other-teacher");
assert.equal((await teacher("archive", {assignment_id: empty})).archived, true);
assert.equal((await teacher("archive", {assignment_id: empty})).archived, true);
await student("open", {assignment_id: empty}, 404);
await teacher("results", {assignment_id: empty}, 404);
assert.ok(!(await student("list")).assignments.some(row => row.id === empty));
assert.ok(!(await teacher("list")).assignments.some(row => row.id === empty));
const replacement = crypto.randomUUID();
assert.equal((await teacher("assign", {...unused, assignment_id: replacement})).assignment_id, replacement);
await student("open", {assignment_id: replacement});
await teacher("archive", {assignment_id: replacement}, 409);
for (const page of ["../index.html", "../assigned.html", "../../student/index.html", "../../teacher/index.html"]) {
  if (!existsSync(new URL(page, import.meta.url))) continue;
  for (const script of read(page).matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
}
console.log("Assignment integration passed: roster, access, autosave, submit, counts, MCQ, automatic AI marks, retry and teacher override.");

const commentInput = {student_id: 101, test_number: 1};
const callsBeforeComment = providerCalls;
await teacher("maths_comment", commentInput, 401, "bad");
await teacher("maths_comment", commentInput, 404, "other-teacher");
await teacher("maths_comment", {...commentInput, test_number: 2}, 404);
assert.equal(providerCalls, callsBeforeComment);
assert.equal((await teacher("maths_comment", commentInput)).comment, "[[STUDENT]] scored 40 out of 60.");
assert.equal(receivedCommentEvidence.teacherFeedback, undefined);
await teacher("maths_comment", {...commentInput, teacher_feedback: "  She needs to check her work.  "});
assert.equal(receivedCommentEvidence.teacherFeedback, "She needs to check her work.");
providerFails = true;
await teacher("maths_comment", commentInput, 503);
console.log("Maths Trek AI comment access, evidence and provider failure checks passed.");
