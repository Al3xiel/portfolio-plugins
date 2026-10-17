---
name: pa-address-review
description: "Work through review feedback on your own PR: triage every comment (defect, improvement, product decision, working as intended) before touching code, ask before reversing a prior decision, and land one fix commit on the same branch — no new PR, no extra pipeline. Cost: medium."
argument-hint: "[comentarios pegados | número de PR]"
disable-model-invocation: true
---

# Atender la revisión de un PR

Adaptado de `/abet-address-review` (abet-plugins): **primero clasificar, después tocar código**. El
error más caro aquí es implementar un comentario que no había que implementar. Las correcciones van a
la **misma rama**: el PR se actualiza y el pipeline corre una sola vez, al mergear.

## 1. Comentarios y contexto — un mensaje, en paralelo

- Los comentarios: los que pegó el usuario en `$ARGUMENTS`, o con `gh` (si está):
  `gh pr view <n> --comments` y `gh api repos/UPC-ABET/PORTFOLIO-AUDIT/pulls/<n>/comments`.
- `node .claude/pa/pa.mjs tasks` (el plan de la rama, con sus *Decisions*).
- `node .claude/pa/pa.mjs diff` (qué cambió la rama y las alertas).

No leas código todavía.

## 2. Clasificar cada comentario

| Clase | Qué es | Qué se hace |
| --- | --- | --- |
| **defecto** | el código está mal (bug, agujero, test que no prueba lo que dice) | se arregla |
| **mejora** | está bien pero puede estar mejor, dentro del alcance | se arregla si es chica; si no, tarea aparte |
| **decisión de producto** | cambia qué hace la funcionalidad | se pregunta al usuario; no se decide aquí |
| **está bien así** | el comentario parte de un malentendido o ya está resuelto | respuesta con la evidencia (`archivo:línea`, test, decisión del plan) |

Un comentario que **revierte una decisión** registrada en *Decisions* del plan es siempre *decisión de
producto*. Lo que queda fuera del alcance del PR no se mete aquí: va a una propuesta
(`/pa-plan-feature`) o a otra tarea.

Muestra la tabla al usuario (comentario resumido · clase · qué harías) y espera su visto bueno, con las
preguntas de producto en **un** `AskUserQuestion`.

## 3. Arreglar — solo lo aprobado

- Por cada defecto, primero el test que lo reproduce (RED por la razón correcta), luego el arreglo.
  `node .claude/pa/pa.mjs test <specs>`; al final `node .claude/pa/pa.mjs test --tsc` y `fix`.
- Archivos grandes: `outline` + rango. Lo nuevo respeta las reglas de no crecer la deuda.
- Si el arreglo cambia el alcance, actualiza el plan (modo actualización de `/pa-define-task`).

## 4. Cerrar

- `node .claude/pa/pa.mjs diff` sobre la rama: sin alertas nuevas.
- **Un** commit con todas las correcciones (Conventional Commit, una línea, p. ej.
  `fix(blackboard): address review on the upload access check`). Muestra el mensaje y espera
  aprobación; push solo si el usuario lo pide.
- Para cada comentario, la respuesta propuesta en una línea: qué se hizo y dónde, o por qué no.
  Publicarlas en GitHub solo con aprobación.
