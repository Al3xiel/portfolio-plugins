---
name: pa-audit
description: "Pre-PR audit of the task, not the repo: only the lines the branch adds or changes (and what they directly break); pre-existing code is out of scope unless it is a blocker. The script measures the diff, runs the mechanical checks and tests, and picks lite or deep; ends in a severity table, a verdict, and a ledger entry. Cost: medium; heavy with deep."
argument-hint: "[lite|deep] [--base main]"
disable-model-invocation: true
---

# Auditar la tarea antes del PR

## Alcance — la tarea, no el repositorio

Se audita lo que la tarea hizo: las líneas que la rama **agrega o cambia**, y lo que esas líneas
**rompen directamente** (un llamador, un contrato, un test, una ruta hermana que quedó inconsistente).

El código preexistente que aparece como contexto **no se investiga ni se reporta**: no se va a
corregir en esta tarea, y buscarlo cuesta tokens y desvía la revisión. Única excepción, si lo ves
sin buscarlo y es **bloqueante** — fuga de datos entre carreras o usuarios, endpoint abierto,
pérdida o corrupción de datos, falla segura en producción —: va en una sección aparte,
*Fuera de alcance — bloqueante*, con `archivo:línea` y por qué no puede esperar. Nada más
preexistente: ni "notas", ni "de paso".

## 1. Medir — un mensaje, en paralelo

- `node .claude/pa/pa.mjs diff [--depth lite|deep]` (`--depth` solo si `$ARGUMENTS` lo dice).
  Sus alertas ya son solo sobre líneas agregadas.
- `node .claude/pa/pa.mjs test --tsc` (specs relacionados con el diff; solo fallos).

Tareas abiertas en el plan o tests en rojo → bloqueante: repórtalo y para. No corras
`git diff` completo: la lista de archivos ya está.

## 2. Revisar

Cada alerta mecánica se **confirma** o se **descarta con una razón** de una línea. Severidad por
regla cuando se confirma:

| Regla | Severidad |
| --- | --- |
| `route-without-permission`, `scope-param-unused`, `raw-sql-unsafe` | blocker |
| `duplicate-code` (tercera copia: extraer), `route-without-spec`, `error-message-in-response`, `cache-key-without-user`, `route-scope-only`, `career-without-assert`, `process-env-secret` (política del repo, no vulnerabilidad: las variables de entorno son confiables) | major |
| `redeclared-export`, `dead-export`, `dead-file`, `duplicate-dynamic-import` | minor — `dead-*` puede ser un PR encadenado: confirmar que el siguiente lo usa |
| `large-file-growth`, `page-with-logic`, `db-access-outside-repository`, `layer-violation` | major — **deuda nueva**: lo que la tarea agrega va en un archivo propio, un repositorio o la capa correcta. Lo heredado no se reporta; solo que no crezca |
| `naming-standard` | major — archivo nuevo fuera del estándar (`.claude/rules/backend.md` / `frontend.md`): renombrar o mover antes del PR |
| `generic-file-name`, `large-new-file` | minor — renombrar por lo que hace / dividir por responsabilidad |

| Lente | Qué mira, en lo que la tarea agregó |
| --- | --- |
| Acceso | El modelo de amenazas de `.claude/claude-security-guidance.md`: `@RequirePermission`; `assertCanView` si recibe carrera o ruta; datos por usuario no compartidos. Como atacante: ¿un DIRECTOR opera sobre otra carrera? |
| Producción | Migración revisada (lo que `migration` marcó como destructivo); nada que dispare la Fase 3; secretos en `system.parameters`. |
| Robustez | Errores tragados, carreras entre usuarios, límites (paginación, memoria, tiempo). |
| Tests | Cada "código sin spec al lado" justificado; cada ruta nueva con spec de acceso; los specs prueban comportamiento. |

**Criterio de seguridad** (el del `/security-review` oficial de Anthropic, que es el que mantiene
pocos falsos positivos):
- Solo vulnerabilidades con un camino de explotación concreto: cada una lleva *escenario de
  explotación* (quién, con qué petición, qué obtiene). Sin escenario, no es hallazgo de seguridad.
- Confianza de 1 a 10 por hallazgo; **menos de 8 no se reporta** como vulnerabilidad (si es una
  regla del repo, va como incumplimiento de política con su severidad de la tabla).
- No son hallazgos: DoS, rate limiting, consumo de memoria o CPU, falta de hardening genérico,
  carreras teóricas, dependencias desactualizadas, archivos de test, *log spoofing*, texto del
  usuario dentro de un prompt al motor ACC-IA, falta de permisos en código del frontend (lo valida
  el backend), XSS en React sin `dangerouslySetInnerHTML`. Las variables de entorno son confiables.

