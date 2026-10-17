# Sesión: 1

Estado: activa
Fecha: 2026-10-17
Objetivo: Revisión de Cursos por el docente a cargo, almacenamiento temporal en S3, flujos de Evidencias y vista de SUPERADMIN

## Miembros
- plan: plan-evidence-flows
- plan: plan-mapping-responsible-teachers
- plan: plan-upload-min-role
- plan: plan-bbc-all-courses-view
- plan: plan-s3-staging-and-course-review

## Coordinación
<!-- la escribe /pa-reconcile --session: un cruce por línea, con su decisión -->
- ~~Estrategia (2026-10-17): un PR por documento, en secuencia: 1 plan-evidence-flows → 2 plan-mapping-responsible-teachers → 3 plan-upload-min-role → 4 plan-s3-staging-and-course-review → 5 plan-bbc-all-courses-view.~~ Reemplazada el mismo día (ver abajo).
- ~~Cruce plan-upload-min-role ↔ plan-s3-staging-and-course-review: choque de merge — PR 3 con `canUpload` compatible y PR 4 que quita las ediciones del panel.~~ Reemplazada: ya no hay estado intermedio.
- **Estrategia vigente (usuario, 2026-10-17): 4 PRs** (cada merge a `main` corre el pipeline completo). 1 plan-evidence-flows → 2 plan-mapping-responsible-teachers → 3 plan-upload-min-role **+** plan-s3-staging-and-course-review en una rama, `feat/s3-staging-and-course-review` (primero las tareas de upload-min-role, T9 incluida) → 4 plan-bbc-all-courses-view. Cada rama sale de `main` con el PR anterior fusionado; las migraciones se encadenan en ese orden (2, luego las dos del PR 3).
- Cruce plan-evidence-flows ↔ s3-staging (`useEvidenceCertification.ts`): dependencia — PR 1 primero con T8 mínimo; PR 4 reemplaza el prototipo.
- Cruces plan-bbc-all-courses-view ↔ plan-upload-min-role (página del curso, símbolos AREA/PROGRAM, permiso `blackboard.view`) y ↔ plan-mapping-responsible-teachers (`UsersController`): compatibles, revisados.
