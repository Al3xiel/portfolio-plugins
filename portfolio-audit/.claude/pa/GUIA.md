# Guía de comandos y casos — herramientas pa-* (PORTFOLIO-AUDIT)

Todo es local: `.claude/` y `CLAUDE.local.md` no se suben al repositorio. Respaldo en
`Al3xiel/portfolio-plugins` (ver *Respaldo*).

Dos tipos de comando:
- **Skills** (`/pa-…`): se escriben en el chat de Claude Code y guían un flujo con criterio.
- **Script** (`node .claude/pa/pa.mjs <modo>`): hace lo mecánico en una llamada, sin gastar tokens del
  modelo en contar, buscar o leer salidas largas. Las skills lo usan solas; también se puede correr a mano.

## Skills

| Skill | Para qué |
| --- | --- |
| `/pa-plan-feature <idea>` | Planificar una funcionalidad sin comprometerse a construirla: deja una propuesta |
| `/pa-define-task <pedido \| propuesta \| plan existente>` | Convertir un pedido o una propuesta aprobada en tarea; o actualizar el alcance de una tarea en curso |
| `/pa-quick <pedido \| plan>` | Cambio chico y de bajo riesgo: planificar y construir en una sesión |
| `/pa-implement [plan] [serial]` | Construir una tarea grande por lotes, con TDD y evidencia en el plan |
| `/pa-audit [lite\|deep]` | Revisar lo que hizo la tarea antes del PR |
| `/pa-create-pr` | Decidir si el cambio merece su propio merge a main y abrir el PR |
| `/pa-address-review [comentarios \| n° PR]` | Atender la revisión de un PR con un commit en la misma rama |
| `/pa-reconcile --session <s> \| [slug…]` | Encontrar contradicciones, duplicaciones y dependencias entre tareas y propuestas que se cruzan |
| `/pa-module-doc <módulo>` | Escribir o refrescar el doc corto de un módulo |
| `/pa-guide <pregunta>` | Esta guía: qué comando usar para un caso |

## Script `pa.mjs`

| Modo | Para qué |
| --- | --- |
| `diff [--depth lite\|deep]` | Medir el cambio: archivos, líneas, alertas mecánicas, profundidad de auditoría |
| `test [--tsc] [spec…]` | Tests y typecheck; devuelve solo conteos y fallos |
| `fix [archivo…]` | Prettier y `eslint --fix` sobre lo cambiado; muestra lo que queda |
| `outline <archivo>` | Mapa de símbolos (o secciones de un `.md`) con rangos de línea |
| `module <ruta \| módulo>` | Qué doc corto leer antes de explorar, y si está desactualizado |
| `impact <ruta>…` | Costo de tocar unas rutas: tamaño, cambios y fixes, superficie sensible, specs |
| `migration <nombre>` | SQL de migración comparando schema contra schema, sin tocar la base |
| `pr` | Hechos del PR: commits, migraciones, endpoints y su permiso, ramas abiertas para juntar |
| `gate [plan]` | ¿Cabe el plan en `/pa-quick`? |
| `tasks [plan]` | El plan sin lo cerrado ni lo obsoleto |
| `proposals [--status x]` | Propuestas por estado, y si el código que citan cambió |
| `session new\|add\|remove\|show\|close\|list` | Agrupar planes y propuestas en sesiones (se sincronizan solas al consultarlas) |
| `convert <prop-slug> [--keep]` | Tras convertir una propuesta en tarea: la archiva dentro del plan, la borra y actualiza sesiones y referencias (`--keep` la conserva) |
| `overlap [--session s] [slug…]` | Dónde se cruzan planes y propuestas, con la línea de cada uno |
| `debt [--check] [--save]` | Deuda estructural, puntos calientes; `--check` falla si creció |
| `ledger add\|import\|report` | Registro de auditorías: precisión de reglas y qué promover a regla nueva |
| `backtest [--last N] [--labels tsv]` | Las reglas sobre PRs ya mergeados (para calibrarlas) |

## Casos

### Tengo una idea, pero no sé si se hará
`/pa-plan-feature <idea>` → propuesta en `.claude/pa/proposals/prop-<slug>.md` con necesidad, impacto,
alternativas, riesgos y esfuerzo. Se discute; para aprobarla, `Estado: aprobada`. Si se decide
construir: `/pa-define-task .claude/pa/proposals/prop-<slug>.md`, que escribe `plan-<slug>.md` y corre
`pa.mjs convert`: la propuesta se borra (su contenido queda en el plan, sección *Propuesta original*) y sus
sesiones y referencias pasan al plan solas.

### Hay que construir una funcionalidad
`/pa-define-task <pedido>` → plan en `.claude/pa/work/plan-<slug>.md`, y te dice el carril. `/clear`.
Carril rápido: `/pa-quick <plan>`. Completo: `/pa-implement`. Después `/pa-audit` y `/pa-create-pr`.
Toda la funcionalidad va en **un** PR.

