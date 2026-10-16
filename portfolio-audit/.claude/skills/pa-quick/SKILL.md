---
name: pa-quick
description: "Lean lane: plan and build a small, low-risk change in one session with the same TDD proofs and no subagents. A script refuses migrations, auth/S3/LLM paths, both packages, >4 tasks or >8 files. Cost: light-medium."
argument-hint: "<request> | .claude/pa/work/<slug>.md"
disable-model-invocation: true
---

# Carril rápido

Todo en esta sesión, sin subagentes. Una sesión cuesta **turnos × contexto**: se recortan turnos,
nunca controles.

## 1. Plan

- Si hay plan (`$ARGUMENTS` o el de la rama): `node .claude/pa/pa.mjs tasks` y
  `node .claude/pa/pa.mjs module <rutas del plan>` (el doc del módulo antes que el código).
- Si no: pasos 1–3 de `/pa-define-task` en esta misma sesión, con **Scope check**, **Reutilización**
  y máximo 4 tareas.

## 2. Compuerta

`node .claude/pa/pa.mjs gate` → exit 1: para, muestra las razones y propone `/pa-implement`.
No reescribas el plan para que pase.

## 3. Construir en lotes de hasta 3 tareas — dos rondas de tests por lote

1. **Un mensaje**: escribe *todos* los tests del lote. Cada criterio de aceptación tiene un test
   que falla sin el comportamiento; cada ruta nueva, su spec de acceso
   (`<nombre>.controller.access.spec.ts`: método, ruta y permiso con el `PermissionsGuard` real).
2. **Una corrida**: `node .claude/pa/pa.mjs test <specs del lote>` → RED **por la razón correcta**
   (el método no existe, no un typo ni un import roto).
3. **Un mensaje**: implementa el lote entero. Archivos grandes: `outline` + `Read` por rango.
4. **Una corrida**: `node .claude/pa/pa.mjs test --tsc <specs del lote>` → GREEN. Luego `fix`.
5. Marca `- [x]` en el plan con `Edit`: `  - Evidence: RED … · GREEN n/n · tsc ok`.

Antes de declarar un helper, tipo o constante: `git grep -n` por su nombre. Si existe, se usa.
Si un intento sale mal, `/rewind` en vez de parchear encima. No releas lo recién escrito.

## 4. Lo no planificado

Si una tarea resulta necesitar una migración, un módulo nuevo, una dependencia, cambiar un
contrato público o una decisión que el plan no tomó, **para**: ya no es este carril. Agrega al
plan `## Unplanned — <qué y por qué>` y propone `/pa-implement` con ese plan.

## 5. Cierre

`node .claude/pa/pa.mjs diff` — si dice `deep`, el cambio creció: dilo. Propón commits
(Conventional Commits, una línea). Sin commit sin aprobación. Siguiente: `/pa-audit`.
