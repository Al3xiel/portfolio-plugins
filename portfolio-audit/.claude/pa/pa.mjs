#!/usr/bin/env node
/**
 * El trabajo mecánico de las skills pa-*, hecho por código.
 *
 * Todo lo que un modelo haría con varias llamadas y mucha salida (medir un diff, correr tests y
 * leer miles de líneas, formatear, ubicar un método en un archivo de 6000 líneas, escribir una
 * migración) se hace aquí en una sola llamada que devuelve un resumen corto. El modelo gasta
 * tokens en criterio; el script, en lo determinista.
 *
 *   node .claude/pa/pa.mjs diff      [--base main] [--depth lite|deep]   medir el cambio y elegir la profundidad de auditoría
 *   node .claude/pa/pa.mjs test      [--tsc] [spec…]                     tests (los dados o los del diff): solo conteos y fallos
 *   node .claude/pa/pa.mjs fix       [archivo…]                          prettier + eslint --fix en lo cambiado; solo lo que queda
 *   node .claude/pa/pa.mjs outline   <archivo>                           símbolos con su rango de líneas, para leer solo uno
 *   node .claude/pa/pa.mjs migration <nombre> [--from <ref>]             SQL de migración offline (schema contra schema, sin base)
 *   node .claude/pa/pa.mjs pr        [--base main]                       hechos para el cuerpo del PR
 *   node .claude/pa/pa.mjs gate      [plan]                              ¿cabe el plan en /pa-quick?
 *   node .claude/pa/pa.mjs tasks     [plan]                              el plan sin lo ya cerrado
 *   node .claude/pa/pa.mjs debt      [--save] [--days 180] [--top 10]     deuda estructural, línea base y puntos calientes
 *   node .claude/pa/pa.mjs module    [ruta… | módulo]                    qué doc corto leer antes de explorar, y si está desactualizado
 *   node .claude/pa/pa.mjs ledger    add <entradas.json> | report        registro de auditorías: precisión de reglas y qué promover
 *   node .claude/pa/pa.mjs backtest  [--last 30] [--labels <tsv>]        las reglas sobre PRs ya mergeados
 *   node .claude/pa/pa.mjs exec      --b64 <comando>                     corre un comando y filtra su salida (lo usa el hook)
 *
 * Los planes viven en `.claude/pa/work/<slug>.md` (ignorado por git): son la memoria de trabajo
 * de una rama, no documentación del repo. El slug sale de la rama (`feat/<slug>`).
 *
 * Nunca toca la base de datos ni ejecuta la app. `test`/`fix`/`exec` corren jest, vitest, tsc,
 * eslint y prettier (los specs no abren conexión); `migration` compara dos schema.prisma.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findClones } from './lib/clones.mjs';
import { securityAlerts } from './lib/security.mjs';
import { buildIndex, findRedeclared, findDeadCode } from './lib/reuse.mjs';
import { debtAlerts, measure, LARGE } from './lib/debt.mjs';
import { checkNewPath } from './lib/naming.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const WORK = '.claude/pa/work';

/**
 * Por encima de cualquiera, la auditoría pasa a `deep`. Calibrado con `backtest` sobre 83 PRs
 * (p50 314 líneas, p75 809): con los 400/15 de ACC-SYS el 75% salía deep. Con 800 líneas, y
 * "backend y frontend" solo si además pasa de BOTH_LINES, baja a ~61% sin tocar las rutas
 * sensibles, que siempre van a deep.
 */
const LIMITS = { lines: 800, files: 15 };
const BOTH_LINES = 400;
/** Límites del carril rápido. */
const QUICK = { tasks: 4, files: 8 };
/** Un archivo más largo no se lee entero: `outline` y lectura por rango. */
const LARGE_FILE = 1200;
const MAX_FAIL_LINES = 80;

