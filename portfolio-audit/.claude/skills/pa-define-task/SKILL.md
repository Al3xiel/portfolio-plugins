---
name: pa-define-task
description: "Request → a short plan in .claude/pa/work/plan-<slug>.md with verified facts, scope check and testable tasks; ends by choosing /pa-quick or /pa-implement. Cost: light."
argument-hint: "<what you want to build or change> | .claude/pa/proposals/prop-<slug>.md"
disable-model-invocation: true
---

# Definir una tarea

Entrada: `$ARGUMENTS`. Salida: un plan corto y, si el usuario aprueba, la rama. El plan es la
memoria de trabajo de la rama (no se commitea): permite `/clear` antes de implementar sin perder nada.

**Actualizar una tarea** (la rama ya tiene `.claude/pa/work/plan-<slug>.md`, o `$ARGUMENTS` lo nombra):
no se escribe un plan nuevo encima. `node .claude/pa/pa.mjs tasks` (solo lo abierto) y edita el plan
con `Edit`:
- lo nuevo, como tareas `- [ ]` al final del lote que corresponda;
- lo que ya no aplica, `- [-] T3 … (obsoleta: <motivo>, <fecha>)`: se conserva su historia, no se borra;
- las tareas cerradas y su evidencia no se tocan. Si una cerrada queda invalidada por el cambio, se
  reabre como tarea nueva que la referencia, no editando la vieja;
- el cambio, una línea en *Decisions* con la fecha.
Luego `node .claude/pa/pa.mjs gate` otra vez (una migración o un segundo paquete sacan la tarea del
carril rápido) y `node .claude/pa/pa.mjs overlap <slug>` si toca algo que otros planes también tocan.
Explora solo lo que el cambio agrega.

**Desde una propuesta** (`$ARGUMENTS` es `.claude/pa/proposals/prop-<slug>.md`, de `/pa-plan-feature`):
`node .claude/pa/pa.mjs proposals` primero. Si está `aprobada` y no desactualizada, su *Necesidad*,
*Alcance*, *Impacto* y *Riesgos* ya están verificados: **no los re-explores**, parte de ahí y baja al
nivel de tarea (archivos exactos, tests, Scope check, Endpoints, Reutilización). Si no está aprobada,
pregunta antes de seguir. Si está desactualizada, revisa solo lo que cambió. Al terminar el plan
(`plan-<slug>.md`, mismo slug sin el `prop-`), **no edites la propuesta a mano**:
`node .claude/pa/pa.mjs convert prop-<slug>` archiva su contenido en el plan (sección *Propuesta original*,
que `tasks` no lee), enlaza el `Origen:`, **borra la propuesta**,
cambia el miembro en todas las sesiones y actualiza las notas de *Coordinación* que la citaban.

## 1. Contexto — un solo mensaje, todo en paralelo

- `git branch --show-current`, `git log -1 --format=%h main`, `git status --short`.
- `node .claude/pa/pa.mjs module <módulo o ruta que nombra la petición>`.
- 1–3 `Grep` (`files_with_matches`) con los nombres que trae la petición.

**Primero el doc del módulo**, después el código: el README entero si es corto; si es largo,
`outline` y solo la sección que toca. Si no hay doc o está muy desactualizado, sigue explorando y
sugiere al final `/pa-module-doc <módulo>`. Luego `outline` de los archivos grandes y `Read` solo de
los rangos que respaldan el problema. Lo que no verificaste no va en el plan como hecho.

## 2. Preguntas — una sola vez

Lo que falte de producto va en **un** `AskUserQuestion` (máx. 4). Lo que se decide por convención
se decide y se anota.

## 3. El plan

`.claude/pa/work/plan-<slug>.md` (slug en kebab-case con el prefijo `plan-`; la rama será `feat/<slug>` o `fix/<slug>`, sin prefijo):

```
# <slug>
Branch: `feat/<slug>` (from `main` <sha>)

## Objective
<1-2 frases>

## Problem
- <hecho> (`archivo:línea`)

## Scope check
- tablas que toca y si sus filas pueden ser de varias carreras

## Endpoints                      (omitir si no hay)
| Método y ruta | Permiso | ¿careerCode / ruta S3? → assertCanView | Rutas hermanas revisadas |

## Reutilización
| Necesito | Ya existe en (o "nada") | Decisión: usar · extraer · nuevo |

## Concurrencia                   (omitir si no toca estado compartido)
- ¿dos usuarios a la vez? claves de caché con usuario/carrera · prefijos S3 únicos por job ·
  corridas en segundo plano con lock/heartbeat · escrituras que deben ir en transacción

## Constraints
- <restricciones de producción que aplican>

## Tasks
- [ ] T1 <criterio verificable> — `apps/backend/src/...` — Route: inline | delegated (<por qué>)
```

- **Reutilización** se llena buscando, no recordando: `git grep -n` por el nombre que vas a
  declarar y por los literales clave (un código de tipo, una ruta S3, un nombre de tabla). Dos
  copias se toleran; si lo que necesitas ya existe en dos sitios, la tarea es extraerlo.
- **Endpoints**: revisa las rutas hermanas del mismo controlador; si una exige permiso o
  `assertCanView` y la nueva no, es un agujero. Cada ruta nueva lleva su tarea de spec de acceso.
- Lo que este diseño no pregunte lo encuentra la auditoría, en el ciclo de corrección más caro.

Rutas completas desde la raíz (la compuerta solo cuenta esas). Tareas chicas y verticales: chicas
para implementar y probar, no para mergear — **toda la feature va en un solo PR**, porque cada merge
a `main` corre el pipeline completo. Si una parte tiene que llegar a producción antes que el resto,
pregúntalo y anótalo en *Decisions*; el tamaño solo no justifica partir.

## 4. Carril y rama

`node .claude/pa/pa.mjs gate .claude/pa/work/plan-<slug>.md` → `RÁPIDO` (`/pa-quick`) o `COMPLETO`
(`/pa-implement`, con las razones del script).

**Rama:** antes de crear una nueva, mira `git branch --no-merged main`. Si hay una rama abierta del
mismo módulo o un arreglo chico pendiente de PR, propón **sumar** esta tarea ahí (un PR, un pipeline).
Rama nueva solo si el usuario lo aprueba y no hay dónde sumarla.

Cierre en 3 líneas: plan, tareas, carril. Sugiere `/clear` antes del siguiente paso: el plan
lleva todo lo necesario y la sesión siguiente arranca sin la exploración a cuestas.
