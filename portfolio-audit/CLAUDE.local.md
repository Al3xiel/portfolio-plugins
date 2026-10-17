# PORTFOLIO-AUDIT

Auditoría de portafolios ABET: NestJS + Prisma en `apps/backend`, Next.js en `apps/frontend`.
Contexto general en `README.md` (léelo solo si la tarea lo necesita). Las reglas de cada paquete
se cargan solas al tocar sus archivos (`.claude/rules/`).

## Producción — nunca

- `apps/backend/.env` apunta a la base de **producción**: no leerlo. No correr `prisma migrate dev`,
  `db push`, seeds, `npm run start*` del backend ni scripts de `apps/backend/scripts/`.
- Merge a `main` = despliegue, y aplica las migraciones (`prisma migrate deploy`).
- **Cada push a `main` corre el pipeline completo** de GitHub Actions (tests de backend y frontend,
  build de imágenes, deploy), aunque el cambio sea una línea o solo docs, y eso cuesta. Por eso:
  menos PRs y más completos. Una feature es **un** PR, no uno por fase. Los arreglos chicos y lo que
  es solo docs se **suman** a la rama abierta o al próximo PR con código; no abren PR propio. Un PR
  aparte solo si algo tiene que llegar a producción antes (urgencia del usuario), nunca por tamaño.
- No lanzar auditorías (`/audit/run?…&start=1`): la Fase 3 cobra por token del motor ACC-IA.
- Commits en Conventional Commits, una línea, sin atribución de IA, y solo con aprobación.

## Trabajo mecánico: `node .claude/pa/pa.mjs <modo>`

| Para… | Modo |
| --- | --- |
| medir el cambio, alertas, profundidad de auditoría | `diff` |
| correr tests (solo conteos y fallos) | `test [--tsc] [spec…]` |
| formatear y arreglar lint de lo cambiado | `fix [archivo…]` |
| ubicar un método en un archivo grande | `outline <archivo>` y luego `Read` por rango |
| escribir una migración sin tocar la base | `migration <nombre>` |
| hechos del PR | `pr` |
| qué doc corto leer antes de explorar un módulo | `module <ruta o módulo>` |
| deuda estructural del repo y puntos calientes (`--check`: falla si creció) | `debt` |
| costo de tocar unas rutas (tamaño, deuda, superficie, specs) para planificar | `impact <ruta>…` |
| propuestas de funcionalidades por estado | `proposals` |
| dónde se cruzan planes y propuestas, con la línea de cada uno | `overlap [--session s] [slug…]` |
| agrupar planes y propuestas en sesiones (no los mueve) | `session new\|add\|show\|list …` |
| propuesta convertida en tarea: la archiva en el plan, la borra, sesiones y referencias al día | `convert <prop-slug>` |

Un hook ya filtra `npx jest|vitest|tsc|eslint` directos; agrega `| cat` solo si necesitas la salida entera.
Si `pa.mjs` falla o no imprime nada, eso es un fallo, no un "sin resultados": dilo en una línea y
sigue a mano (`git diff --stat`, el runner directo).

Archivos nuevos siguen el estándar de estructura de `.claude/rules/` (se carga al tocar cada paquete);
un hook rechaza al crear lo que no cumple, con la razón y la alternativa.

## Economía de contexto

- `Grep` antes que `Read`; archivos de más de 1200 líneas nunca enteros (`outline` + rango ≤200).
- Llamadas independientes en un mismo mensaje. No releer lo recién editado.
- Subagentes solo para 3+ tareas independientes con archivos disjuntos, con `model` explícito;
  se les pasan rutas, no contenido pegado.
- Antes de explorar un módulo, su doc (`module`); `outline` si es largo.
- Flujo de cambios: skills `/pa-define-task`, `/pa-quick`, `/pa-implement`, `/pa-audit`, `/pa-create-pr`;
  `/pa-module-doc` para escribir o refrescar el doc de un módulo.
- Nombres: tareas `work/plan-<slug>.md`, propuestas `proposals/prop-<slug>.md` (el hook lo exige).
- Planificación aparte (no compromete a construir): `/pa-plan-feature` escribe una propuesta en
  `.claude/pa/proposals/`; si se aprueba, `/pa-define-task <propuesta>` la convierte en tarea.
- Cambio de alcance de una tarea: `/pa-define-task` sobre el plan existente lo actualiza (`- [-]`
  obsoletas). Revisión de un PR: `/pa-address-review` (un commit en la misma rama). Varias tareas o
  propuestas que se cruzan: agruparlas en una sesión y `/pa-reconcile --session <s>` (lee solo las
  líneas que se tocan). Qué comando usar en cada caso: `/pa-guide` (`.claude/pa/GUIA.md`).