### Es un arreglo chico
`/pa-quick <pedido>`. Al terminar no se abre PR solo para eso: se suma la siguiente tarea chica a la misma
rama, o se junta con otra rama abierta (`pa.mjs pr` las lista). PR cuando el lote valga un despliegue.

### Es urgente y tiene que llegar hoy a producción
El único caso de PR propio para algo chico. Dilo explícitamente al pedirlo; `/pa-create-pr` lo respeta.

### Cambió lo que se pidió a mitad de la tarea
`/pa-define-task` sobre el plan existente: agrega tareas, marca `- [-] … (obsoleta: motivo)` las que ya no
aplican, conserva lo hecho, vuelve a pasar `gate` y `overlap`.

### Varias tareas o propuestas tocan lo mismo
1. Agruparlas: `node .claude/pa/pa.mjs session new <nombre> --goal "…" <slug…>` (después
   `session add|remove`).
2. Ver dónde chocan: `node .claude/pa/pa.mjs overlap --session <nombre>`.
3. Conciliar: `/pa-reconcile --session <nombre>` → clasifica cada cruce, pregunta lo que hay que decidir,
   escribe *Coordinación* en cada documento y en la sesión.
Si chocan en archivos o migraciones, lo normal es una sola rama y un PR.

### Me dejaron comentarios en el PR
`/pa-address-review` (pegando los comentarios o con el número del PR) → clasifica, pregunta lo que
cambia decisiones, un commit de corrección en la misma rama.

### El PR toca auth, roles, S3 o credenciales
`/pa-audit` lo detecta y recomienda `/claude-security scan my branch at <nivel>`. Commitea, corre el
escaneo, y vuelve a `/pa-audit`: importa el informe y no repite ese trabajo.

### Retomo una tarea otro día
Sesión nueva (o `/clear`) en la rama → `/pa-implement`: lee solo lo abierto del plan.

### No conozco el módulo
`node .claude/pa/pa.mjs module <ruta>`: si tiene doc, se lee eso primero. Si no tiene o está
desactualizado: `/pa-module-doc <módulo>` (una vez; ahorra en todas las tareas siguientes).

### Tengo que tocar un archivo gigante
`node .claude/pa/pa.mjs outline <archivo>` y leer solo el rango del método. Si está por encima de 1200
líneas, se le pueden sumar ≤ 40 líneas (un arreglo); lo nuevo va en un archivo propio.

### El hook rechazó un archivo nuevo
Te dice por qué y qué usar: renombrarlo por su tipo (`.calc.ts`, `.rule.ts`, `.mapper.ts`…) o moverlo a
su capa. Si es una excepción justificada: la ruta en `.claude/pa/naming-exceptions.txt` con `# motivo`.

### Necesito una migración
`node .claude/pa/pa.mjs migration <nombre_snake>`: escribe el SQL desde el schema, marca lo destructivo.
Nunca `prisma migrate dev` (el `.env` es producción). Se aplica sola al mergear a main.

### Solo cambié docs
No abre PR propio (cada merge corre el pipeline completo): va con el próximo PR con código.

### Quiero saber cuánta deuda hay o si la empeoré
`node .claude/pa/pa.mjs debt` (foto y puntos calientes); `debt --check` antes del PR. Después de un
refactor que la baja: `debt --save` para mover la línea base.

### Las reglas marcan falsos positivos
Anotarlo en la auditoría (queda en el ledger). Para calibrar: `node .claude/pa/pa.mjs backtest --last 83`
y `node --test .claude/pa/test/rules.test.mjs` (ver `.claude/pa/README.md`, *Cambiar o agregar una regla*).

### Respaldo
Guardar: `node <respaldo>/sync.mjs D:/UPC/ABET/PORTFOLIO-AUDIT`, revisar `git diff`, commit con
mensaje aprobado. Restaurar en otra máquina o checkout: `node <respaldo>/restore.mjs <checkout>`.

## Nombres

- Tareas: `.claude/pa/work/plan-<slug>.md`; su rama, `feat/<slug>` o `fix/<slug>` (sin prefijo).
- Propuestas: `.claude/pa/proposals/prop-<slug>.md`.
- El hook rechaza un documento nuevo sin su prefijo. Al convertir, el slug se conserva: `prop-x` → `plan-x`.

## Dónde vive cada cosa

```
CLAUDE.local.md                 instrucciones del proyecto (se cargan en cada sesión)
.claude/rules/                  reglas por paquete (se cargan al tocar sus archivos)
.claude/skills/pa-*/            las skills
.claude/pa/pa.mjs, lib/, hooks/ el script, sus reglas y los hooks
.claude/pa/work/                planes de tareas (uno por rama)
.claude/pa/proposals/           propuestas de funcionalidades
.claude/pa/sessions/<s>/        sesiones: agrupan planes y propuestas (no los mueven)
.claude/pa/ledger/              registro de auditorías
.claude/pa/GUIA.md              esta guía · README.md: mantenimiento de las reglas
```
