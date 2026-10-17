# .claude/pa — mantenimiento

**Solo local.** Todo `.claude/` y `CLAUDE.local.md` están excluidos en `.git/info/exclude`: no se
suben al repositorio ni aparecen en `git status`. La configuración va en `.claude/settings.local.json`.
Si algún día se comparte con el equipo, se mueve a `.claude/settings.json` y `CLAUDE.md` y se quita la
exclusión.

Lo mecánico de las skills `pa-*`. Este archivo no se carga en las sesiones: es para quien
cambia las reglas.

```
pa.mjs                 CLI: diff · test · fix · outline · migration · pr · gate · tasks · exec · backtest
hooks/filter-output.mjs  PreToolUse: jest/vitest/tsc/eslint directos → pa.mjs exec (salida filtrada)
lib/clones.mjs         duplicados ("regla de tres"), adaptado de abet-plugins
lib/reuse.mjs          helpers redeclarados y código muerto
lib/security.mjs       reglas de seguridad (alcance = careerCode / usuario / ruta S3)
test/rules.test.mjs    recall: cada regla detecta su patrón sembrado y calla ante el correcto
work/                  planes por rama y resultados de backtest (ignorado por git)
modules.json           módulo → rutas y docs cortos (pa.mjs module)
proposals/prop-<slug>.md    propuestas de funcionalidades de /pa-plan-feature (flujo aparte: planificar
                       no compromete a construir; aprobada → /pa-define-task la convierte en tarea)
ledger/<rama>.jsonl    registro de auditorías, un archivo por rama
```

## El ciclo del ledger

Cada `/pa-audit` anota qué alertas confirmó o descartó y qué encontró por criterio.
`node .claude/pa/pa.mjs ledger report` muestra:

- **Precisión de cada regla** según lo que los auditores confirmaron. Por debajo de 50 % con 4 o más
  revisiones: afinarla con el motivo de descarte más común. Reemplaza el etiquetado manual del TSV.
- **Hallazgos de criterio que se repiten en ramas distintas** y una máquina podría detectar:
  candidatos a regla nueva (pasos de abajo). Cada regla promovida es trabajo que el modelo deja de
  hacer en todas las auditorías siguientes.

Revisarlo cada pocas semanas, o cuando haya 10 o más ramas nuevas en `ledger/`.

Etiquetado manual (opcional): llenar la columna `label` del TSV y
`node .claude/pa/pa.mjs backtest --labels .claude/pa/work/backtest-<fecha>.tsv`.

## Cambiar o agregar una regla

1. Escribe el caso sembrado en `test/rules.test.mjs` (el patrón malo y el correcto).
2. Implementa la regla hasta que pase: `node --test .claude/pa/test/rules.test.mjs`.
3. Mide la precisión sobre PRs reales: `node .claude/pa/pa.mjs backtest --last 83`.
4. Etiqueta una muestra del `work/backtest-*.tsv` (columna `label`: real · intencional · falso).
   Cada falso positivo encontrado se agrega al test como regresión, y se ajusta la regla.
5. Una regla que se equivoca más de lo que acierta genera trabajo: se afina o se quita.

El `.json` del backtest guarda los datos crudos para simular umbrales sin volver a correrlo.

## Estándar de estructura

`lib/naming.mjs` define el estándar para archivos **nuevos**: `<nombre>.<tipo>.ts`, con las capas
que ya usan blackboard y evidence (`domain`, `application`, `infrastructure`, `presentation`) y el
vocabulario de tipos adaptado de abet-plugins (file-naming v2). Tabla para humanos en
`.claude/rules/backend.md` y `frontend.md`.

- `hooks/file-name-guard.mjs` (PreToolUse en `Write`) lo rechaza al crear, con la razón y la
  alternativa; `pa.mjs diff` lo reporta como `naming-standard` (cubre lo creado por Bash y los
  `git mv`). Lo heredado nunca se bloquea.
- Excepción deliberada: la ruta en `naming-exceptions.txt` con un `# motivo`.
- Agregar un tipo es una decisión del equipo: se cambia `KIND_LAYERS`, la tabla de las reglas y
  el test, en el mismo PR.
