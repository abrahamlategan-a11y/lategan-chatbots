# Maths Trek safe integration

This branch is isolated from the live Learning Hub. Do not merge until the D1 migration and Worker actions have been tested.

## Scope
- New `assessments/index.html` marking and student dashboard
- New `maths_trek_results`, `maths_trek_groups`, `maths_trek_group_students` D1 tables
- Teacher-authenticated API actions for saving/loading results and reusable groups
- Student, class, and group markbook exports

## Non-negotiable safety checks
- Do not change Pirate frontend, queue logic, gameplay actions, or existing tables.
- Do not replace the deployed Worker with an unverified copy.
- Confirm deployed Worker version before any Worker deployment.
- Test existing teacher login and student lists, then Pirate gameplay, before merging.

## Status
Live inspection completed on 3 November 2026 using a read-only token. The deployed Worker matches the supplied code.js after line-ending normalisation: SHA-256 `76c292c8917357543df63428e2effda4ace4311a5977b0dde6cc6d051f45a1bd`.

The Worker has one teacher insertion marker and no Maths Trek actions. D1 contains the expected students, teachers and teacher_classes columns; Maths Trek tables are absent.

Backend result access now rechecks current teacher ownership and class access. Group writes and deletions use atomic D1 batches. Report scores are computed from question marks, rather than trusting client feedback or stored total fields. The UI locks selection during saves, restores cancelled selections, warns on unsaved navigation, and provides part/strand reports, test filters, PDF printing and class/group CSV exports.

Validation: `node maths-trek/tests/integration.mjs` checks scoring for all four tests, access isolation, invalid marks, upserts, atomic group rollback, CSV safety and inline UI syntax. Supplying the verified Worker path as a second argument also verifies the additive patch, full module compilation and HTTP smoke behaviour. It does not prove live Pirate gameplay or live browser workflows.

`apply_patch.py` refuses changed source fingerprints and builds an additive candidate without altering original code. No complete Worker source is committed to this public repository.

No production changes or database migration performed. Deployment still requires a write token, a recoverable database backup, settings-preserving deployment and live login/marking/reporting/Pirate checks. Do not use the older whole-Worker deployment workflow for this integration.
