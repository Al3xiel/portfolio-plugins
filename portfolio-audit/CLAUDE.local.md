# PORTFOLIO-AUDIT

Auditoría de portafolios ABET: NestJS + Prisma en `apps/backend`, Next.js en `apps/frontend`.
Contexto general en `README.md` (léelo solo si la tarea lo necesita). Las reglas de cada paquete
se cargan solas al tocar sus archivos (`.claude/rules/`).

## Producción — nunca

- `apps/backend/.env` apunta a la base de **producción**: no leerlo. No correr `prisma migrate dev`,
  `db push`, seeds, `npm run start*` del backend ni scripts de `apps/backend/scripts/`.
- Merge a `main` = despliegue, y aplica las migraciones (`prisma migrate deploy`).
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