- Backtest (83 PRs): habría frenado 78 archivos nuevos en 22 PRs — los módulos planos fuera de
  `src/modules/` (#1, #23), los `.util.ts` de auditorias, componentes sueltos. Se agregó `prompts`
  como tipo legítimo del repo.

## Deuda estructural

`node .claude/pa/pa.mjs debt` mide la foto del repo contra `debt-baseline.json`:
archivos > 1200 líneas, nombres genéricos, Prisma fuera de repositorios, `page.tsx` con lógica,
capas invertidas, y los puntos calientes (tamaño × cambios en 180 días). `--check` falla si alguna
métrica empeora: es el trinquete para CI. `--save` actualiza la línea base cuando la deuda **baja**
(después de un refactor), nunca para tapar una subida.

Línea base (origin/main 1c2c4664, 2026-10-16): 19 archivos > 1200 líneas con el 32 % del código;
57 nombres genéricos; 64 archivos con Prisma fuera de 10 repositorios; 16 páginas con lógica.
Punto más caliente: `phase2.service.ts`, 7874 líneas, 121 cambios y 82 fixes en 6 meses.

Las alertas de `diff` aplican la misma definición a las líneas que agrega una tarea, calibradas con
el backtest (de 60 a 34 PRs de 83): un archivo gigante tolera un arreglo (≤ 40 líneas) pero no una
feature; Prisma fuera de repositorio se exige en archivos nuevos y en módulos que ya tienen repositorio.

## Seguridad: herramientas oficiales de Anthropic y cómo encajan

| Capa | Herramienta | Uso aquí |
| --- | --- | --- |
| Cada PR | `/pa-audit` | Reglas de `pa.mjs` (gratis) + lente de Acceso con el modelo de amenazas de `.claude/claude-security-guidance.md` y el criterio de `/security-review` (escenario de explotación, confianza ≥ 8, exclusiones). |
| PR que toca la superficie de acceso | Plugin **`claude-security`** (habilitado en `.claude/settings.local.json`), modo *Scan changes* | **Sí, cuando `diff` lo recomienda** (~17 % de los PRs del backtest): auth, roles, S3, credenciales, o una alerta de permisos. Multiagente con panel de 3 verificadores por hallazgo; solo reporta lo que el cambio introduce. Reemplaza al subagente de Acceso de `deep`. `ledger import` lleva sus hallazgos al registro. |
| Periódico | `claude-security`, modo *Scan codebase* por área | Revisión del repo por áreas (API, auth), no por tarea. Lo que encuentre se vuelve tarea propia. |
| A pedido | `/security-review` (integrado) | No dentro de `/pa-audit`: pega el diff entero en el prompt y lanza un subagente por hallazgo. Segunda opinión puntual. |
| Mientras se escribe | Plugin `security-guidance` | **No activado**: revisa cada turno que cambia archivos con Opus 4.7 (costo automático). Si se activa, ya lee `.claude/claude-security-guidance.md`. |

Datos del plugin `claude-security` verificados en su código (claude-plugins-official, v0.12.0):

- Investigadores y verificadores corren en el **modelo de la sesión** (recomienda Opus 5.5 o Fable 5.1);
  inventario, carga y redacción en Sonnet. El nivel elige cuántos investigadores: `low` uno para todo
  el cambio; `medium` uno por grupo de 25 archivos más uno que sigue los llamadores; `high` uno por
  categoría por grupo. Todos terminan en el mismo panel de 3 votos.
- Solo escanea cambios **commiteados**. Necesita la herramienta Workflow (planes pagos; en Pro se
  activa en `/config`) y `python3` ≥ 3.9.
- Lee el repo, `CLAUDE.md` y comentarios **como evidencia, no como instrucción**: no acepta un
  modelo de amenazas propio. Por eso lo específico del repo (alcance por carrera) lo sigue cubriendo
  `/pa-audit`.
- Escribe `CLAUDE-SECURITY-<fecha>/` con su propio `.gitignore` (md, jsonl, sarif y sello de revisión
  con el commit). Los parches nunca se aplican solos.

`.claude/claude-security-guidance.md` es la fuente única del modelo de amenazas del repo: la lee
`/pa-audit` (y el plugin `security-guidance`, si algún día se activa). Si cambia una regla de acceso,
se cambia ahí.

## Técnicas evaluadas y no adoptadas

| Técnica | Decisión | Por qué |
| --- | --- | --- |
| `model:` en el frontmatter de las skills (Sonnet implementa, Haiku lee…) | No | Cada modelo tiene su caché: el turno con otro modelo relee todo el historial sin caché (docs de prompt caching). Elegir el modelo al iniciar la sesión. |
| `Explore` en Haiku | No | Beneficio sin medir; el filtrado de salida por script ahorra más y sin costo de calidad. |
| `.claudeignore` | No | No existe en Claude Code; lo oficial es `permissions.deny`. |
| `@imports` para partir `CLAUDE.md` | No | Se cargan igual al inicio: no ahorra contexto. Se usan reglas con `paths:`. |
| Caveman (respuestas "de cavernícola", akramsystems/caveman) | Solo la idea, acotada | Recorta solo texto de salida, que es ~0,6–2,5 % de lo facturado en una sesión de Claude Code; ahorro medido 12–25 % de ese texto, no el 65 % anunciado. Arriesga claridad en español. Se adoptó **estilo telegráfico solo en texto que vuelve al contexto** — reportes de subagentes, evidencia del plan, entradas del ledger — porque eso se reenvía en cada turno. |
| caveman-compress (comprimir `CLAUDE.md`) | No | `CLAUDE.md` tiene ~450 tokens leídos de caché: ahorraría ~200 por sesión arriesgando que se entiendan peor las reglas de producción. |

## Calibración actual (83 PRs de origin/main, 2026-10-16)

| Medida | Antes | Después |
| --- | --- | --- |
| Alertas por PR | 7,1 (588) | 1,4 (120) |
| Auditorías `deep` | 75 % | 61 % |
| Tiempo de `diff` | — | 2,6 s/PR (máx 10 s) |

- `dead-export`: 425 → 4. Ya no cuenta tipos usados en firmas ni funciones exportadas para
  testearlas (patrón del repo); solo lo que nadie usa en ningún lado.
- Falsos positivos corregidos: `@Roles` como protección (18), `select: { origin: true }` de Prisma,
  `innerHTML = ''`, claves de caché armadas antes con `userId`, `Map` locales por llamada.
- Profundidad: 800 líneas / 15 archivos; "backend y frontend" solo con más de 400 líneas;
  rutas sensibles siempre `deep`.
