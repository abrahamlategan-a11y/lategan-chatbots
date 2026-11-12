"""Release the assignment block without replacing other live Worker code."""
import email.parser
import email.policy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).parent
SCRIPT = "/workers/scripts/lategan-chatbot"
LIVE = "https://lategan-chatbot.abrahamlategan.workers.dev"
BASELINE = "76f75a03346f43924b783b7b51a2000289ca45b81a5f9287ee474d1f7d25d2b3"
ANCHOR = rb"""(?m)^[ \t]*if\s*\(\s*action\s*===\s*["']teacher_login["']\s*\)\s*\{[^\S\n]*$"""


def request(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("Content-Type", "")


def release(account, token):
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token:
        raise RuntimeError("Missing Cloudflare deployment credentials.")
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}"

    def cloudflare(path, method="GET", payload=None, kind="application/json"):
        data = json.dumps(payload).encode() if isinstance(payload, dict) else payload
        status, raw, content_type = request(base + path, method, data, {
            "Authorization": "Bearer " + token, "Content-Type": kind,
        })
        if status >= 300:
            raise RuntimeError(f"Cloudflare {method} returned HTTP {status}.")
        if path == SCRIPT and method == "GET":
            return raw, content_type
        response = json.loads(raw)
        if not response.get("success"):
            raise RuntimeError("Cloudflare did not confirm success.")
        return response["result"]

    def source():
        raw, kind = cloudflare(SCRIPT)
        if "multipart/" not in kind:
            raise RuntimeError("Expected a multipart Worker module.")
        message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
            f"Content-Type: {kind}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw)
        parts = list(message.iter_parts())
        if len(parts) != 1:
            raise RuntimeError("Expected exactly one Worker module.")
        part = parts[0]
        name = part.get_filename() or part.get_param("name", header="Content-Disposition")
        if not name or not re.fullmatch(r"[a-zA-Z0-9._/-]+", name):
            raise RuntimeError("Unexpected Worker module name.")
        return name, part.get_payload(decode=True)

    def upload(name, content):
        boundary = uuid.uuid4().hex
        metadata = json.dumps({"main_module": name})
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
            f'Content-Type: application/json\r\n\r\n{metadata}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\n'
            'Content-Type: application/javascript+module\r\n\r\n'
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        cloudflare(SCRIPT + "/content", "PUT", body, f"multipart/form-data; boundary={boundary}")

    name, original = source()
    metadata = json.loads((ROOT.parents[1] / "assessments/question-metadata.json").read_text())
    if len(metadata) != 4 or any(len(test) != 40 for test in metadata):
        raise RuntimeError("Unexpected Maths Trek question metadata.")
    template = (ROOT / "worker-actions.js.txt").read_bytes()
    marker = b"/* MATHS_TREK_QUESTION_METADATA */ []"
    if template.count(marker) != 1:
        raise RuntimeError("Expected one Maths Trek metadata marker.")
    block = template.replace(marker, json.dumps(metadata, separators=(",", ":")).encode()) + b"\n"
    already_installed = original.count(block) == 1
    baseline = original.replace(block, b"", 1).replace(b", assessmentContext", b"", 1) if already_installed else original
    if not already_installed:
        starts = list(re.finditer(rb"(?m)^      // Learning Hub class assignments\n", original))
        if len(starts) == 1:
            start = starts[0].start()
            previous_blocks = [
                (25652, "298cb6784f3dd7895991c4a00faa5ace928679cdb2dd30505e5fbb28c84aca0e"),
                (27496, "1cf0251df5d21771250a9b30897672feb3e5ac8c3ddd75d81e5e36f641ffa40e"),
                (36725, "6f3e2e4f29aa27128af413bc7443fc9a6013594cc36a267b2551d2e4749de1e6"),
            ]
            for length, digest in previous_blocks:
                end = start + length
                if hashlib.sha256(original[start:end]).hexdigest() == digest:
                    baseline = (original[:start] + original[end:]).replace(b", assessmentContext", b"", 1)
                    break
    if hashlib.sha256(baseline).hexdigest() != BASELINE:
        raise RuntimeError("Live Worker differs from the inspected baseline. Inspect before deploying.")
    anchors = list(re.finditer(ANCHOR, baseline))
    if len(anchors) != 1 or b"lh_assessment_" in baseline:
        raise RuntimeError("Expected a single teacher login handler in the live Worker.")
    anchor = anchors[0].start()
    candidate = baseline[:anchor] + block + baseline[anchor:]
    candidate, changed = re.subn(rb"(async fetch\(\s*request\s*,\s*env)(\s*\))",
                                 rb"\1, assessmentContext\2", candidate)
    if changed != 1:
        raise RuntimeError("Expected one Worker fetch handler accepting request and env.")
    with tempfile.TemporaryDirectory() as directory:
        module = Path(directory) / "worker.mjs"
        module.write_bytes(candidate)
        subprocess.run(["node", "--check", module], check=True, capture_output=True)

    settings = cloudflare(SCRIPT + "/settings")
    bindings = [b for b in settings["bindings"] if b["type"] == "d1" and b["name"] == "DB"]
    if len(bindings) != 1:
        raise RuntimeError("Expected a single DB binding.")
    db_id = bindings[0].get("id") or bindings[0].get("database_id")
    uuid.UUID(db_id)
    db = "/d1/database/" + db_id

    def sql(statement, *params):
        rows = cloudflare(db + "/query", "POST", {"sql": statement, "params": params})
        if not rows or not all(row.get("success") is True for row in rows):
            raise RuntimeError("D1 statement did not confirm success.")
        return [record for row in rows for record in row.get("results", [])]

    for table, columns in {
        "teachers": {"id", "teacher_code", "class_name", "active", "is_admin", "display_name", "year_level"},
        "classes": {"id", "name", "year_level", "active", "created_by_teacher_id"},
        "teacher_classes": {"teacher_id", "class_id", "is_default", "role"},
        "students": {"id", "student_code", "teacher_id", "class_id", "class_name", "active", "display_name"},
    }.items():
        existing = {row["name"] for row in sql("SELECT name FROM pragma_table_info(?)", table)}
        if not columns <= existing:
            raise RuntimeError(f"Live {table} schema differs from the assignment requirements.")
    matching = sql("""SELECT COUNT(*) AS n FROM students s JOIN classes c ON c.id=s.class_id
       WHERE c.active=1 AND s.active=1 AND UPPER(TRIM(c.name))='4L'""")
    print(f"Verified live Worker and D1 schema. Active students in 4L: {matching[0]['n']}.", flush=True)
    if os.environ.get("RELEASE_CONFIRMATION") != "DEPLOY-ASSESSMENTS":
        print("Preflight complete.")
        return

    if not cloudflare(db + "/time_travel/bookmark").get("bookmark"):
        raise RuntimeError("D1 recovery bookmark unavailable.")
    sql((ROOT / "schema.sql").read_text())
    if source() != (name, original):
        raise RuntimeError("Live Worker changed during the migration.")
    if not already_installed:
        upload(name, candidate)
    try:
        if source() != (name, candidate) or cloudflare(SCRIPT + "/settings") != settings:
            raise RuntimeError("Live Worker source or settings failed verification.")
        smoke_test(sql)
    except Exception:
        if not already_installed and source() == (name, candidate):
            upload(name, original)
            print("Restored the original Worker after failed verification.", flush=True)
        raise


