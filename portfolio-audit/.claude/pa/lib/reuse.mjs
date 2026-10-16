/**
 * Reutilización por nombre y código muerto: lo que un bloque copiado de 8+ líneas (clones.mjs)
 * no ve porque es corto, y lo que el diff agrega sin que nada lo use.
 *
 * Adaptado de abet-plugins (helpers.mjs y deadCode de audit-scope). Cada hit es un candidato:
 * el auditor confirma que es la misma intención (o que algo se cablea sin import).
 */

const TEST = /\.(spec|test)\.tsx?$/;
const EXPORT_DECL = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^./'"][^'"]*)['"]\s*\)/g;
/** Nombres cortos o de convención (Next.js, props), declarados en muchos archivos a propósito. */
const CONVENTIONAL = new Set(['metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'middleware', 'config', 'handler', 'Layout', 'Loading', 'NotFound', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const conventional = (name) => name.length < 6 || CONVENTIONAL.has(name) || /Props$/.test(name);
/** Entradas del framework: nadie las importa y se usan igual. */
const ENTRYPOINT = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|main|instrumentation)\.[jt]sx?$|(^|\/)(migrations|seeds?|scripts)\/|\.d\.ts$|\.config\.[jt]s$/;
const packageOf = (file) => /^apps\/(backend|frontend)\//.exec(file)?.[1] ?? 'root';

/** Índice del repo: nombre exportado → archivos (sin tests), y paquete importado dinámicamente → archivos. */
export function buildIndex(corpus) {
  const exportsIdx = new Map(), dynamic = new Map();
  const add = (map, k, f) => (map.get(k) ?? map.set(k, new Set()).get(k)).add(f);
  for (const { file, text } of corpus) {
    if (TEST.test(file)) continue;
    for (const m of text.matchAll(EXPORT_DECL)) add(exportsIdx, m[1], file);
    for (const m of text.matchAll(DYNAMIC_IMPORT)) add(dynamic, m[1], file);
  }
  return { exportsIdx, dynamic };
}

const elsewhere = (set, file) => [...(set ?? [])].filter((f) => f !== file && packageOf(f) === packageOf(file)).sort();

/** Algo que el diff declara y el repo ya exporta en otro archivo del mismo paquete. */
export function findRedeclared({ file, added, index }) {
  if (TEST.test(file) || ENTRYPOINT.test(file)) return [];
  const out = [];
  for (const { n, line } of added) {
    const d = TOP_LEVEL_DECL.exec(line);
    if (d && !conventional(d[1])) {
      const others = elsewhere(index.exportsIdx.get(d[1]), file);
      if (others.length) out.push({ rule: 'redeclared-export', line: n, msg: `${d[1]} ya lo exporta ${others[0]}${others.length > 1 ? ` (+${others.length - 1})` : ''}: importarlo en vez de declarar otro` });
    }
    for (const m of line.matchAll(DYNAMIC_IMPORT)) {
      const others = elsewhere(index.dynamic.get(m[1]), file);
      if (others.length) out.push({ rule: 'duplicate-dynamic-import', line: n, msg: `${others[0]} ya envuelve import('${m[1]}'): usar ese wrapper` });
    }
  }
  return out;
}

/**
 * Código muerto que agrega el diff: exports nuevos que ningún otro archivo de producción nombra,
 * y archivos nuevos que nadie importa. Solo usados por un test también cuenta: el test prueba
 * algo que la aplicación no usa.
 */
export function findDeadCode({ file, added, isNew, corpus }) {
  if (TEST.test(file) || ENTRYPOINT.test(file) || !/^apps\/.*\.tsx?$/.test(file)) return [];
  const out = [];
  const others = corpus.filter((c) => c.file !== file && packageOf(c.file) === packageOf(file));
  const prod = others.filter((c) => !TEST.test(c.file));
  const usedIn = (name, set) => set.filter((c) => new RegExp(`\\b${name}\\b`).test(c.text));

  // Calibrado con el backtest (425 alertas en 83 PRs con la definición amplia): los tipos que el
  // propio archivo usa en sus firmas y las funciones puras exportadas para testearlas son el
  // patrón del repo, no código muerto. Solo cuenta lo de runtime que nadie usa en ningún lado.
  const own = corpus.find((c) => c.file === file)?.text ?? '';
  for (const { n, line } of added) {
    const m = line.match(/^export\s+(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/);
    if (!m || CONVENTIONAL.has(m[1])) continue;
    if ((own.match(new RegExp(`\\b${m[1]}\\b`, 'g')) || []).length > 1) continue; // lo usa su propio archivo
    if (usedIn(m[1], others).length) continue; // lo usa otro archivo, aunque sea un test
    out.push({ rule: 'dead-export', line: n, msg: `${m[1]} no lo usa nadie (ni otro archivo, ni un test, ni su propio archivo): borrarlo` });
  }
  if (isNew) {
    const stem = file.split('/').pop().replace(/\.[jt]sx?$/, '');
    const imported = prod.some((c) => new RegExp(`['"][^'"]*/${stem.replace(/[.]/g, '\\.')}(\\.[jt]sx?)?['"]`).test(c.text));
    if (!imported) out.push({ rule: 'dead-file', line: 1, msg: `archivo nuevo que ningún archivo de producción importa` });
  }
  return out;
}
