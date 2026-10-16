/**
 * Código duplicado que agrega un diff, contado contra todo el repositorio ("regla de tres").
 *
 * Adaptado de abet-plugins (shared/scripts/lib/clones.mjs). Dos copias se toleran; la tercera es
 * la señal para extraer una función, servicio o componente compartido. Un modelo al que se le
 * pregunta "¿esto está duplicado?" responde con lo que alcanzó a abrir; esto cuenta.
 *
 * Método: se quitan comentarios y líneas de ruido, se toma cada ventana de W líneas
 * significativas y se busca la misma ventana en otro lado, en dos variantes:
 *   exact    — idéntica tras normalizar espacios y comentarios
 *   renamed  — idéntica con identificadores, strings y números enmascarados (una copia con las
 *              variables renombradas), con ventana más larga para no meter ruido
 * Las ventanas contiguas se unen en bloques y los bloques se agrupan por región nueva.
 */

export const W_EXACT = 8;
export const W_RENAMED = 10;
const MIN_CHARS_EXACT = 160;
const MIN_CHARS_RENAMED = 220;
/** Una ventana enmascarada necesita líneas de forma distinta: si no, una lista de columnas o de props JSX calza con cualquier otra. */
const MIN_DISTINCT_RENAMED = 4;
/** Más copias que esto es una convención del equipo (un esqueleto repetido a propósito), no reutilización perdida. */
export const TEMPLATE_COPIES = 12;

/** Ni código nuevo ni corpus: tests, migraciones y archivos declarativos se repiten por diseño. */
export const NOT_COMPARED = new RegExp([
  '\\.(spec|test)\\.[jt]sx?$',
  '\\.d\\.ts$',
  '(^|/)migrations/',
  '(^|/)prisma/seeds?/',
  '\\.(dto|dtos|entity|module|swagger|constants|types)\\.[jt]sx?$',
  '(^|/)dto/',
  '(^|/)(node_modules|dist|build|coverage|out|\\.next)/',
].join('|'));

export const isCloneCandidate = (file) => /\.[jt]sx?$/.test(file) && /^apps\/(backend|frontend)\//.test(file) && !NOT_COMPARED.test(file);

const KEYWORDS = new Set(('if else for while do return const let var function async await new throw try catch finally switch case ' +
  'break continue class extends implements import export default typeof instanceof of in this null undefined true false void ' +
  'yield static private public protected readonly interface type enum').split(' '));

const maskLine = (norm) => norm
  .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, 'S')
  .replace(/\b\d+(?:\.\d+)?\b/g, 'N')
  .replace(/\b[A-Za-z_$][\w$]*\b/g, (id) => (KEYWORDS.has(id) ? id : '_'));

const NOISE = /^[\]})\{;,\s]*$/;
/** `name?: Type;` — miembro de interfaz, no lógica. */
const MEMBER_DECLARATION = /^(readonly\s+)?[\w$]+\??:\s*[^=(){}]+;$/;

/** Las copias en paquetes distintos no pueden compartir una extracción. */
const packageOf = (file) => /^apps\/(backend|frontend)\//.exec(file)?.[1] ?? null;