def smoke_test(sql):
    test = uuid.uuid4().hex[:16].upper()
    teacher_code, student_code = "LH" + test + "T", "LH" + test + "S"
    class_name = "Assessment smoke test " + test
    assignment_id = str(uuid.uuid4())
    empty_assignment_id = str(uuid.uuid4())

    def post(action, expected=200, **payload):
        status, raw, _ = request(LIVE, "POST", json.dumps({"action": action, **payload}).encode(),
                                 {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
        if status != expected:
            raise RuntimeError(f"{action}: expected HTTP {expected}, got {status}.")
        return json.loads(raw)

    def teacher(action, expected=200, **payload):
        return post("lh_assessment_teacher_" + action, expected, assignment_id=assignment_id,
                    teacher_code=teacher_code, **payload)

    def student(action, expected=200, **payload):
        return post("lh_assessment_student_" + action, expected, assignment_id=assignment_id,
                    student_code=student_code, **payload)

    for attempt in range(6):
        try:
            post("lh_assessment_teacher_list", 401)
            break
        except RuntimeError:
            if attempt == 5:
                raise
            time.sleep(4)

    try:
        t_id = sql("""INSERT INTO teachers(teacher_code,display_name,class_name,year_level,active,is_admin)
            VALUES(?,? ,?,'Year 4',1,0) RETURNING id""", teacher_code, "Assessment Test Teacher", class_name)[0]["id"]
        c_id = sql("""INSERT INTO classes(name,year_level,active,created_by_teacher_id)
            VALUES(?,'Year 4',1,?) RETURNING id""", class_name, t_id)[0]["id"]
        sql("INSERT INTO teacher_classes(teacher_id,class_id,is_default,role) VALUES(?,?,1,'teacher')", t_id, c_id)
        s_id = sql("""INSERT INTO students(student_code,display_name,class_name,teacher_id,class_id,active)
            VALUES(?,? ,?,?,?,1) RETURNING id""", student_code, "Assessment Test Student", class_name, t_id, c_id)[0]["id"]

        post("maths_trek_save", teacher_code=teacher_code, student_id=s_id, test_number=1, marks=[1] * 40)
        assert teacher("maths_comment", student_id=s_id, test_number=1,
                       teacher_feedback="Remind them to check their work before handing it in.")["comment"].strip()
        teacher("maths_comment", expected=404, student_id=s_id, test_number=2)
        print("Live Maths Trek AI comment verified using a synthetic test result.", flush=True)

        assert any(item["id"] == c_id for item in teacher("list")["classes"])
        assessment = {"title": "Temporary release check", "questions": [
            {"type": "mcq", "text": "What is 1 + 1?", "marks": 1, "options": ["1", "2"], "correct": "1"},
            {"type": "short", "text": "Explain your answer.", "marks": 2, "rubric": "Award two marks for explaining addition of two ones."},
        ]}
        template_id = "release-smoke"
        assert teacher("share_set", template_id=template_id, assessment=assessment, shared=True)["shared"]
        shared = next(item for item in teacher("shared_list")["assessments"] if item["is_owner"] and item["template_id"] == template_id)
        assert teacher("assign", class_id=c_id, shared_id=shared["id"])["assigned"] == 1
        repeated = post("lh_assessment_teacher_assign", teacher_code=teacher_code,
                        assignment_id=str(uuid.uuid4()), class_id=c_id, shared_id=shared["id"])
        assert repeated["already_assigned"] and repeated["assignment_id"] == assignment_id
        assert len(teacher("list")["assignments"]) == 1
        assert not teacher("share_set", template_id=template_id, shared=False)["shared"]
        assert student("list")["assignments"][0]["id"] == assignment_id
        opened = student("open")
        assert all("correct" not in q and "rubric" not in q for q in opened["assessment"]["questions"])
        assert teacher("results")["counts"] == {"assigned": 1, "started": 1, "submitted": 0}
        answers = {"1": "1", "2": "If I add one more to one, there are two."}
        revision = student("save", answers=answers, revision=opened["revision"])["revision"]
        assert student("open")["answers"] == answers
        assert student("submit", answers=answers, revision=revision)["submitted"]
        results = teacher("results")
        assert results["counts"] == {"assigned": 1, "started": 1, "submitted": 1}
        assert results["students"][0]["mcq_score"] == 1
        for _ in range(30):
            marks = sql("SELECT state FROM lh_assessment_ai_marks WHERE assignment_id=? AND student_id=?", assignment_id, s_id)
            if marks and marks[0]["state"] != "marking":
                break
            time.sleep(1)
        assert marks and marks[0]["state"] == "marked", "Automatic AI marking did not complete."
        response = teacher("response", student_id=s_id)
        assert response["answers"] == answers
        assert 0 <= response["ai_marks"]["2"]["score"] <= 2
        teacher("review", student_id=s_id, question_id="2", score=1, feedback="Teacher override.")
        reviewed = teacher("response", student_id=s_id)
        assert reviewed["reviews"]["2"] == {"score": 1, "feedback": "Teacher override."}
        assert reviewed["ai_marks"] == response["ai_marks"]
        grid = teacher("written_grid")
        assert grid["next_student_id"] is None and len(grid["rows"]) == 1
        row = grid["rows"][0]
        assert row["student_id"] == s_id and row["answers"] == {"2": answers["2"]}
        assert row["ai_marks"] == response["ai_marks"] and row["reviews"] == reviewed["reviews"]
        post("lh_assessment_teacher_archive", 409, teacher_code=teacher_code, assignment_id=assignment_id)
        post("lh_assessment_teacher_assign", teacher_code=teacher_code, assignment_id=empty_assignment_id,
             class_id=c_id, assessment={**assessment, "title": "Unused release check"})
        assert post("lh_assessment_teacher_archive", teacher_code=teacher_code,
                    assignment_id=empty_assignment_id)["archived"]
        assert all(row["id"] != empty_assignment_id for row in student("list")["assignments"])
        post("lh_assessment_student_open", 404, student_code=student_code, assignment_id=empty_assignment_id)
        print("Live archive hides unused assignments and protects started or submitted work.", flush=True)
        print("Live written grid matches saved AI rationale and teacher override.", flush=True)
        print("Live student submission, automatic written marks and teacher override verified.", flush=True)
    finally:
        sql("DELETE FROM lh_assessment_responses WHERE assignment_id=?", empty_assignment_id)
        sql("DELETE FROM lh_assessment_assignments WHERE id=?", empty_assignment_id)
        sql("DELETE FROM lh_assessment_ai_marks WHERE assignment_id=?", assignment_id)
        sql("DELETE FROM lh_assessment_responses WHERE assignment_id=?", assignment_id)
        sql("DELETE FROM lh_assessment_assignments WHERE id=?", assignment_id)
        sql("DELETE FROM maths_trek_results WHERE student_id=(SELECT id FROM students WHERE student_code=?)", student_code)
        sql("DELETE FROM students WHERE student_code=?", student_code)
        sql("DELETE FROM teacher_classes WHERE teacher_id=(SELECT id FROM teachers WHERE teacher_code=?)", teacher_code)
        sql("DELETE FROM classes WHERE name=? AND created_by_teacher_id=(SELECT id FROM teachers WHERE teacher_code=?)", class_name, teacher_code)
        sql("DELETE FROM lh_assessment_shares WHERE teacher_id=(SELECT id FROM teachers WHERE teacher_code=?)", teacher_code)
        sql("DELETE FROM teachers WHERE teacher_code=?", teacher_code)
        print("Temporary test data removed.", flush=True)


if __name__ == "__main__":
    release(os.environ.get("CF_ACCOUNT", ""), os.environ.get("CF_TOKEN", ""))