/** Rutas cuyo cambio siempre merece la auditoría profunda y saca un plan del carril rápido. */
const SENSITIVE = [
  [/^apps\/backend\/prisma\/(schema\.prisma|migrations\/)/, 'migración / schema Prisma'],
  [/^apps\/backend\/src\/(auth|roles)\//, 'auth / roles'],
  [/s3-access\.service\.ts$|^apps\/backend\/src\/s3\//, 'acceso a S3'],
  [/^apps\/backend\/src\/(llm|abet)\/|batch-api\.service\.ts$/, 'llamadas al motor ACC-IA (costo por token)'],
  [/^apps\/backend\/src\/parameters\//, 'credenciales en system.parameters'],
  [/^\.github\/workflows\/|^docker\/|Dockerfile$/, 'deploy'],
  [/(^|\/)package(-lock)?\.json$|pnpm-lock\.yaml$/, 'dependencias'],
];

const CODE = /\.(tsx?|jsx?|mjs|cjs|prisma)$/;
const NOT_SOURCE = /\.(spec|test)\.tsx?$|^docs\/|^\.claude\//;
const isSource = (p) => CODE.test(p) && !NOT_SOURCE.test(p);
/** Ruido local que nunca es parte del cambio. */
const IGNORED = /^(\.idea|\.vscode|\.claude|\.atl|odd)\//;
/** Lo único que `exec` acepta (misma expresión en hooks/filter-output.mjs). */
const SAFE_EXEC = /^\s*(cd\s+[\w./\\:-]+\s*&&\s*)?(npx\s+(jest|vitest|tsc|eslint)|npm\s+(test|run\s+(test|lint)))(\s+[^;&|`$()<>\n]*)?$/;
/** Flags sin valor: lo que les sigue es un argumento posicional. */
const BOOLEAN_FLAGS = new Set(['tsc', 'json', 'save', 'check']);
/** Secciones del plan que una sesión necesita; el resto se busca con Grep si hace falta. */
const KEEP_SECTIONS = /^(objective|scope|scope check|constraints|decisions)\b/i;

// ── diff ────────────────────────────────────────────────────────────────────────────────
function cmdDiff() {
  const base = args.base || 'main';
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const branch = currentBranch();
  const files = changedFiles(base);

  const source = [...files].filter(([p]) => isSource(p));
  const lines = source.reduce((s, [, v]) => s + v.add + v.del, 0);
  const packages = packagesOf([...files.keys()]);
  const sensitive = sensitiveHits([...files.keys()]);
  const large = [...files.keys()].filter((p) => /\.(tsx?|mjs|js)$/.test(p) && lineCount(p) > LARGE_FILE)
    .map((p) => `${p} (${lineCount(p)} líneas)`);

  const reasons = [];
  if (lines > LIMITS.lines) reasons.push(`${lines} líneas de código > ${LIMITS.lines}`);
  if (source.length > LIMITS.files) reasons.push(`${source.length} archivos de código > ${LIMITS.files}`);
  if (packages.length > 1 && lines > BOTH_LINES) reasons.push(`toca backend y frontend con ${lines} líneas > ${BOTH_LINES}`);
  for (const s of sensitive) reasons.push(`ruta sensible: ${s}`);
  let depth = reasons.length ? 'deep' : 'lite';
  if (args.depth === 'lite' || args.depth === 'deep') { depth = args.depth; reasons.unshift(`forzado: ${args.depth}`); }

  const out = [`rama: ${branch || '(detached)'}   base: ${base} (${mergeBase.slice(0, 7)})`];
  if (branch && branch === base.replace(/^origin\//, '')) {
    out.push(`aviso: estás en ${branch}; solo se mide lo no commiteado. Crea una rama (feat/<slug>) antes de trabajar.`);
  }
  out.push(`código: ${source.length} archivo(s), ${lines} líneas (+/-)   total con tests/docs: ${files.size} archivo(s)`);
  out.push(`paquetes: ${packages.join(', ') || 'ninguno'}`);
  out.push(`profundidad: ${depth}${reasons.length ? ' — ' + reasons.join('; ') : ' — cambio chico y sin rutas sensibles'}`);
  const plan = planForBranch(false);
  if (plan) out.push(planSummary(plan));
  if (large.length) out.push(`archivos grandes (outline + lectura por rango):\n  ${large.join('\n  ')}`);

  const tests = relatedTests([...files.keys()]);
  out.push(`specs relacionados: ${tests.backend.length} backend, ${tests.frontend.length} frontend → node .claude/pa/pa.mjs test --tsc`);
  if (tests.missing.length) out.push(`código sin spec al lado:\n  ${tests.missing.slice(0, 15).join('\n  ')}`);

  const alerts = mechanicalAlerts(mergeBase, [...files.keys()]);
  const securityScan = suggestSecurityScan({ lines, files: source.length, sensitive, alerts });
  if (args.json) {
    console.log(JSON.stringify({ depth, reasons, lines, files: source.length, packages, sensitive, alerts, securityScan }));
    return;
  }
  const report = securityReportForHead();
  if (report) out.push(`informe claude-security vigente para HEAD: ${report.dir} (${report.findings} hallazgo(s)) → node .claude/pa/pa.mjs ledger import`);
  else if (securityScan) out.push(`escaneo de seguridad recomendado: /claude-security scan my branch at ${securityScan.tier} — ${securityScan.why}. Solo cambios commiteados; tarda minutos y usa muchos tokens (pide confirmación).`);
  out.push(alerts.length
    ? `alertas mecánicas (${alerts.length}):\n${alerts.map((a) => `  [${a.rule}] ${a.file}${a.line ? `:${a.line}` : ''} ${a.msg}`).join('\n')}`
    : 'alertas mecánicas: ninguna');
  out.push('archivos de código:');
  for (const [p, v] of source) out.push(`  ${p}  +${v.add} -${v.del}`);
  console.log(out.join('\n'));
}

/**
 * Cuándo vale pagar el escaneo multiagente de claude-security sobre la rama: solo si el cambio toca
 * la superficie de acceso (auth, roles, S3, credenciales) o el script ya ve un agujero de permisos.
 * Para el resto, el lente de Acceso de /pa-audit alcanza. El nivel sigue la guía del plugin: un
 * investigador para un cambio chico, `high` para uno del tamaño de una feature.
 */
const SECURITY_SURFACE = new Set(['auth / roles', 'acceso a S3', 'credenciales en system.parameters']);
const SECURITY_ALERTS = new Set(['route-without-permission', 'scope-param-unused', 'career-without-assert', 'raw-sql-unsafe', 'cache-key-without-user']);

function suggestSecurityScan({ lines, files, sensitive, alerts }) {
  const surface = sensitive.filter((s) => SECURITY_SURFACE.has(s));
  const holes = [...new Set(alerts.filter((a) => SECURITY_ALERTS.has(a.rule)).map((a) => a.rule))];
  if (!surface.length && !holes.length) return null;
  const tier = files > 25 || lines > 1500 ? 'high' : lines > 400 ? 'medium' : 'low';
  return { tier, why: [...surface.map((s) => `toca ${s}`), ...holes.map((h) => `alerta ${h}`)].join(', ') };
}

/** El informe de claude-security cuyo sello de revisión es el HEAD actual, si existe. */
function securityReportForHead() {
  const head = git(['rev-parse', 'HEAD']).trim().slice(0, 12);
  const dirs = readdirSync(ROOT).filter((d) => /^CLAUDE-SECURITY-/.test(d)).sort().reverse();
  for (const d of dirs) {
    const files = readdirSync(join(ROOT, d));
    if (!files.some((f) => f.startsWith(`CLAUDE-SECURITY-REVISION-${head}`))) continue;
    const jsonl = join(ROOT, d, 'CLAUDE-SECURITY-RESULTS.jsonl');
    const findings = existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).length : 0;
    return { dir: d, findings };
  }
  return null;
}

/** path → { add, del } contra el merge-base, más los archivos nuevos sin trackear. */
function changedFiles(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const files = new Map();
  for (const line of git(['diff', '--numstat', mergeBase]).split('\n').filter(Boolean)) {
    const [a, d, p] = line.split('\t');
    if (!IGNORED.test(norm(p))) files.set(norm(p), { add: num(a), del: num(d) });
  }
  for (const p of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
    const n = norm(p);
    if (!IGNORED.test(n) && !files.has(n)) files.set(n, { add: lineCount(n), del: 0 });
  }
  return files;
}

/** Spec al lado del archivo (x.ts → x.spec.ts) y los specs que el propio diff tocó. */
function relatedTests(paths) {
  const backend = new Set(), frontend = new Set(), missing = [];
  for (const p of paths) {
    const pkg = p.match(/^apps\/(backend|frontend)\//)?.[1];
    if (!pkg || !/\.(tsx?)$/.test(p)) continue;
    const bucket = pkg === 'backend' ? backend : frontend;
    if (/\.(spec|test)\.tsx?$/.test(p)) { if (existsSync(join(ROOT, p))) bucket.add(p); continue; }
    const stem = join(dirname(p), basename(p, extname(p)));
    const found = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'].map((e) => norm(stem + e)).find((c) => existsSync(join(ROOT, c)));
    if (found) bucket.add(found);
    else if (/\.(service|util|mapper|client|repository|guard)\.ts$|\/lib\/.*\.ts$|\/domain\//.test(p)) missing.push(p);
  }
  return { backend: [...backend], frontend: [...frontend], missing };
}

/**
 * El piso mecánico de la auditoría: trampas que este repo ya documentó, duplicados, código muerto
 * y reglas de seguridad. El modelo confirma o descarta cada alerta con una razón; no las busca él.
 * → [{ rule, file, line, msg }]
 */
function mechanicalAlerts(mergeBase, paths) {
  const alerts = [];
  const push = (file, a) => alerts.push({ file, ...a });
  const targets = [];
  let corpus = null;
  const getCorpus = () => (corpus ??= loadCorpus());

  for (const p of paths) {
    if (!existsSync(join(ROOT, p)) || !/\.(tsx?)$/.test(p) || /\.(spec|test)\.tsx?$/.test(p)) continue;
    const added = addedLines(mergeBase, p);
    if (!added.length) continue;
    const text = readFileSync(join(ROOT, p), 'utf8');
    const isNew = git(['cat-file', '-e', `${mergeBase}:${p}`], true) === null;
    targets.push({ file: p, text, addedNums: new Set(added.map((a) => a.n)) });

    if (p.endsWith('.controller.ts')) {
      const specs = controllerSpecs(p);
      const routes = routesAdded(text, added);
      // La ruta nueva fija su contrato (método, ruta, permiso) en un spec: es lo que un refactor
      // rompe en silencio. Patrón del repo: <nombre>.controller.access.spec.ts con el guard real.
      // Una alerta por controlador (backtest: un controlador nuevo daba una por ruta).
      const uncovered = routes.filter((r) => r.handler && !specs.some((s) => s.includes(r.handler)));
      if (uncovered.length) {
        push(p, { rule: 'route-without-spec', line: uncovered[0].n, msg: `${uncovered.length} ruta(s) sin spec que las cubra: ${uncovered.slice(0, 4).map((r) => `${r.method} ${r.path || '/'}`).join(', ')}${uncovered.length > 4 ? '…' : ''} — patrón: academic-periods.controller.access.spec.ts` });
      }
      for (const r of routes) {
        if (r.permission?.startsWith('pública')) {
          push(p, { rule: 'public-controller', line: r.n, msg: 'ruta pública (el controlador no usa guards) — confirmar que debe ser pública' });
          continue;
        }
        if (r.permission) continue;
        push(p, r.scoped
          ? { rule: 'route-scope-only', line: r.n, msg: 'ruta sin @RequirePermission, protegida solo por assertViewable/assertCanView — confirmar que es intencional' }
          : { rule: 'route-without-permission', line: r.n, msg: 'ruta sin @RequirePermission ni @Roles ni assertCanView (PermissionsGuard deja pasar a todos)' });
      }
      if (added.some(({ line }) => /careerCode|s3Path|prefix|@Query\('path'\)|@Param\('path'\)|basePath/.test(line))
          && !/assertCanView|assertViewable/.test(text)) {
        push(p, { rule: 'career-without-assert', line: 0, msg: 'recibe careerCode / ruta S3 del cliente y el controlador no llama a assertCanView (puede delegarlo: confirmar)' });
      }
    }
    for (const { n, line } of added) {
      if (/console\.(log|debug)\(/.test(line) && p.startsWith('apps/backend/') && !/(^|\/)scripts\//.test(p)) push(p, { rule: 'console-log', line: n, msg: 'console.log en backend (usar Logger)' });
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) push(p, { rule: 'empty-catch', line: n, msg: 'catch vacío (AuditEventLogger o Logger)' });
    }
    for (const a of securityAlerts({ file: p, text, added })) push(p, a);
    const before = isNew ? 0 : (git(['show', `${mergeBase}:${p}`], true) ?? '').split('\n').length;
    const moduleDir = p.match(/^apps\/backend\/src\/(?:modules\/)?[^/]+\//)?.[0];
    const hasRepository = !!moduleDir && git(['ls-files', '--', moduleDir]).split('\n').some((f) => f.endsWith('.repository.ts'));
    for (const a of debtAlerts({ file: p, added, size: text.split('\n').length, before, isNew, hasRepository })) push(p, a);
    if (isNew && !isException(p)) {
      const problem = checkNewPath(p, (dir) => git(['ls-tree', '-r', '--name-only', mergeBase, '--', dir]).split('\n').filter(Boolean));
      if (problem) push(p, { line: 1, ...problem });
    }
    for (const a of findRedeclared({ file: p, added, index: buildIndex(getCorpus()) })) push(p, a);
    for (const a of findDeadCode({ file: p, added, isNew, corpus: getCorpus() })) push(p, a);
  }

  // Regla de tres: el bloque nuevo ya existe en 2+ lugares. Dos copias se toleran.
  if (targets.length) {
    for (const c of findClones({ targets, corpus: getCorpus() })) {
      if (c.verdict !== 'extract') continue;
      const where = c.locations.filter((l) => !(l.file === c.file && l.start === c.start)).slice(0, 3).map((l) => `${l.file}:${l.start}`).join(', ');
      push(c.file, { rule: 'duplicate-code', line: c.start, msg: `bloque ${c.kind === 'exact' ? 'idéntico' : 'con nombres cambiados'} (líneas ${c.start}-${c.end}) con ${c.copies} copias: ${where} — extraerlo` });
    }
  }
  return alerts;
}

/** Rutas aceptadas a propósito fuera del estándar, con su motivo en `.claude/pa/naming-exceptions.txt`. */
function isException(p) {
  const f = join(ROOT, '.claude/pa/naming-exceptions.txt');
  return existsSync(f) && readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).includes(p);
}

/** Todo el código de apps/ (trackeado o nuevo) para comparar duplicados y referencias. */
function loadCorpus() {
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps']).split('\n')
    .filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/(^|\/)(node_modules|dist|\.next)\//.test(f) && existsSync(join(ROOT, f)))
    .map((f) => ({ file: norm(f), text: readFileSync(join(ROOT, f), 'utf8') }));
}

/** Rutas añadidas en un controlador, con su método HTTP, su path y cómo están protegidas. */
function routesAdded(text, added) {
  const lines = text.split('\n');
  // Dos mecanismos de protección conviven en el repo: @RequirePermission (PermissionsGuard) y
  // @Roles (RolesGuard, p. ej. SUPERADMIN). Cualquiera de los dos, en la clase o en el método, cuenta.
  const classDecorators = text.match(/((?:@\w+\([^)]*\)\s*)+)export class/s)?.[1] ?? '';
  const classLevel = classDecorators.match(/@RequirePermission\(([^)]*)\)|@Roles\(([^)]*)\)/);
  const noGuards = !/PermissionsGuard|RolesGuard|JwtAuthGuard/.test(text);
  const routes = [];
  for (const { n, line } of added) {
    const m = line.match(/^\s*@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?/);
    if (!m) continue;
    const block = decoratorBlock(lines, n - 1);
    const own = block.match(/@RequirePermission\(([^)]*)\)|@Roles\(([^)]*)\)|(@Public)\(/);
    const permission = own ? (own[1] ?? (own[2] ? `roles ${own[2]}` : '@Public'))
      : classLevel ? (classLevel[1] ?? `roles ${classLevel[2]}`)
      : noGuards ? 'pública (el controlador no usa guards)' : null;
    // El handler es la primera línea que no es decorador ni comentario después de la ruta.
    let k = n;
    while (k < lines.length && /^\s*(@|\/\/|\*|\/\*\*|$)/.test(lines[k])) k++;
    const handler = lines[k]?.match(/^\s*(?:(?:public|async)\s+)*(\w+)\s*\(/)?.[1] ?? null;
    routes.push({ n, method: m[1].toUpperCase(), path: m[2] ?? '', handler, permission, scoped: /assert(CanView|Viewable)\w*\(/.test(methodBody(lines, n - 1)) });
  }
  return routes;
}

/** Contenido de los specs del controlador: x.controller.spec.ts, x.controller.access.spec.ts, … */
function controllerSpecs(p) {
  const dir = dirname(p), stem = basename(p, '.ts');
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '--', dir]).split('\n')
    .filter((f) => basename(f).startsWith(`${stem}.`) && f.endsWith('.spec.ts') && existsSync(join(ROOT, f)))
    .map((f) => readFileSync(join(ROOT, f), 'utf8'));
}

function decoratorBlock(lines, i) {
  let start = i, end = i;
  while (start > 0 && /^\s*(@|\/\/|\*|\/\*\*)/.test(lines[start - 1])) start--;
  while (end < lines.length - 1 && /^\s*(@|\/\/)/.test(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join('\n');
}

/** Desde el decorador de ruta hasta la siguiente ruta (o 40 líneas): el cuerpo del handler. */
function methodBody(lines, i) {
  let end = i + 1;
  while (end < lines.length && end < i + 40 && !/^\s*@(Get|Post|Put|Patch|Delete)\(/.test(lines[end])) end++;
  return lines.slice(i, end).join('\n');
}

function addedLines(mergeBase, p) {
  if (git(['ls-files', '--error-unmatch', p], true) === null) {
    return readFileSync(join(ROOT, p), 'utf8').split('\n').map((line, i) => ({ n: i + 1, line }));
  }
  const out = [];
  let n = 0;
  for (const line of git(['diff', '-U0', mergeBase, '--', p]).split('\n')) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { n = Number(h[1]); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) out.push({ n: n++, line: line.slice(1) });
    else if (!line.startsWith('-')) n++;
  }
  return out;
}

// ── test / exec ─────────────────────────────────────────────────────────────────────────
function cmdTest(paths) {
  let specs = paths.map(norm);
  if (!specs.length) {
    const t = relatedTests([...changedFiles(args.base || 'main').keys()]);
    specs = [...t.backend, ...t.frontend];
  }
  const byPkg = { backend: [], frontend: [] };
  for (const s of specs) {
    const pkg = s.match(/^apps\/(backend|frontend)\//)?.[1]
      ?? (existsSync(join(ROOT, 'apps/backend', s)) ? 'backend' : existsSync(join(ROOT, 'apps/frontend', s)) ? 'frontend' : null);
    if (pkg) byPkg[pkg].push(s.replace(/^apps\/(backend|frontend)\//, ''));
  }
  const out = [];
  let failed = false;
  if (byPkg.backend.length) {
    const r = run(join(ROOT, 'apps/backend'), ['npx', 'jest', ...byPkg.backend, '--silent']);
    failed ||= r.status !== 0;
    out.push(...summarize('jest', r));
  }
  if (byPkg.frontend.length) {
    const r = run(join(ROOT, 'apps/frontend'), ['npx', 'vitest', 'run', ...byPkg.frontend]);
    failed ||= r.status !== 0;
    out.push(...summarize('vitest', r));
  }
  if (args.tsc) {
    for (const pkg of ['backend', 'frontend'].filter((p) => byPkg[p].length)) {
      const r = run(join(ROOT, 'apps', pkg), ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json']);
      failed ||= r.status !== 0;
      out.push(...summarize(`tsc ${pkg}`, r));
    }
  }
  if (!out.length) out.push('no hay specs que correr (pasa rutas, o no hay specs junto al diff)');
  console.log(out.join('\n'));
  process.exit(failed ? 1 : 0);
}

/** Corre un comando cualquiera (lo reescribe el hook) y devuelve su salida filtrada y su exit code. */
function cmdExec() {
  const command = args.b64 ? Buffer.from(args.b64, 'base64').toString('utf8') : args._.join(' ');
  // Solo test/lint/tsc, sin encadenar nada más: `exec` está permitido sin preguntar, así que no
  // puede ser una puerta para correr un comando arbitrario escondido en base64.
  if (!SAFE_EXEC.test(command)) { console.error(`exec solo corre jest/vitest/tsc/eslint/npm test|lint: ${command}`); process.exit(2); }
  const shell = process.platform === 'win32' ? 'bash' : '/bin/sh';
  const r = spawnSync(command, { cwd: process.cwd(), shell, encoding: 'utf8', maxBuffer: 256 << 20, env: quietEnv() });
  const res = { status: r.status ?? 1, text: stripAnsi(`${r.stdout || ''}\n${r.stderr || ''}`) };
  const tool = /\bjest\b|npm (run )?test/.test(command) && !/vitest/.test(command) ? 'jest'
    : /\bvitest\b/.test(command) ? 'vitest' : /\btsc\b/.test(command) ? 'tsc' : /\beslint\b|run lint/.test(command) ? 'eslint' : 'salida';
  console.log([`$ ${command}  (salida filtrada por .claude/pa; corre el comando con | cat para verla entera)`, ...summarize(tool, res)].join('\n'));
  process.exit(res.status);
}

/** Lo que importa de cada herramienta: conteos y, si falló, los bloques de fallo recortados. */
function summarize(tool, r) {
  const lines = r.text.split('\n');
  const ok = r.status === 0;
  if (tool === 'jest') {
    const counts = lines.filter((l) => /^(Tests|Test Suites):/.test(l)).join(' · ');
    return [`jest: ${counts || `exit ${r.status}`}`, ...(ok ? [] : failureBlocks(lines, /^\s*●(?! Console)/))];
  }
  if (tool === 'vitest') {
    const counts = lines.filter((l) => /^\s*(Test Files|Tests)\s/.test(l)).map((l) => l.trim()).join(' · ');
    return [`vitest: ${counts || `exit ${r.status}`}`, ...(ok ? [] : failureBlocks(lines, /^\s*(FAIL|×|AssertionError|Error:)/))];
  }
  if (tool.startsWith('tsc')) {
    const errs = lines.filter((l) => /error TS\d+/.test(l));
    return ok ? [`${tool}: ok`] : [`${tool}: ${errs.length} error(es)`, ...errs.slice(0, 20).map((l) => '  ' + l.trim())];
  }
  if (tool === 'eslint') {
    const problems = lines.filter((l) => /^\s+\d+:\d+\s+(error|warning)/.test(l) || /^[A-Z]:\\|^\//.test(l));
    return ok ? ['eslint: ok'] : [`eslint: ${lines.find((l) => /✖ \d+ problem/.test(l))?.trim() || 'con problemas'}`, ...problems.slice(0, 30).map((l) => '  ' + l.trim())];
  }
  const important = lines.filter((l) => /error|fail|✖|×|warn/i.test(l)).slice(0, 30);
  const tail = lines.filter((l) => l.trim()).slice(-15);
  return [`exit ${r.status}`, ...[...new Set([...important, ...tail])].slice(0, 45).map((l) => '  ' + l.trimEnd())];
}

/** Bloques que empiezan en una línea de fallo, 14 líneas cada uno, hasta MAX_FAIL_LINES. */
function failureBlocks(lines, start) {
  const out = [];
  for (let i = 0; i < lines.length && out.length < MAX_FAIL_LINES; i++) {
    if (!start.test(lines[i])) continue;
    out.push(...lines.slice(i, i + 14).filter((l) => l.trim() && !/^\s+at .*node_modules/.test(l)).map((l) => '  ' + l.trimEnd()));
    i += 13;
  }
  if (out.length >= MAX_FAIL_LINES) out.push('  … (recortado; corre el spec puntual para ver más)');
  return out;
}

// ── fix ─────────────────────────────────────────────────────────────────────────────────
/** Formatea y arregla lo arreglable sin modelo; devuelve solo lo que queda por resolver a mano. */
function cmdFix(paths) {
  const candidates = paths.length ? paths.map(norm) : [...changedFiles(args.base || 'main').keys()];
  const files = candidates.filter((p) => /\.(tsx?)$/.test(p) && existsSync(join(ROOT, p)));
  const out = [];
  let failed = false;
  for (const pkg of ['backend', 'frontend']) {
    const mine = files.filter((p) => p.startsWith(`apps/${pkg}/`)).map((p) => p.slice(`apps/${pkg}/`.length));
    if (!mine.length) continue;
    const cwd = join(ROOT, 'apps', pkg);
    if (existsSync(join(cwd, 'node_modules/.bin/prettier'))) {
      const r = run(cwd, ['npx', 'prettier', '--write', '--log-level', 'warn', ...mine]);
      out.push(`prettier ${pkg}: ${r.status === 0 ? `${mine.length} archivo(s) formateados` : 'falló'}`);
    }
    const r = run(cwd, ['npx', 'eslint', '--fix', ...mine]);
    failed ||= r.status !== 0;
    out.push(...summarize('eslint', r).map((l, i) => (i === 0 ? l.replace('eslint', `eslint ${pkg}`) : l)));
  }
  if (!out.length) out.push('nada que formatear: no hay archivos .ts/.tsx cambiados');
  console.log(out.join('\n'));
  process.exit(failed ? 1 : 0);
}

// ── outline ─────────────────────────────────────────────────────────────────────────────
/** Mapa de un archivo: cada símbolo con su rango. Para leer 80 líneas en vez de 6000. */
function cmdOutline(file) {
  if (!file || !existsSync(join(ROOT, file))) { console.error(`no existe: ${file}`); process.exit(2); }
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  if (file.endsWith('.md')) {
    // Un doc largo se lee por sección, igual que un archivo de código grande.
    const heads = lines.map((l, i) => ({ i, m: l.match(/^(#{1,4})\s+(.+)/) })).filter((h) => h.m);
    console.log([`${file}: ${lines.length} líneas, ${heads.length} secciones — lee con Read offset=<inicio> limit=<fin-inicio+1>`,
      ...heads.map((h, k) => `  ${String(h.i + 1).padStart(5)}-${String((heads[k + 1]?.i ?? lines.length) ).padEnd(5)} ${'  '.repeat(h.m[1].length - 1)}${h.m[2]}`)].join('\n'));
    return;
  }
  const syms = [];
  const KEYWORDS = /^(if|for|while|switch|catch|return|await|new|function|constructor\b)/;
  lines.forEach((line, i) => {
    let m;
    if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) syms.push({ i, kind: 'class', name: m[1] });
    else if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/))) syms.push({ i, kind: 'fn', name: m[1] });
    else if ((m = line.match(/^(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/))) syms.push({ i, kind: 'fn', name: m[1] });
    else if ((m = line.match(/^(?:export\s+)?(?:interface|type|enum)\s+(\w+)/))) syms.push({ i, kind: 'type', name: m[1] });
    else if ((m = line.match(/^ {2}(?:(?:public|private|protected|static|readonly|async|override|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\(/)) && !KEYWORDS.test(m[1])) {
      let route = '';
      for (let k = i - 1; k >= 0 && /^\s*(@|\/\/|\*|\/\*\*)/.test(lines[k]); k--) {
        const r = lines[k].match(/@(Get|Post|Put|Patch|Delete)\(\s*'?([^')]*)/);
        if (r) route = ` [${r[1].toUpperCase()} ${r[2]}]`;
      }
      syms.push({ i, kind: 'method', name: m[1] + route });
    }
  });
  const out = [`${file}: ${lines.length} líneas, ${syms.length} símbolos — lee con Read offset=<inicio> limit=<fin-inicio+1>`];
  syms.forEach((s, k) => {
    const end = (syms[k + 1]?.i ?? lines.length) - 1;
    out.push(`  ${String(s.i + 1).padStart(5)}-${String(end + 1).padEnd(5)} ${s.kind.padEnd(6)} ${s.name}`);
  });
  if (out.length > 201) { out.splice(201); out.push('  … (más de 200 símbolos; usa Grep -n para el que buscas)'); }
  console.log(out.join('\n'));
}

// ── migration ───────────────────────────────────────────────────────────────────────────
/**
 * SQL de migración sin base de datos: compara el schema.prisma de la base (merge-base, o
 * --from <ref>) con el actual. Nunca se usa `prisma migrate dev`: el .env apunta a producción.
 */
function cmdMigration(name) {
  if (!name || !/^[a-z0-9_]+$/.test(name)) { console.error('uso: migration <nombre_en_snake_case> [--from <ref>]'); process.exit(2); }
  const ref = args.from || git(['merge-base', args.base || 'main', 'HEAD']).trim();
  const addedInBranch = [...changedFiles(args.base || 'main').keys()].filter((p) => /^apps\/backend\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(p));
  if (addedInBranch.length && !args.from) {
    console.error(`la rama ya agrega migraciones (${addedInBranch.join(', ')}): compara desde el commit que la generó con --from <ref>, o el SQL se duplicaría`);
    process.exit(2);
  }
  const tmp = join(tmpdir(), `pa-schema-${process.pid}.prisma`);
  writeFileSync(tmp, git(['show', `${ref}:apps/backend/prisma/schema.prisma`]));
  const r = run(join(ROOT, 'apps/backend'), ['npx', 'prisma', 'migrate', 'diff', '--from-schema-datamodel', tmp, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { PRISMA_HIDE_UPDATE_MESSAGE: '1' }, true);
  rmSync(tmp, { force: true });
  if (r.status !== 0) { console.error(`prisma migrate diff falló:\n${r.text.split('\n').slice(-15).join('\n')}`); process.exit(1); }
  const sql = r.stdout.trim();
  if (!sql || /^-- This is an empty migration/.test(sql)) { console.log(`sin cambios de schema desde ${ref.slice(0, 7)}: no se escribió nada`); return; }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = `apps/backend/prisma/migrations/${stamp}_${name}`;
  mkdirSync(join(ROOT, dir), { recursive: true });
  writeFileSync(join(ROOT, dir, 'migration.sql'), sql + '\n');
  const stmts = (sql.match(/^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b[^\n]*/gm) || []);
  const risky = stmts.filter((s) => /^DROP|DROP COLUMN|SET NOT NULL|ALTER COLUMN .* TYPE/i.test(s) || (/ADD COLUMN .* NOT NULL/i.test(s) && !/DEFAULT/i.test(s)));
  console.log([
    `escrita: ${dir}/migration.sql (${stmts.length} sentencia(s), desde ${ref.slice(0, 7)})`,
    ...stmts.slice(0, 20).map((s) => `  ${s.slice(0, 110)}`),
    risky.length ? `REVISAR (destructivo o falla con filas existentes):\n${risky.map((s) => `  ${s.slice(0, 110)}`).join('\n')}` : 'sin sentencias destructivas',
    'se aplica sola en producción al hacer merge a main (deploy.yml corre prisma migrate deploy)',
  ].join('\n'));
}

// ── pr ──────────────────────────────────────────────────────────────────────────────────
/** Los hechos del PR, para que el modelo solo redacte el "qué cambia". */
function cmdPr() {
  const base = args.base || 'main';
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const branch = currentBranch();
  const commits = git(['log', '--no-merges', '--format=%s', `${mergeBase}..HEAD`]).split('\n').filter(Boolean);
  const files = changedFiles(base);
  const uncommitted = git(['status', '--porcelain']).split('\n').filter((l) => l && !IGNORED.test(l.slice(3)));
  const migrations = [...files.keys()].filter((p) => /^apps\/backend\/prisma\/migrations\/.+\.sql$/.test(p));
  const routes = [];
  for (const p of [...files.keys()].filter((f) => f.endsWith('.controller.ts') && existsSync(join(ROOT, f)))) {
    for (const r of routesAdded(readFileSync(join(ROOT, p), 'utf8'), addedLines(mergeBase, p))) {
      routes.push(`  ${r.method} ${r.path || '/'} (${p.split('/').pop()}:${r.n}) — ${r.permission ? `permiso ${r.permission}` : r.scoped ? 'solo assertViewable/assertCanView' : 'SIN permiso'}`);
    }
  }
  const upstream = git(['rev-parse', '--abbrev-ref', '@{u}'], true)?.trim();
  const plan = planForBranch(false);
  const objective = plan ? (readFileSync(join(ROOT, plan), 'utf8').match(/^## Objective\s*\n+([^\n#]+)/m)?.[1]?.trim()) : null;
  console.log([
    `rama: ${branch}   upstream: ${upstream || 'ninguno (hace falta git push -u origin ' + branch + ')'}`,
    uncommitted.length ? `PARADA: ${uncommitted.length} cambio(s) sin commitear` : 'árbol limpio',
    plan ? planSummary(plan) : 'plan: ninguno en .claude/pa/work/',
    objective ? `objective: ${objective}` : '',
    `commits (${commits.length}):`, ...commits.map((c) => `  ${c}`),
    `paquetes: ${packagesOf([...files.keys()]).join(', ') || 'ninguno'}   archivos: ${files.size}`,
    migrations.length ? `MIGRACIONES (se aplican al hacer merge):\n${migrations.map((m) => '  ' + m).join('\n')}` : 'migraciones: ninguna',
    routes.length ? `endpoints nuevos o tocados:\n${routes.join('\n')}` : 'endpoints nuevos: ninguno',
    `compare: https://github.com/UPC-ABET/PORTFOLIO-AUDIT/compare/${base}...${branch}?expand=1`,
  ].filter(Boolean).join('\n'));
}

// ── gate / tasks (planes en .claude/pa/work) ───────────────────────────────────────────
function cmdGate(file) {
  file = file || planForBranch(true);
  const text = readFileSync(join(ROOT, file), 'utf8');
  const tasks = (text.match(/^\s*- \[[ x]\]/gim) || []).length;
  const mentioned = [...new Set([...text.matchAll(/`((?:apps|\.github|docker)\/[^`\s:]+)`/g)].map((m) => m[1]))];
  const source = mentioned.filter(isSource);
  const packages = packagesOf(mentioned);
  const refuse = [];
  if (tasks > QUICK.tasks) refuse.push(`${tasks} tareas > ${QUICK.tasks}`);
  if (source.length > QUICK.files) refuse.push(`${source.length} archivos de código > ${QUICK.files}`);
  if (packages.length > 1) refuse.push('toca backend y frontend');
  for (const s of sensitiveHits(mentioned)) refuse.push(`ruta sensible: ${s}`);
  if (/prisma migrate|migration\.sql|schema\.prisma/i.test(text)) refuse.push('incluye migración');
  if (/new module|módulo nuevo|nuevo módulo/i.test(text)) refuse.push('crea un módulo nuevo');
  if (/^##\s*(Open questions|Preguntas abiertas)\s*\n+\s*-\s+(?!\(?ning|none)/im.test(text)) refuse.push('preguntas de producto abiertas');
  if (!/^##\s*Scope check/im.test(text)) refuse.push('falta "## Scope check"');
  if (/^##\s*Unplanned\b/im.test(text)) refuse.push('apareció trabajo no planificado (## Unplanned)');
  const large = source.filter((p) => existsSync(join(ROOT, p)) && lineCount(p) > LARGE_FILE).map((p) => `${p} (${lineCount(p)})`);
  console.log([
    `plan: ${file}   tareas: ${tasks}   archivos de código citados: ${source.length}   paquetes: ${packages.join(', ') || '?'}`,
    refuse.length ? `carril: COMPLETO — ${refuse.join('; ')}` : 'carril: RÁPIDO — cabe en /pa-quick',
    large.length ? `archivos grandes (outline + lectura por rango): ${large.join(', ')}` : '',
  ].filter(Boolean).join('\n'));
  process.exit(refuse.length ? 1 : 0);
}

/** El plan sin lo cerrado: encabezado, alcance, restricciones y las tareas abiertas. */
function cmdTasks(file) {
  file = file || planForBranch(true);
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const out = [], skipped = [];
  let section = null, inTasks = false, block = null, heading = null, open = 0, done = 0;
  const flush = () => {
    if (block?.open) { if (heading) { out.push(heading); heading = null; } out.push(...block.lines); }
    block = null;
  };
  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      flush();
      section = h2[1].trim();
      inTasks = /^tasks\b/i.test(section);
      if (inTasks || KEEP_SECTIONS.test(section)) out.push('', line); else skipped.push(section);
      continue;
    }
    if (section === null) { if (line.trim()) out.push(line); continue; }
    if (inTasks) {
      if (/^###\s/.test(line)) { flush(); heading = line; continue; }
      const t = line.match(/^- \[( |x)\]/i);
      if (t) { flush(); t[1] === ' ' ? open++ : done++; block = { open: t[1] === ' ', lines: [line] }; continue; }
      if (block) block.lines.push(line);
      continue;
    }
    if (KEEP_SECTIONS.test(section) && line.trim()) out.push(line);
  }
  flush();
  console.log([
    `${file}: ${done} tareas cerradas (omitidas), ${open} abiertas`,
    skipped.length ? `secciones omitidas (Grep si hacen falta): ${skipped.join(' · ')}` : '',
    ...out,
  ].filter((l, i) => i > 1 || l).join('\n'));
}

/** `feat/<slug>` → `.claude/pa/work/<slug>.md`. */
function planForBranch(required) {
  const branch = currentBranch();
  const file = `${WORK}/${branch.replace(/^[^/]+\//, '')}.md`;
  if (existsSync(join(ROOT, file))) return file;
  if (!required) return null;
  console.error(`no hay plan para la rama "${branch}" (${file}); pásalo como argumento o créalo con /pa-define-task`);
  process.exit(2);
}

function planSummary(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  return `plan (${file}): ${(text.match(/^\s*- \[x\]/gim) || []).length} hechas, ${(text.match(/^\s*- \[ \]/gm) || []).length} abiertas`;
}

// ── debt ────────────────────────────────────────────────────────────────────────────────
/**
 * La deuda estructural del repo en una foto: archivos gigantes, nombres genéricos, Prisma fuera de
 * repositorios, páginas con lógica, capas invertidas. Y los puntos calientes: archivos grandes que
 * además cambian seguido (tamaño × cambios) — ahí cada tarea paga más, en tiempo y en tokens, y ahí
 * conviene pagar primero. `--save` guarda la línea base; sin flag compara contra ella.
 */
const DEBT_BASELINE = '.claude/pa/debt-baseline.json';

function cmdDebt() {
  const m = measure(loadCorpus());
  const days = Number(args.days || 180);
  const churn = new Map();
  for (const f of git(['log', `--since=${days}.days`, '--format=', '--name-only', '--', 'apps']).split('\n').filter(Boolean)) {
    churn.set(norm(f), (churn.get(norm(f)) || 0) + 1);
  }
  const fixes = new Map();
  for (const block of git(['log', `--since=${days}.days`, '--format=%x00%s', '--name-only', '--', 'apps']).split('\0').filter(Boolean)) {
    const [subject, ...names] = block.split('\n');
    if (!/^fix/.test(subject)) continue;
    for (const f of names.filter(Boolean)) fixes.set(norm(f), (fixes.get(norm(f)) || 0) + 1);
  }
  const hot = m.large.map((x) => ({ ...x, changes: churn.get(x.file) || 0, fixes: fixes.get(x.file) || 0 }))
    .map((x) => ({ ...x, score: x.lines * x.changes })).sort((a, b) => b.score - a.score);

  const snapshot = {
    date: new Date().toISOString().slice(0, 10), commit: git(['rev-parse', '--short', 'HEAD']).trim(),
    files: m.files, lines: m.lines, large: m.large.length, inLarge: m.inLarge, medium: m.medium,
    generic: m.generic.length, dbOutside: m.dbOutside.length, repositories: m.repositories,
    fatPages: m.fatPages.length, layer: m.layer.length,
  };
  const base = existsSync(join(ROOT, DEBT_BASELINE)) ? JSON.parse(readFileSync(join(ROOT, DEBT_BASELINE), 'utf8')) : null;
  const delta = (k) => (base && !args.save ? ` (${snapshot[k] - base[k] >= 0 ? '+' : ''}${snapshot[k] - base[k]} vs ${base.date})` : '');
  const pct = (a, b) => `${Math.round((100 * a) / Math.max(b, 1))}%`;

  const out = [
    `deuda estructural @ ${snapshot.commit}: ${m.files} archivos, ${m.lines} líneas de código (sin tests)`,
    `  archivos > ${LARGE} líneas: ${m.large.length}${delta('large')} — concentran ${m.inLarge} líneas (${pct(m.inLarge, m.lines)} del código)${delta('inLarge')}`,
    `  archivos de 600-${LARGE} líneas: ${m.medium}${delta('medium')}`,
    `  nombres genéricos (utils/helpers): ${m.generic.length}${delta('generic')}`,
    `  servicios y otros con Prisma fuera de repositorio: ${m.dbOutside.length}${delta('dbOutside')} · repositorios: ${m.repositories}${delta('repositories')}`,
    `  page.tsx con lógica (> 300 líneas): ${m.fatPages.length}${delta('fatPages')}`,
    `  imports que invierten capas (domain → infrastructure…): ${m.layer.length}${delta('layer')}`,
    `puntos calientes (tamaño × cambios en ${days} días) — pagar primero:`,
    ...hot.slice(0, Number(args.top || 10)).map((x, i) => `  ${String(i + 1).padStart(2)}. ${x.file}  ${x.lines} líneas · ${x.changes} cambios · ${x.fixes} fixes`),
  ];
  if (args.save) {
    mkdirSync(dirname(join(ROOT, args.out || DEBT_BASELINE)), { recursive: true });
    writeFileSync(join(ROOT, args.out || DEBT_BASELINE), JSON.stringify(snapshot, null, 2) + '\n');
    out.push(`línea base guardada en ${args.out || DEBT_BASELINE}: las próximas corridas muestran la diferencia`);
  } else if (!base) out.push(`sin línea base: node .claude/pa/pa.mjs debt --save`);
  // Trinquete: la deuda puede bajar, nunca subir. Para CI o antes del PR.
  const WORSE_IF_HIGHER = ['large', 'inLarge', 'generic', 'dbOutside', 'fatPages', 'layer'];
  const worse = base && args.check ? WORSE_IF_HIGHER.filter((k) => snapshot[k] > base[k]) : [];
  if (args.check) out.push(worse.length ? `CHECK: empeora ${worse.map((k) => `${k} ${base[k]} → ${snapshot[k]}`).join(', ')}` : 'CHECK: la deuda no creció');
  console.log(out.join('\n'));
  if (worse.length) process.exit(1);
}

// ── module ──────────────────────────────────────────────────────────────────────────────
/**
 * Qué doc corto leer antes de explorar código: el módulo de cada ruta (o del diff), sus docs con
 * tamaño, y si están desactualizados (commits en el código del módulo desde la última edición
 * del doc). Leer un doc de 1-2 páginas reemplaza abrir 10-20 archivos para orientarse.
 */
function cmdModule(targets) {
  const { modules } = JSON.parse(readFileSync(join(ROOT, '.claude/pa/modules.json'), 'utf8'));
  let paths = targets.map(norm);
  if (!paths.length) paths = [...changedFiles(args.base || 'main').keys()];
  const hits = new Map();
  for (const p of paths) {
    const byName = modules[p] ? [[p, modules[p], '']] : [];
    const byPath = Object.entries(modules)
      .flatMap(([name, m]) => m.paths.filter((pre) => p.startsWith(pre) || p.includes(pre.replace(/\/$/, ''))).map((pre) => [name, m, pre]))
      .sort((a, b) => b[2].length - a[2].length).slice(0, 1);
    for (const [name, m] of [...byName, ...byPath]) hits.set(name, m);
  }
  if (!hits.size) { console.log(`sin módulo registrado para: ${paths.slice(0, 5).join(', ')} — agrega uno en .claude/pa/modules.json`); return; }
  const out = [];
  for (const [name, m] of hits) {
    out.push(`${name}:`);
    if (!m.docs.length) out.push(`  sin doc → /pa-module-doc ${name} (orientarse explorando cuesta más que escribirlo una vez)`);
    for (const d of m.docs) {
      if (!existsSync(join(ROOT, d))) { out.push(`  ${d} — NO EXISTE`); continue; }
      const words = readFileSync(join(ROOT, d), 'utf8').split(/\s+/).length;
      const last = git(['log', '-1', '--format=%H', '--', d]).trim();
      const behind = last ? Number(git(['rev-list', '--count', `${last}..HEAD`, '--', ...m.paths.map((x) => x.replace(/\/$/, ''))]).trim()) : 0;
      out.push(`  ${d} — ${words} palabras${words > 1500 ? ' (largo: outline y lee solo la sección)' : ''}${behind > 15 ? ` · ${behind} commits en el módulo desde su última edición: puede estar desactualizado` : ''}`);
    }
  }
  console.log(out.join('\n'));
}

// ── ledger ──────────────────────────────────────────────────────────────────────────────
/**
 * Registro de auditorías: cada `/pa-audit` anota qué alertas mecánicas confirmó o descartó (y
 * por qué) y qué encontró por criterio que ningún script vio. Un archivo por rama en
 * `.claude/pa/ledger/` (local, como todo .claude/). `report` dice qué hacer con eso:
 * reglas que se equivocan demasiado (afinar) y hallazgos de criterio que se repiten en ramas
 * distintas y una máquina podría detectar (promover a regla). Es el mismo ciclo que llevó a
 * abet-plugins de "un auditor encuentra este IDOR leyendo" a la regla scope-param-unused.
 */
const LEDGER = '.claude/pa/ledger';
const LEDGER_FIELDS = {
  mechanical: ['rule', 'file', 'verdict', 'reason'],
  judgment: ['severity', 'file', 'shape', 'detect', 'convertible'],
};

function cmdLedger(sub, file) {
  if (sub === 'add') return ledgerAdd(file);
  if (sub === 'report') return ledgerReport();
  if (sub === 'import') return ledgerImport(file);
  console.error('uso: pa.mjs ledger add <entradas.json> | ledger import [CLAUDE-SECURITY-<fecha>] | ledger report');
  process.exit(2);
}

function ledgerAdd(file) {
  if (!file || !existsSync(join(ROOT, file))) { console.error(`no existe: ${file}`); process.exit(2); }
  const entries = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  const list = Array.isArray(entries) ? entries : [entries];
  const errors = [];
  list.forEach((e, i) => {
    const need = LEDGER_FIELDS[e.kind];
    if (!need) return errors.push(`#${i}: kind debe ser mechanical o judgment`);
    const missing = need.filter((f) => !e[f]);
    if (missing.length) errors.push(`#${i} (${e.kind}): falta ${missing.join(', ')}`);
    if (e.kind === 'mechanical' && !['confirmed', 'dismissed'].includes(e.verdict)) errors.push(`#${i}: verdict debe ser confirmed o dismissed`);
    if (e.kind === 'judgment' && !['yes', 'maybe', 'no'].includes(e.convertible)) errors.push(`#${i}: convertible debe ser yes, maybe o no`);
    if (e.scope && !['task', 'out-of-scope'].includes(e.scope)) errors.push(`#${i}: scope debe ser task u out-of-scope`);
  });
  if (errors.length) { console.error(`nada escrito:\n  ${errors.join('\n  ')}`); process.exit(1); }

  const branch = currentBranch() || 'detached';
  const path = join(ROOT, LEDGER, `${branch.replace(/[^\w.-]+/g, '_')}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const key = (e) => [e.kind, e.rule || e.shape, e.file, e.line ?? ''].join('|');
  const prior = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  // Re-auditar la misma rama reemplaza, no suma: una alerta cuenta una vez por rama.
  const byKey = new Map(prior.map((e) => [key(e), e]));
  const date = new Date().toISOString().slice(0, 10);
  for (const e of list) byKey.set(key(e), { date, branch, scope: 'task', ...e });
  writeFileSync(path, [...byKey.values()].map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`ledger: ${list.length} entrada(s) en ${LEDGER}/${branch.replace(/[^\w.-]+/g, '_')}.jsonl (${byKey.size} en total para la rama)`);
}

/**
 * Los hallazgos de un escaneo de claude-security, al ledger como hallazgos de criterio con origen
 * propio: lo que el escaneo profundo encuentra una y otra vez y ninguna regla de pa.mjs ve es el
 * mejor candidato a regla nueva (barata, sin agentes). Sin argumento, el informe vigente de HEAD.
 */
function ledgerImport(dir) {
  const target = dir || securityReportForHead()?.dir;
  if (!target) { console.error('no hay informe de claude-security para HEAD: pásalo como argumento'); process.exit(2); }
  const jsonl = join(ROOT, target, 'CLAUDE-SECURITY-RESULTS.jsonl');
  if (!existsSync(jsonl)) { console.error(`no existe ${target}/CLAUDE-SECURITY-RESULTS.jsonl`); process.exit(2); }
  const findings = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ours = mechanicalAlerts(git(['merge-base', args.base || 'main', 'HEAD']).trim(), [...changedFiles(args.base || 'main').keys()]);
  const entries = findings.map((f) => {
    const seen = ours.some((a) => a.file === f.file && Math.abs((a.line || 0) - (f.line || 0)) <= 5);
    return {
      kind: 'judgment', source: 'claude-security', id: f.claudeSecurityPluginFindingId,
      severity: String(f.severity).toLowerCase(), file: f.file, line: f.line,
      scope: f.via_change === null ? 'out-of-scope' : 'task',
      shape: `${f.category || f.cwe_id}: ${f.title}`.slice(0, 160),
      detect: seen ? 'ya lo marca una regla de pa.mjs' : 'pendiente: ¿lo podría ver una regla?',
      convertible: seen ? 'no' : 'maybe',
    };
  });
  const tmp = join(ROOT, WORK, 'claude-security-import.json');
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, JSON.stringify(entries));
  ledgerAdd(`${WORK}/claude-security-import.json`);
  const missed = entries.filter((e) => e.convertible === 'maybe').length;
  console.log(`${findings.length} hallazgo(s) de ${target}: ${findings.length - missed} ya los marcaba pa.mjs, ${missed} no (candidatos a regla en ledger report)`);
}

function ledgerReport() {
  const dir = join(ROOT, LEDGER);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  if (!all.length) { console.log('ledger vacío: se llena con cada /pa-audit'); return; }
  const out = [`ledger: ${all.length} entradas de ${files.length} rama(s)`];

  const rules = new Map();
  for (const e of all.filter((x) => x.kind === 'mechanical')) {
    const r = rules.get(e.rule) ?? rules.set(e.rule, { ok: 0, no: 0, reasons: new Map() }).get(e.rule);
    if (e.verdict === 'confirmed') r.ok++;
    else { r.no++; r.reasons.set(e.reason, (r.reasons.get(e.reason) || 0) + 1); }
  }
  out.push('precisión de las reglas (confirmadas / revisadas):');
  for (const [rule, r] of [...rules].sort((a, b) => (a[1].ok / (a[1].ok + a[1].no)) - (b[1].ok / (b[1].ok + b[1].no)))) {
    const total = r.ok + r.no, p = Math.round((100 * r.ok) / total);
    const top = [...r.reasons].sort((a, b) => b[1] - a[1])[0];
    out.push(`  ${rule.padEnd(26)} ${String(p).padStart(3)}% (${r.ok}/${total})${total >= 4 && p < 50 ? `  → AFINAR: el motivo más común de descarte es "${top?.[0]}"` : ''}`);
  }

  const shapes = new Map();
  for (const e of all.filter((x) => x.kind === 'judgment')) {
    const k = e.shape.toLowerCase().replace(/\s+/g, ' ').trim();
    const s = shapes.get(k) ?? shapes.set(k, { branches: new Set(), detect: e.detect, convertible: new Set(), n: 0 }).get(k);
    s.branches.add(e.branch); s.convertible.add(e.convertible); s.n++;
  }
  const promote = [...shapes].filter(([, s]) => s.branches.size >= 2 && !s.convertible.has('no'));
  out.push(promote.length ? 'promover a regla mecánica (se repite en ramas distintas):' : 'hallazgos de criterio: ninguno se repite todavía en dos ramas');
  for (const [shape, s] of promote) out.push(`  "${shape}" — ${s.n} vez(es) en ${s.branches.size} ramas · detectar: ${s.detect}`);

  const outOfScope = all.filter((e) => e.scope === 'out-of-scope');
  if (outOfScope.length) out.push(`fuera de alcance reportados como bloqueantes: ${outOfScope.length}`);
  console.log(out.join('\n'));
}

// ── backtest ────────────────────────────────────────────────────────────────────────────
/**
 * Reproduce `diff` sobre PRs ya mergeados: para cada merge M, la rama del PR (M^2) contra lo que
 * había antes (M^1), en un worktree temporal. Mide lo que cada regla habría marcado en su momento
 * y cuánto tarda, y deja un TSV para etiquetar una muestra (real / intencional / falso). Así se
 * calibra una regla o un umbral con evidencia antes de confiar en él.
 */
function cmdBacktest() {
  if (args.labels) return backtestLabels(args.labels);
  const ref = args.ref || 'origin/main';
  const last = Number(args.last || 30);
  const merges = git(['log', '--merges', '--first-parent', ref, '--format=%H%x09%s', `-n${last * 2}`]).split('\n')
    .filter((l) => /Merge pull request #\d+/.test(l)).slice(0, last)
    .map((l) => ({ sha: l.split('\t')[0], pr: l.match(/#\d+/)[0] }));
  const wt = join(tmpdir(), `pa-backtest-${process.pid}`);
  git(['worktree', 'add', '-q', '--detach', wt, ref]);
  const script = fileURLToPath(import.meta.url);
  const results = [];
  try {
    for (const { sha, pr } of merges) {
      execFileSync('git', ['-C', wt, 'checkout', '-q', '--detach', `${sha}^2`], { stdio: 'ignore' });
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [script, 'diff', '--base', `${sha}^1`, '--json'], { cwd: wt, encoding: 'utf8', maxBuffer: 64 << 20 });
      const ms = Date.now() - t0;
      try { results.push({ pr, ms, ...JSON.parse(r.stdout) }); } catch { results.push({ pr, ms, error: (r.stderr || '').split('\n')[0] }); }
      process.stderr.write('.');
    }
  } finally {
    git(['worktree', 'remove', '--force', wt], true);
    process.stderr.write('\n');
  }

  const ok = results.filter((r) => !r.error);
  const pct = (n) => `${Math.round((100 * n) / Math.max(ok.length, 1))}%`;
  const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
  const reasonKinds = new Map();
  for (const r of ok) for (const why of new Set(r.reasons.map((x) => x.replace(/^\d+ /, '').replace(/ > \d+$/, '').replace(/^ruta sensible: /, 'sensible: ')))) reasonKinds.set(why, (reasonKinds.get(why) || 0) + 1);

  const byRule = new Map();
  for (const r of ok) for (const a of r.alerts) {
    const e = byRule.get(a.rule) ?? byRule.set(a.rule, { n: 0, prs: new Set(), sample: [] }).get(a.rule);
    e.n++; e.prs.add(r.pr); if (e.sample.length < 2) e.sample.push(`${r.pr} ${a.file.split('/').pop()}:${a.line} ${a.msg.slice(0, 70)}`);
  }
  const lines = ok.map((r) => r.lines), files = ok.map((r) => r.files);
  const deepWith = (L, F, both = true) => ok.filter((r) => r.lines > L || r.files > F || (both && r.packages.length > 1 && r.lines > BOTH_LINES) || r.sensitive.length).length;

  const out = [
    `backtest: ${ok.length} PRs de ${ref}${results.length > ok.length ? ` (${results.length - ok.length} con error)` : ''} · ${(ok.reduce((s, r) => s + r.ms, 0) / 1000 / Math.max(ok.length, 1)).toFixed(1)} s/PR (máx ${(Math.max(...ok.map((r) => r.ms)) / 1000).toFixed(1)} s)`,
    `profundidad: deep ${ok.filter((r) => r.depth === 'deep').length} (${pct(ok.filter((r) => r.depth === 'deep').length)}) · lite ${ok.filter((r) => r.depth === 'lite').length}`,
    `  motivos: ${[...reasonKinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`,
    `  tamaño: líneas p50 ${quantile(lines, 0.5)} · p75 ${quantile(lines, 0.75)} · p90 ${quantile(lines, 0.9)} | archivos p50 ${quantile(files, 0.5)} · p75 ${quantile(files, 0.75)} · p90 ${quantile(files, 0.9)}`,
    `  deep si los límites fueran: ${[[LIMITS.lines, LIMITS.files], [quantile(lines, 0.75), quantile(files, 0.75)], [quantile(lines, 0.9), quantile(files, 0.9)]]
      .map(([L, F]) => `${L} líneas/${F} archivos → ${pct(deepWith(L, F))}`).join(' · ')}`,
    `  …y sin "toca backend y frontend" como motivo: ${[[LIMITS.lines, LIMITS.files], [quantile(lines, 0.75), quantile(files, 0.75)], [quantile(lines, 0.9), quantile(files, 0.9)]]
      .map(([L, F]) => `${L}/${F} → ${pct(deepWith(L, F, false))}`).join(' · ')}`,
    `alertas: ${ok.reduce((s, r) => s + r.alerts.length, 0)} (${(ok.reduce((s, r) => s + r.alerts.length, 0) / Math.max(ok.length, 1)).toFixed(1)} por PR)`,
    ...[...byRule].sort((a, b) => b[1].n - a[1].n).map(([rule, e]) => `  ${rule.padEnd(26)} ${String(e.n).padStart(4)} en ${String(e.prs.size).padStart(3)} PRs   p.ej. ${e.sample[0]}`),
  ];
  mkdirSync(join(ROOT, WORK), { recursive: true });
  const tsv = `${WORK}/backtest-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.tsv`;
  writeFileSync(join(ROOT, tsv), ['pr\trule\tfile\tline\tmsg\tlabel(real|intencional|falso)',
    ...ok.flatMap((r) => r.alerts.map((a) => [r.pr, a.rule, a.file, a.line, a.msg, ''].join('\t')))].join('\n') + '\n');
  writeFileSync(join(ROOT, tsv.replace(/\.tsv$/, '.json')), JSON.stringify(ok));
  out.push(`detalle para etiquetar: ${tsv} (datos crudos en .json, para simular umbrales sin volver a correr)`);
  console.log(out.join('\n'));
}

/** Precisión por regla a partir de un TSV del backtest con la columna `label` llena. */
function backtestLabels(file) {
  const rows = readFileSync(join(ROOT, file), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
  const by = new Map();
  for (const [, rule, , , , label] of rows) {
    const l = (label || '').trim().toLowerCase();
    const r = by.get(rule) ?? by.set(rule, { real: 0, intencional: 0, falso: 0, sin: 0 }).get(rule);
    if (l in r) r[l]++; else r.sin++;
  }
  console.log(['regla                       real  intenc.  falso  sin etiqueta  precisión', ...[...by].map(([rule, r]) => {
    const labeled = r.real + r.intencional + r.falso;
    return `${rule.padEnd(26)} ${String(r.real).padStart(5)} ${String(r.intencional).padStart(8)} ${String(r.falso).padStart(6)} ${String(r.sin).padStart(13)}  ${labeled ? `${Math.round((100 * (r.real + r.intencional)) / labeled)}%` : '—'}`;
  })].join('\n'));
}

// ── utilidades ──────────────────────────────────────────────────────────────────────────
function run(cwd, argv, env = {}, keepStdout = false) {
  const quoted = argv.map((a) => (/[\s()&]/.test(a) ? `"${a}"` : a));
  const r = spawnSync(quoted.join(' '), { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 << 20, env: { ...quietEnv(), ...env } });
  const res = { status: r.status ?? 1, text: stripAnsi(`${r.stdout || ''}\n${r.stderr || ''}`) };
  if (keepStdout) res.stdout = stripAnsi(r.stdout || '');
  return res;
}

const quietEnv = () => ({ ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' });
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const currentBranch = () => git(['branch', '--show-current']).trim();
const packagesOf = (paths) => [...new Set(paths.map((p) => p.match(/^apps\/(backend|frontend)\//)?.[1]).filter(Boolean))];

function sensitiveHits(paths) {
  const hits = new Set();
  for (const p of paths) for (const [re, label] of SENSITIVE) if (re.test(p)) hits.add(label);
  return [...hits];
}

function git(argv, soft = false) {
  try {
    return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    if (soft) return null;
    console.error(`git ${argv.join(' ')} falló`);
    process.exit(2);
  }
}

function lineCount(p) {
  try { return readFileSync(join(ROOT, p), 'utf8').split('\n').length; } catch { return 0; }
}

function parseArgs(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const key = list[i].startsWith('--') ? list[i].slice(2) : null;
    if (key && BOOLEAN_FLAGS.has(key)) out[key] = true;
    else if (key) out[key] = list[i + 1] === undefined || list[i + 1].startsWith('--') ? true : list[++i];
    else out._.push(list[i]);
  }
  return out;
}

function norm(p) { return p.replace(/\\/g, '/'); }
function num(s) { return s === '-' ? 0 : Number(s); }

// ── entrada (al final: las constantes de arriba ya están inicializadas) ─────────────────
const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const COMMANDS = {
  diff: cmdDiff, test: () => cmdTest(args._), fix: () => cmdFix(args._), outline: () => cmdOutline(norm(args._[0] || '')),
  migration: () => cmdMigration(args._[0]), pr: cmdPr, gate: () => cmdGate(args._[0]),
  tasks: () => cmdTasks(args._[0]), exec: cmdExec, backtest: cmdBacktest,
  module: () => cmdModule(args._), debt: cmdDebt, ledger: () => cmdLedger(args._[0], args._[1]),
};
if (COMMANDS[mode]) COMMANDS[mode]();
else { console.error(`uso: pa.mjs ${Object.keys(COMMANDS).join('|')} (ver la cabecera del archivo)`); process.exit(2); }
