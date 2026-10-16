/**
 * Deuda estructural medible: lo que hace que el código sea caro de leer y de cambiar, tanto para
 * una persona como para un agente (un archivo de 7000 líneas se paga en tokens cada vez que se toca).
 *
 * Dos usos, una sola definición:
 * - `pa.mjs debt`: la foto del repo (línea base y puntos calientes) para priorizar qué pagar primero.
 * - las alertas de `pa.mjs diff`: que ninguna tarea agregue deuda nueva sobre las líneas que escribe.
 *   El código heredado no bloquea: lo que se exige es no empeorarlo (adaptado de la regla de
 *   "grandfathering" de abet-plugins: los archivos viejos fuera del estándar se toleran, pero no crecen).
 */

export const LARGE = 1200;
export const WARN = 600;
/** Una página de `app/` es el cascarón de la ruta: la lógica vive en componentes, hooks y lib. */
export const PAGE_LIMIT = 300;
/**
 * Cuánto puede crecer un archivo ya grande sin extraer. Calibrado con el backtest (83 PRs): la
 * mitad de los PRs que tocan un archivo gigante le suman ≤ 18 líneas (un arreglo); 16 PRs le
 * sumaron más de 40 (una feature metida en el archivo). Lo primero se tolera; lo segundo no.
 */
export const GROWTH_TOLERANCE = 40;

const TEST = /\.(spec|test)\.tsx?$/;
/** Nombres que dicen cómo está escrito el archivo, no para qué sirve (abet-plugins, file-naming v2). */
export const GENERIC_BACKEND = /\.(utils?|helpers?|functions|common|misc|transforms)\.ts$/;
export const GENERIC_FRONTEND = /(Utils?|Helpers?)\.tsx?$|\/helpers?\//;
/** Acceso a la base: solo en repositorios (y en el servicio de Prisma mismo). */
export const DB_ACCESS = /this\.prisma\.(?!withRetry\b)[a-zA-Z]+\.(find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate|groupBy)\(|\.\$(queryRaw|executeRaw)\w*`?\(?|\.\$transaction\(/;
const DB_ALLOWED = /\.repository\.ts$|(^|\/)(database|prisma)\/|prisma\.service\.ts$/;

/** Dirección de dependencias en los módulos con capas (blackboard, evidence): de afuera hacia el dominio. */
const LAYER_RULES = [
  { from: 'domain', forbidden: /(\.\.\/|\/)(application|infrastructure|presentation)\//, msg: 'domain/ no importa de application, infrastructure ni presentation: el dominio no depende de nada' },
  { from: 'application', forbidden: /(\.\.\/|\/)presentation\//, msg: 'application/ no importa de presentation/' },
];

export function isGenericName(file) {
  if (TEST.test(file)) return false;
  if (file.startsWith('apps/backend/')) return GENERIC_BACKEND.test(file);
  if (file.startsWith('apps/frontend/')) return GENERIC_FRONTEND.test(file);
  return false;
}

export function layerOf(file) {
  return file.match(/^apps\/backend\/src\/modules\/[^/]+\/(domain|application|infrastructure|presentation)\//)?.[1] ?? null;
}

export function layerViolations(file, lines) {
  const layer = layerOf(file);
  if (!layer) return [];
  const out = [];
  for (const r of LAYER_RULES.filter((x) => x.from === layer)) {
    for (const { n, line } of lines) {
      if (/^\s*import\b/.test(line) && r.forbidden.test(line)) out.push({ line: n, msg: r.msg });
    }
  }
  return out;
}

/**
 * Alertas de deuda sobre lo que agrega un diff. `size` es el tamaño del archivo hoy y `before` el
 * que tenía en la base; `isNew` si el archivo no existía.
 */
export function debtAlerts({ file, added, size, before, isNew, hasRepository = false }) {
  if (TEST.test(file) || !/^apps\/.*\.tsx?$/.test(file)) return [];
  const out = [];
  if (isNew && isGenericName(file)) {
    out.push({ rule: 'generic-file-name', line: 1, msg: 'nombre genérico (utils/helpers/functions): nómbralo por lo que hace — un cálculo, un mapeo, una regla, un cliente…' });
  }
  const grew = size - (before ?? 0);
  if (size > LARGE && (isNew || grew > GROWTH_TOLERANCE)) {
    out.push({ rule: 'large-file-growth', line: 1, msg: isNew
      ? `archivo nuevo de ${size} líneas (> ${LARGE}): divídelo por responsabilidad antes de mergear`
      : `crece ${grew} línea(s) un archivo de ${size} (> ${LARGE}): lo nuevo va en un archivo propio que este importe` });
  } else if (isNew && size > WARN) {
    out.push({ rule: 'large-new-file', line: 1, msg: `archivo nuevo de ${size} líneas (> ${WARN}): ¿una sola responsabilidad?` });
  }
  if (/^apps\/frontend\/src\/app\/.*page\.tsx$/.test(file) && size > PAGE_LIMIT && (isNew || grew > GROWTH_TOLERANCE)) {
    out.push({ rule: 'page-with-logic', line: 1, msg: `page.tsx de ${size} líneas crece ${grew}: la página es el cascarón de la ruta, la lógica va en un componente o hook` });
  }
  // Calibrado: exigirlo en todo servicio heredado marcaba 26 de 83 PRs. Se exige donde ya hay dónde
  // ponerlo (el módulo tiene repositorio) y en archivos nuevos, que nacen bien.
  if (file.startsWith('apps/backend/') && !DB_ALLOWED.test(file) && (isNew || hasRepository)) {
    for (const { n, line } of added) {
      if (DB_ACCESS.test(line)) { out.push({ rule: 'db-access-outside-repository', line: n, msg: 'acceso a Prisma fuera de un repositorio: muévelo a un método de <módulo>.repository.ts' }); break; }
    }
  }
  for (const v of layerViolations(file, added)) out.push({ rule: 'layer-violation', ...v });
  return out;
}

/** La foto del repo: métricas por archivo para `pa.mjs debt`. */
export function measure(corpus) {
  const files = corpus.filter((c) => !TEST.test(c.file) && /^apps\/.*\.tsx?$/.test(c.file));
  const lines = (c) => c.text.split('\n').length;
  const m = {
    files: files.length,
    lines: files.reduce((s, c) => s + lines(c), 0),
    large: files.filter((c) => lines(c) > LARGE).map((c) => ({ file: c.file, lines: lines(c) })).sort((a, b) => b.lines - a.lines),
    medium: files.filter((c) => lines(c) > WARN && lines(c) <= LARGE).length,
    generic: files.filter((c) => isGenericName(c.file)).map((c) => c.file),
    dbOutside: files.filter((c) => c.file.startsWith('apps/backend/') && !DB_ALLOWED.test(c.file) && DB_ACCESS.test(c.text)).map((c) => c.file),
    repositories: files.filter((c) => c.file.endsWith('.repository.ts')).length,
    fatPages: files.filter((c) => /^apps\/frontend\/src\/app\/.*page\.tsx$/.test(c.file) && lines(c) > PAGE_LIMIT).map((c) => ({ file: c.file, lines: lines(c) })),
    layer: files.flatMap((c) => layerViolations(c.file, c.text.split('\n').map((line, i) => ({ n: i + 1, line }))).map((v) => `${c.file}:${v.line}`)),
  };
  m.inLarge = m.large.reduce((s, x) => s + x.lines, 0);
  return m;
}
