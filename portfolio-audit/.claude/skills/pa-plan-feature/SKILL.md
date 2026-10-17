---
name: pa-plan-feature
description: "Plan a feature idea that may or may not be built: a short proposal in .claude/pa/proposals/prop-<slug>.md with need, scope, impact measured by script, alternatives, risks and effort. No branch, no code, no commits. An approved proposal later feeds /pa-define-task. Cost: light — one planning pass."
argument-hint: "<idea de funcionalidad> | <slug de una propuesta existente>"
disable-model-invocation: true
---

# Planificar una funcionalidad

Este flujo es **aparte** del de tareas: planificar no compromete a construir. El resultado es una
propuesta que se puede discutir, aprobar, dejar en espera o descartar. Si se aprueba, `/pa-define-task`
la convierte en tarea sin volver a explorar lo que ya está aquí.

Nada de ramas, código ni commits. Profundidad de un plan, no de un diseño: lo justo para decidir si
vale la pena y cuánto cuesta.

## 1. ¿Nueva o existente?

`node .claude/pa/pa.mjs proposals`. Si `$ARGUMENTS` coincide con una propuesta (o una parecida ya
existe), se **actualiza** esa: no se crea un duplicado. Si la marca como desactualizada, revisa solo lo
que cambió en el código citado.

## 2. Contexto — barato, en un mensaje

- `node .claude/pa/pa.mjs module <módulo o ruta que nombra la idea>` y el doc del módulo (o su sección).
- 1–3 `Grep` (`files_with_matches`) para ubicar dónde caería la funcionalidad.
- `node .claude/pa/pa.mjs impact <carpetas o archivos candidatos>`: tamaño, puntos calientes de deuda,
  superficie sensible y specs, sin abrir archivos.

Solo si una decisión de la propuesta depende de cómo está hecho algo, `outline` y un rango corto.
No se diseña la implementación: eso es de `/pa-define-task` cuando se apruebe.

## 3. Preguntas — una sola vez

Lo que no se puede decidir sin el usuario (para quién es, qué problema resuelve, qué queda fuera)
va en **un** `AskUserQuestion` (máx. 4). El resto se anota en *Preguntas abiertas*.

## 4. Escribir la propuesta — máximo ~80 líneas

`.claude/pa/proposals/prop-<slug>.md` (kebab-case, siempre con el prefijo `prop-`: el hook lo exige):

```markdown
# <Título de la funcionalidad>

Estado: idea | planificada | aprobada | en espera | convertida → <plan> | descartada (<motivo>)
Fecha: <YYYY-MM-DD> · Base: main <sha corto>

## Necesidad
<quién la pide, qué problema resuelve, cómo se hace hoy>

## Propuesta
<qué haría, en 3-6 líneas, desde el punto de vista del usuario>

## Alcance
- Incluye: …
- No incluye: …

## Impacto
- Módulos y docs: <de `pa.mjs module`>
- Dónde caería: `apps/…` (rutas completas: así `proposals` detecta si el código cambió)
- Datos: <tablas/schemas; si las filas son de varias carreras>
- Endpoints nuevos o tocados: <y qué permiso necesitarían>

## Alternativas
1. <opción> — <a favor / en contra>
2. <opción> — <a favor / en contra>
Recomendación: <cuál y por qué>

## Riesgos y costos
- Superficie de seguridad: <auth, S3, credenciales → pediría escaneo de claude-security>
- Migración: <sí/no; si es destructiva>
- Motor ACC-IA: <si agrega llamadas o tokens por auditoría>
- Deuda: <puntos calientes que tocaría, de `pa.mjs impact`; si conviene extraer antes>

## Esfuerzo
<S | M | L> — <por qué: archivos, paquetes, migración, puntos calientes>
Tareas tentativas: <3-6 viñetas de alto nivel, sin detalle de implementación>
Entrega: un PR (cada merge a main corre el pipeline completo)

## Preguntas abiertas
- …
```

- Cada hecho del *Impacto* y de *Riesgos* sale del script o de una lectura verificada, con su ruta.
- Esfuerzo: **S** = un paquete, pocos archivos, sin migración ni superficie sensible; **L** = ambos
  paquetes, migración, superficie sensible o un punto caliente gigante; **M** = lo demás.
- Estado inicial `planificada` si está completa, `idea` si quedan preguntas que bloquean la decisión.

## 5. Cierre

Tres líneas: ruta de la propuesta, esfuerzo y recomendación, y qué falta decidir. Si el usuario la
aprueba, cambia `Estado:` a `aprobada`; para construirla, `/pa-define-task .claude/pa/proposals/prop-<slug>.md`.
