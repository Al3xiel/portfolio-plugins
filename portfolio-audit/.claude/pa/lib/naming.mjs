/**
 * Estándar de estructura para archivos NUEVOS de PORTFOLIO-AUDIT.
 *
 * Adaptado de abet-plugins (file-naming v2: "un nombre dice para qué es el archivo, nunca cómo está
 * escrito; un tipo por archivo, una carpeta por tipo") a las capas que este repo ya adoptó en
 * blackboard y evidence: domain / application / infrastructure / presentation. El vocabulario sale
 * de lo que esos módulos ya usan (domain/*.repository.ts es el puerto; infrastructure/*.repository.ts,
 * la implementación con Prisma).
 *
 * Solo se revisan rutas nuevas (un `git mv` es una ruta nueva). Lo heredado nunca se bloquea.
 * Dos llamadores, una regla: el hook de Write (frena al crear, cuando corregir es más barato) y
 * `pa.mjs diff` (cubre lo creado por Bash, renombres y personas).
 */

/** tipo → capas donde puede vivir. `.` es la raíz del módulo. */
export const KIND_LAYERS = {
  module: ['.'],
  controller: ['presentation'], dto: ['presentation'], response: ['presentation'], gateway: ['presentation'],
  guard: ['presentation'], decorator: ['presentation'], pipe: ['presentation'], interceptor: ['presentation'],
  service: ['application'], job: ['application'], template: ['application'],
  entity: ['domain'], types: ['domain'], interface: ['domain'], calc: ['domain'], rule: ['domain'],
  policy: ['domain'], value: ['domain'],
  repository: ['domain', 'infrastructure'], // puerto en domain, implementación Prisma en infrastructure
  mapper: ['domain', 'infrastructure'], errors: ['domain', 'infrastructure'], constants: ['domain', 'infrastructure'],
  client: ['infrastructure'], provider: ['infrastructure'], factory: ['infrastructure'], builder: ['infrastructure'],
  renderer: ['infrastructure'], cache: ['infrastructure'], store: ['infrastructure'], storage: ['infrastructure'],
  concurrency: ['infrastructure'], config: ['infrastructure', '.'],
  prompts: ['infrastructure'], // definiciones de prompts para el motor ACC-IA (backtest: #71)
};
export const LAYERS = ['domain', 'application', 'infrastructure', 'presentation'];
const KINDS = Object.keys(KIND_LAYERS);

/** Qué tipo usar en vez de un nombre genérico (el árbol de decisión de abet). */
const INSTEAD = 'nómbralo por lo que hace: un cálculo → .calc.ts, una regla de auditoría → .rule.ts, ' +
  'un mapeo → .mapper.ts, quién puede qué → .policy.ts, la base → un método de .repository.ts, ' +
  'un sistema externo → .client.ts, un PDF/Excel/ZIP → .builder.ts';
const GENERIC = /^(utils?|helpers?|functions|common|misc|transforms|shared)$/;

/** Fuera del alcance: arranque, Prisma, scripts, tests y declaraciones. */
const EXEMPT = /^apps\/backend\/(prisma|scripts|test)\/|^apps\/backend\/src\/(main|app\.module)\.ts$|\.(spec|test)\.tsx?$|\.d\.ts$/;
/** Carpetas transversales heredadas: piden tipo, no capa. */
const CROSS = /^apps\/backend\/src\/(common|config|database)\//;

const FRONT_ROUTE_FILES = /^(page|layout|route|loading|error|not-found|template|default|global-error)\.tsx?$/;

/**
 * `file`: ruta nueva relativa a la raíz. `listDir(dir)` → archivos trackeados bajo `dir` (para saber
 * si el módulo existe y si ya tiene capas). Devuelve `null` si cumple, o `{ rule, msg }`.
 */
export function checkNewPath(file, listDir) {
  if (file.startsWith('apps/backend/src/') && /\.ts$/.test(file) && !EXEMPT.test(file)) return checkBackend(file, listDir);
  if (file.startsWith('apps/frontend/src/') && /\.tsx?$/.test(file) && !EXEMPT.test(file)) return checkFrontend(file);
  return null;
}

function checkBackend(file, listDir) {
  const name = file.split('/').pop();
  const parts = name.replace(/\.ts$/, '').split('.');
  // <nombre>.<tipo>.ts, o <nombre>.<tipo>.interface.ts para un contrato
  const kind = parts.length >= 3 && parts.at(-1) === 'interface' ? 'interface' : parts.length >= 2 ? parts.at(-1) : null;
  if (kind && GENERIC.test(kind)) return { rule: 'naming-standard', msg: `".${kind}.ts" no dice para qué es el archivo: ${INSTEAD}` };
  if (!kind) return { rule: 'naming-standard', msg: `"${name}" sin tipo: usa <nombre>.<tipo>.ts (${INSTEAD})` };
  if (!KINDS.includes(kind)) return { rule: 'naming-standard', msg: `tipo ".${kind}" fuera del vocabulario (${KINDS.join(', ')}); agregar uno nuevo es una decisión del equipo en .claude/pa/lib/naming.mjs` };
  if (CROSS.test(file)) return null;

  const m = file.match(/^apps\/backend\/src\/modules\/([^/]+)\/(.*)$/);
  if (!m) {
    const top = file.match(/^apps\/backend\/src\/([^/]+)\//)?.[1];
    if (top && !listDir(`apps/backend/src/${top}/`).length) {
      return { rule: 'naming-standard', msg: `módulo nuevo fuera de src/modules/: va en apps/backend/src/modules/${top}/ con capas (${LAYERS.join(', ')})` };
    }
    return null; // módulo heredado plano (academic, s3…): se exige el tipo, no la capa
  }
  const [, mod, rest] = m;
  const existing = listDir(`apps/backend/src/modules/${mod}/`);
  const layered = !existing.length || existing.some((f) => LAYERS.some((l) => f.includes(`/modules/${mod}/${l}/`)));
  if (!layered) return null; // módulo heredado sin capas (auditorias): se exige el tipo; las capas llegan con su refactor
  const layer = rest.includes('/') ? rest.split('/')[0] : '.';
  const allowed = KIND_LAYERS[kind];
  if (!allowed.includes(layer)) {
    const where = allowed.map((l) => (l === '.' ? 'la raíz del módulo' : `${l}/`)).join(' o ');
    return { rule: 'naming-standard', msg: `un .${kind}.ts va en ${where} de modules/${mod}/, no en ${layer === '.' ? 'la raíz' : `${layer}/`}` };
  }
  return null;
}

function checkFrontend(file) {
  const rel = file.slice('apps/frontend/src/'.length);
  const name = rel.split('/').pop();
  if (/(Utils?|Helpers?)\.tsx?$/.test(name) || /(^|\/)helpers?\//.test(rel)) {
    return { rule: 'naming-standard', msg: 'Utils/Helpers no dice qué hace: una función pura va en lib/ con el nombre de lo que calcula; un mapeo, <cosa>Mapper.ts; un hook, hooks/use<Algo>.ts' };
  }
  if (/^components\/[^/]+\.tsx?$/.test(rel)) {
    return { rule: 'naming-standard', msg: 'componente suelto en components/: va en components/<área>/ (audit, blackboard, evidencias…)' };
  }
  if (rel.startsWith('app/') && !FRONT_ROUTE_FILES.test(name)) {
    return { rule: 'naming-standard', msg: 'app/ es el cascarón de las rutas (page, layout, loading…): el componente va en components/<área>/ y la página lo importa' };
  }
  return null;
}
