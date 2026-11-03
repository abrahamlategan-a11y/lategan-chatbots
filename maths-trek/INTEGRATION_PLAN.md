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
Development branch created. No production changes or database migration performed.
