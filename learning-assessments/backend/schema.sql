CREATE TABLE IF NOT EXISTS lh_assessment_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  teacher_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  assessment_json TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lh_assessment_teacher ON lh_assessment_assignments(teacher_id, assigned_at);
CREATE UNIQUE INDEX IF NOT EXISTS lh_assessment_once_per_class
  ON lh_assessment_assignments(class_id, json_extract(assessment_json,'$.assignment_key'))
  WHERE json_extract(assessment_json,'$.assignment_key') IS NOT NULL;

CREATE TABLE IF NOT EXISTS lh_assessment_responses (
  assignment_id TEXT NOT NULL REFERENCES lh_assessment_assignments(id),
  student_id INTEGER NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  review_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  submitted_at TEXT,
  mcq_score INTEGER,
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS lh_assessment_student ON lh_assessment_responses(student_id, assignment_id);

CREATE TABLE IF NOT EXISTS lh_assessment_shares (
  id TEXT PRIMARY KEY NOT NULL,
  teacher_id INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (teacher_id, template_id)
);

CREATE TABLE IF NOT EXISTS lh_assessment_ai_marks (
  assignment_id TEXT NOT NULL,
  student_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('marking','marked','needs_review')),
  lease TEXT NOT NULL,
  marks_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assignment_id, student_id)
);