/** Líneas sin comentarios ni ruido: `{ n, norm, mask }`, con `n` la línea real. */
export function significantLines(text) {
  const out = [];
  let inBlock = false;
  let inList = false;
  text.split('\n').forEach((raw, idx) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { line = line.slice(0, open); inBlock = true; }
    line = line.replace(/(^|\s)\/\/[^'"`]*$/, '').trim();
    if (inList) {
      if (/\bfrom\s+['"]/.test(line) || /^\}\s*;?$/.test(line)) inList = false;
      return;
    }
    if (/^(import|export)\s*(type\s*)?\{[^}]*$/.test(line)) { inList = true; return; }
    if (NOISE.test(line) || /^import\b/.test(line) || /^export\s+(\*|\{)[^;]*\bfrom\b/.test(line) || line.startsWith('@')) return;
    if (MEMBER_DECLARATION.test(line)) return;
    const norm = line.replace(/\s+/g, ' ').replace(/[;,]$/, '');
    out.push({ n: idx + 1, norm, mask: maskLine(norm) });
  });
  return out;
}

const sizeOf = (lines, i, w) => lines.slice(i, i + w).reduce((n, l) => n + l.norm.length, 0);

function* windows(lines, w, field, minChars) {
  for (let i = 0; i + w <= lines.length; i++) {
    if (sizeOf(lines, i, w) < minChars) continue;
    if (field === 'mask' && new Set(lines.slice(i, i + w).map((l) => l.mask)).size < MIN_DISTINCT_RENAMED) continue;
    yield { i, key: lines.slice(i, i + w).map((l) => l[field]).join('\n') };
  }
}

/**
 *   targets: [{ file, text, addedNums: Set<number> }]  archivos cambiados y sus líneas nuevas
 *   corpus:  [{ file, text }]                          todo contra lo que se compara
 * → [{ file, start, end, kind, copies, locations, verdict: 'tolerated'|'extract'|'template' }]
 */
export function findClones({ targets, corpus }) {
  const flavours = [
    { kind: 'exact', w: W_EXACT, field: 'norm', min: MIN_CHARS_EXACT, index: new Map() },
    { kind: 'renamed', w: W_RENAMED, field: 'mask', min: MIN_CHARS_RENAMED, index: new Map() },
  ];
  const tLines = new Map();
  for (const t of targets) {
    if (!isCloneCandidate(t.file)) continue;
    const lines = significantLines(t.text);
    tLines.set(t.file, lines);
    for (const f of flavours) {
      for (const { i, key } of windows(lines, f.w, f.field, f.min)) {
        // Solo cuenta como copia del diff una ventana mayoritariamente nueva.
        if (lines.slice(i, i + f.w).filter((l) => t.addedNums.has(l.n)).length < Math.ceil(f.w / 2)) continue;
        if (!f.index.has(key)) f.index.set(key, []);
        f.index.get(key).push({ file: t.file, i });
      }
    }
  }
  if (tLines.size === 0) return [];

  const matches = [];
  for (const c of corpus) {
    if (!isCloneCandidate(c.file)) continue;
    const cl = significantLines(c.text);
    for (const f of flavours) {
      for (const { i, key } of windows(cl, f.w, f.field, f.min)) {
        for (const hit of f.index.get(key) ?? []) {
          const tl = tLines.get(hit.file);
          const tStart = tl[hit.i].n, tEnd = tl[hit.i + f.w - 1].n;
          const cStart = cl[i].n, cEnd = cl[i + f.w - 1].n;
          if (c.file === hit.file && cStart <= tEnd && tStart <= cEnd) continue;
          if (packageOf(c.file) !== packageOf(hit.file)) continue;
          matches.push({ tfile: hit.file, tStart, tEnd, cfile: c.file, cStart, cEnd, kind: f.kind });
        }
      }
    }
  }

  const blocks = [];
  const groups = new Map();
  for (const m of matches) {
    const k = `${m.tfile}\u0000${m.cfile}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.tStart - b.tStart || a.cStart - b.cStart);
    let cur = null;
    for (const m of list) {
      if (cur && m.tStart <= cur.tEnd && m.cStart >= cur.cStart && m.cStart <= cur.cEnd + 1) {
        cur.tEnd = Math.max(cur.tEnd, m.tEnd);
        cur.cEnd = Math.max(cur.cEnd, m.cEnd);
        if (m.kind === 'exact') cur.kind = 'exact';
      } else {
        if (cur) blocks.push(cur);
        cur = { ...m };
      }
    }
    if (cur) blocks.push(cur);
  }

  const findings = [];
  const byFile = new Map();
  for (const b of blocks) {
    if (!byFile.has(b.tfile)) byFile.set(b.tfile, []);
    byFile.get(b.tfile).push(b);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.tStart - b.tStart);
    let cluster = null;
    const flush = () => {
      if (!cluster) return;
      const locs = new Map([[`${file}:${cluster.tStart}`, { file, start: cluster.tStart, end: cluster.tEnd }]]);
      for (const b of cluster.blocks) locs.set(`${b.cfile}:${b.cStart}`, { file: b.cfile, start: b.cStart, end: b.cEnd });
      findings.push({
        file, start: cluster.tStart, end: cluster.tEnd,
        kind: cluster.blocks.some((b) => b.kind === 'exact') ? 'exact' : 'renamed',
        copies: locs.size, locations: [...locs.values()],
      });
    };
    for (const b of list) {
      if (cluster && b.tStart <= cluster.tEnd) {
        cluster.tEnd = Math.max(cluster.tEnd, b.tEnd);
        cluster.blocks.push(b);
      } else {
        flush();
        cluster = { tStart: b.tStart, tEnd: b.tEnd, blocks: [b] };
      }
    }
    flush();
  }

  const seen = new Set();
  return findings
    .map((f) => ({ ...f, verdict: f.copies > TEMPLATE_COPIES ? 'template' : f.copies >= 3 ? 'extract' : 'tolerated' }))
    .filter((f) => {
      const key = f.locations.map((l) => `${l.file}:${l.start}`).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.copies - a.copies || (b.end - b.start) - (a.end - a.start));
}