**lite** — en esta sesión: `git diff -U3 main -- <archivo>` de varios archivos en un mensaje;
en los grandes, solo los hunks.

**deep** — tres subagentes en **un** mensaje, cada uno con `model: "sonnet"`: *Acceso*,
*Producción + robustez*, *Tests*. Prompt: la lista de archivos y las alertas que le tocan
(copiadas de la salida del script); al de *Acceso*, además: "lee `.claude/claude-security-guidance.md`
y aplica el criterio de seguridad de `.claude/skills/pa-audit/SKILL.md` (escenario de explotación,
confianza ≥ 8, exclusiones)"; "lee solo los hunks con `git diff -U3 main -- <archivo>`";
"reporta solo lo que está en líneas que el diff agrega o cambia, o que esas líneas rompen; lo
preexistente solo si es bloqueante, marcado `fuera de alcance`"; "máximo 10 hallazgos:
severidad, `archivo:línea`, qué, por qué, arreglo, y si una regla podría detectarlo"; "estilo
telegráfico: una línea por hallazgo, sin preámbulo, sin repetir la tarea ni las alertas, sin
resumen final". Su reporte entra a tu contexto y se reenvía en cada turno siguiente: cada línea
de más se paga varias veces.
Tú deduplicas y sintetizas; no repites su trabajo.

### Escaneo profundo de seguridad — plugin oficial `claude-security`

`diff` lo recomienda solo cuando el cambio toca auth, roles, S3 o credenciales, o el script ya ve un
agujero de permisos (~17 % de los PRs en el backtest), con el nivel según el tamaño. No lo lances tú:
pide confirmación y usa muchos tokens. Dile al usuario, en una línea, el comando que imprimió `diff`
(`/claude-security scan my branch at <nivel>`) y que solo escanea lo **commiteado**.

Si `diff` muestra un **informe vigente para HEAD**:
- `node .claude/pa/pa.mjs ledger import` y lee solo `CLAUDE-SECURITY-RESULTS.md` (sus hallazgos ya
  pasaron por un panel de 3 verificadores: no los re-verifiques).
- En `deep`, **no lances el subagente de Acceso**: el escaneo ya cubrió la seguridad genérica. Revisa tú,
  en una pasada, solo lo propio del repo que el escaneo no conoce (alcance por `careerCode`,
  `@RequirePermission`, `assertCanView`, datos de Blackboard por usuario, de
  `.claude/claude-security-guidance.md`).
- Sus hallazgos van a la tabla del veredicto con su severidad. Los que el escaneo marca como previos
  al cambio son *fuera de alcance*: solo entran si son bloqueantes.
- Si la tarea arregla un hallazgo, el plugin puede proponer el parche (`/claude-security` → *Suggest
  patches*); nunca se aplica solo.

## 3. Veredicto

| Sev. | Archivo:línea | Hallazgo | Arreglo |
| --- | --- | --- | --- |

**blocker** (fuga entre carreras o usuarios, endpoint abierto, migración peligrosa, test roto),
**major**, **minor**, **sugerencia**. Si hubo, la sección *Fuera de alcance — bloqueante* debajo.
Termina con **LISTO** / **NO LISTO**: lo fuera de alcance no cambia el veredicto de la tarea,
salvo que la tarea lo empeore o lo exponga. Si está listo, `/pa-create-pr`. No arregles nada sin
que te lo pidan.

## 4. Registrar — una llamada

Escribe `.claude/pa/work/ledger.json` con una entrada por alerta mecánica y por hallazgo de
criterio, y `node .claude/pa/pa.mjs ledger add .claude/pa/work/ledger.json`:

```json
[
  { "kind": "mechanical", "rule": "<regla>", "file": "<ruta>", "line": 0, "verdict": "confirmed|dismissed", "reason": "<una línea>" },
  { "kind": "judgment", "severity": "<sev>", "file": "<ruta>", "line": 0, "scope": "task|out-of-scope",
    "shape": "<la forma del problema, sin nombres propios>", "detect": "<cómo lo vería un script>", "convertible": "yes|maybe|no" }
]
```

`reason`, `shape` y `detect`: una línea telegráfica cada uno (`report` los relee todos).
Es lo que mide la precisión de cada regla y decide qué promover a regla nueva
(`node .claude/pa/pa.mjs ledger report`). Si el script rechaza una entrada, corrígela y vuelve a
correrlo: no se escribe nada a medias.
