-- Maths Trek: additive tables only. Run on D1 after backup, before Worker deployment.
CREATE TABLE IF NOT EXISTS maths_trek_results (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 teacher_id INTEGER NOT NULL,
 student_id INTEGER NOT NULL,
 test_number INTEGER NOT NULL CHECK(test_number BETWEEN 1 AND 4),
 marks_json TEXT NOT NULL,
 feedback_json TEXT NOT NULL DEFAULT '{}',
 total_score INTEGER NOT NULL CHECK(total_score BETWEEN 0 AND 60),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(teacher_id,student_id,test_number)
);
CREATE INDEX IF NOT EXISTS idx_maths_trek_results_teacher_student ON maths_trek_results(teacher_id,student_id);
CREATE TABLE IF NOT EXISTS maths_trek_groups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 teacher_id INTEGER NOT NULL,
 group_name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS maths_trek_group_students (
 group_id INTEGER NOT NULL,
 student_id INTEGER NOT NULL,
 PRIMARY KEY(group_id,student_id)
);
