---
name: pa-implement
description: "Execute the open tasks of the branch plan in TDD batches, writing RED/GREEN evidence back so a later session resumes from the plan alone. Sonnet subagents only for 3+ independent tasks. Never commits. Cost: heavy; `serial` never fans out."
argument-hint: "[.claude/pa/work/plan-<slug>.md] [serial]"
disable-model-invocation: true
---

# Implementar

## 1. Cargar — un mensaje, en paralelo

- `node .claude/pa/pa.mjs tasks [plan]` — solo lo abierto; sin argumento, el plan de la rama.
- `git status --short` (cambios ajenos a la tarea: avisa y no los toques).
- `node .claude/pa/pa.mjs module <rutas de las tareas>` — si hay doc, léelo (o su sección) antes
  de abrir código del módulo.

Retomar = esto. Lo que la evidencia de las tareas cerradas ya resolvió no se vuelve a explorar.

## 2. Armar el lote (hasta 3 tareas, en orden)

Fan-out **solo si** hay 3+ tareas listas, con archivos disjuntos, y `$ARGUMENTS` no dice `serial`.
Ante la duda, en serie: cada subagente arranca sin contexto ni caché y relee todo.

Si hay fan-out: todos en **un** mensaje, cada uno con `model: "sonnet"` explícito (si se omite,
hereda el modelo de la sesión). El prompt de cada uno lleva solo:
- su bloque de tarea, copiado de la salida de `tasks`;
- las rutas que puede tocar y las que no;
- "Las reglas del paquete se cargan solas al abrir sus archivos. Usa `node .claude/pa/pa.mjs
  outline|test|fix`. Reporta en ≤15 líneas, estilo telegráfico (sin preámbulo, sin repetir la
  tarea, sin resumen final): archivos, RED observado, GREEN n/n, dudas."
  El reporte entra a tu contexto y se reenvía en cada turno siguiente: corto se paga una vez.

Verifica cada reporte con `node .claude/pa/pa.mjs test <sus specs>`, no releyendo su código.

## 3. El lote en serie — dos rondas de tests, no una por tarea

Una sesión cuesta **turnos × contexto**: se recortan turnos, no controles.

1. **Un mensaje**: todos los tests del lote. Cada criterio, un test que falla sin el
   comportamiento; cada ruta nueva, su spec de acceso (`<nombre>.controller.access.spec.ts`).
2. **Una corrida**: `node .claude/pa/pa.mjs test <specs>` → RED por la razón correcta.
3. **Un mensaje**: implementación del lote. Antes de declarar un helper, tipo o constante,
   `git grep -n` por su nombre y por el literal clave; si existe, se usa (la tabla
   *Reutilización* del plan ya lo decidió). Archivos grandes: `outline` + `Read` por rango.
4. **Una corrida**: `node .claude/pa/pa.mjs test --tsc <specs>` → GREEN; luego `fix`.
5. Con `Edit` en el plan: `  - Evidence: RED <qué y por qué> · GREEN <n/n> · tsc ok`. Una línea,
   telegráfica: el plan se relee cada vez que se retoma la tarea.

Un intento fallido se deshace con `/rewind`, no se parchea encima. No releas lo recién escrito.

## 4. Checkpoint

Una línea por lote: cerradas, abiertas, desvíos. Si el desvío cambia el alcance (migración, otro
paquete, endpoint con `careerCode`, una decisión que el plan no tomó), para: agrégalo al plan como
`## Unplanned — <qué y por qué>` y pregunta antes de seguir. Entre lotes largos, `/compact` en ese punto
de corte es más barato que dejar que la compactación automática ocurra a mitad de una tarea.

## 5. Final

Sin `- [ ]`: `node .claude/pa/pa.mjs diff` y la agrupación de commits propuesta (Conventional
Commits, una línea, sin atribución de IA). Sin commit sin aprobación. Siguiente: `/pa-audit`.
