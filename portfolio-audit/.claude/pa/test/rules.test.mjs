/**
 * Recall de las reglas mecánicas: cada regla debe encontrar el patrón malo sembrado y callar ante
 * la versión correcta. El backtest mide la precisión sobre PRs reales; esto asegura que una regla
 * no se rompa en silencio al ajustarla.
 *
 *   node --test .claude/pa/test/rules.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityAlerts, findUnusedScopeParams } from '../lib/security.mjs';
import { findClones } from '../lib/clones.mjs';
import { buildIndex, findRedeclared, findDeadCode } from '../lib/reuse.mjs';
import { debtAlerts } from '../lib/debt.mjs';
import { checkNewPath } from '../lib/naming.mjs';

// ── estándar de estructura (archivos nuevos) ────────────────────────────────────────────
const TREE = [
  'apps/backend/src/modules/blackboard/domain/grade-bands.ts',
  'apps/backend/src/modules/blackboard/infrastructure/rest/blackboard-api.client.ts',
  'apps/backend/src/modules/auditorias/utils/no-aplica.util.ts',
  'apps/backend/src/academic/campuses.service.ts',
];
const ls = (dir) => TREE.filter((f) => f.startsWith(dir));
const naming = (f) => checkNewPath(f, ls)?.msg ?? null;

test('estructura: módulo con capas — cada tipo en su capa', () => {
  assert.equal(naming('apps/backend/src/modules/blackboard/domain/grade-bands.calc.ts'), null);
  assert.equal(naming('apps/backend/src/modules/blackboard/infrastructure/rest/roster.client.ts'), null, 'subcarpetas dentro de la capa');
  assert.equal(naming('apps/backend/src/modules/blackboard/domain/course.repository.ts'), null, 'puerto en domain');
  assert.equal(naming('apps/backend/src/modules/blackboard/infrastructure/prisma-course.repository.ts'), null, 'implementación en infrastructure');
  assert.match(naming('apps/backend/src/modules/blackboard/domain/roster.client.ts'), /infrastructure/);
  assert.match(naming('apps/backend/src/modules/blackboard/application/export.controller.ts'), /presentation/);
});

test('estructura: nombres genéricos o sin tipo, en cualquier módulo', () => {
  assert.match(naming('apps/backend/src/modules/auditorias/utils/texto-similar.util.ts'), /no dice para qué/);
  assert.match(naming('apps/backend/src/modules/blackboard/domain/bands.helpers.ts'), /no dice para qué/);
  assert.match(naming('apps/backend/src/modules/blackboard/domain/exam-detection.ts'), /sin tipo/);
  assert.match(naming('apps/backend/src/academic/campus.weird.ts'), /fuera del vocabulario/);
});

test('estructura: lo heredado plano exige tipo, no capa; un módulo nuevo nace con capas', () => {
  assert.equal(naming('apps/backend/src/modules/auditorias/phase2/encabezado.rule.ts'), null, 'auditorias aún sin capas');
  assert.equal(naming('apps/backend/src/academic/campus-sync.service.ts'), null);
  assert.equal(naming('apps/backend/src/modules/reportes/application/reporte.service.ts'), null, 'módulo nuevo con capas');
  assert.match(naming('apps/backend/src/modules/reportes/reporte.service.ts'), /application/);
  assert.match(naming('apps/backend/src/reportes/reporte.service.ts'), /src\/modules/);
  assert.equal(naming('apps/backend/src/modules/blackboard/domain/grade-bands.calc.spec.ts'), null, 'tests exentos');
});

test('estructura: frontend', () => {
  assert.match(naming('apps/frontend/src/lib/dateUtils.ts'), /Utils\/Helpers/);
  assert.match(naming('apps/frontend/src/components/NuevoPanel.tsx'), /components\/<área>/);
  assert.equal(naming('apps/frontend/src/components/audit/NuevoPanel.tsx'), null);
  assert.match(naming('apps/frontend/src/app/(app)/audit/new/OtroWizard.tsx'), /cascarón/);
  assert.equal(naming('apps/frontend/src/app/(app)/reportes/page.tsx'), null);
});

// ── deuda: no agregar más ───────────────────────────────────────────────────────────────
const debt = (o) => debtAlerts({ added: [], before: 0, isNew: false, size: 10, ...o }).map((a) => a.rule);

test('deuda: nombre genérico solo en archivos nuevos', () => {
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.util.ts', isNew: true }), ['generic-file-name']);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.util.ts', isNew: false }), [], 'heredado: no bloquea');
  assert.deepEqual(debt({ file: 'apps/frontend/src/lib/dateHelpers.ts', isNew: true }), ['generic-file-name']);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.calc.ts', isNew: true }), []);
});

test('deuda: un archivo gigante no puede crecer; achicarlo sí', () => {
  const f = 'apps/backend/src/modules/auditorias/phase2/phase2.service.ts';
  assert.deepEqual(debt({ file: f, size: 7930, before: 7874 }), ['large-file-growth']);
  assert.deepEqual(debt({ file: f, size: 7890, before: 7874 }), [], 'un arreglo de 16 líneas se tolera');
  assert.deepEqual(debt({ file: f, size: 7500, before: 7874 }), [], 'extraer reduce: bien');
  assert.deepEqual(debt({ file: 'apps/backend/src/x/nuevo.service.ts', size: 700, isNew: true }), ['large-new-file']);
});

test('deuda: Prisma fuera de un repositorio, y en el repositorio no', () => {
  const added = lines('const rows = await this.prisma.auditSession.findMany({ where });');
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.service.ts', added, hasRepository: true }), ['db-access-outside-repository']);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.service.ts', added, isNew: true }), ['db-access-outside-repository']);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.service.ts', added }), [], 'servicio heredado en módulo sin repositorio');
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/infrastructure/x.repository.ts', added }), []);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/x/x.service.ts', added: lines('await this.prisma.withRetry(() => this.repo.find(id));') }), []);
});

test('deuda: capas invertidas y páginas con lógica', () => {
  const imp = lines("import { BlackboardApiClient } from '../infrastructure/rest/blackboard-api.client';");
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/blackboard/domain/grade-bands.ts', added: imp }), ['layer-violation']);
  assert.deepEqual(debt({ file: 'apps/backend/src/modules/blackboard/application/x.service.ts', added: imp }), []);
  assert.deepEqual(debt({ file: 'apps/frontend/src/app/(app)/s3/page.tsx', size: 2850, before: 2787 }), ['large-file-growth', 'page-with-logic']);
});

const lines = (text) => text.split('\n').map((line, i) => ({ n: i + 1, line }));
const rules = (file, text) => securityAlerts({ file, text, added: lines(text) }).map((a) => a.rule);
const SVC = 'apps/backend/src/modules/x/x.service.ts';

// ── seguridad ───────────────────────────────────────────────────────────────────────────
test('seguridad: cada regla de línea detecta su patrón', () => {
  const cases = {
    'public-route': `@Public()\n@Get('x')`,
    'process-env-secret': 'const k = process.env.ACC_IA_API_KEY;',
    'raw-sql-unsafe': 'await this.prisma.$queryRawUnsafe(`SELECT * FROM t WHERE id = ${id}`);',
    'dangerous-api': 'el.innerHTML = html;',
    'weak-crypto': "createHash('md5')",
    'cors-any-origin': "app.enableCors({ origin: '*' });",
    'log-sensitive': 'this.logger.log(`cookie ${cookie}`);',
    'shell-interpolation': 'execSync(`unzip ${file}`);',
    'error-message-in-response': 'throw new BadRequestException(err.message);',
  };
  for (const [rule, text] of Object.entries(cases)) assert.ok(rules(SVC, text).includes(rule), `${rule} no detectó: ${text}`);
});

test('seguridad: callan ante el código correcto', () => {
  const ok = [
    'const k = await this.parameters.get("ACC_IA_API_KEY");',
    'await this.prisma.$queryRaw`SELECT * FROM t WHERE id = ${id}`;',
    "createHash('sha256')",
    "throw new BadRequestException('No se pudo leer el archivo');",
    'this.logger.warn(`retry ${attempt}`);',
  ];
  for (const text of ok) assert.deepEqual(rules(SVC, text), [], text);
});

test('seguridad: falsos positivos encontrados por el backtest no vuelven', () => {
  assert.deepEqual(rules(SVC, 'this.prisma.academicPeriod.findUnique({ where: { code }, select: { origin: true } });'), [], '#23 select de Prisma');
  assert.deepEqual(rules('apps/frontend/src/x.tsx', "if (el) el.innerHTML = '';"), [], '#59 limpiar el contenedor');
  const bb = 'apps/backend/src/modules/blackboard/application/x.service.ts';
  const conClave = 'const key = `${userId}|${courseCode}`;\nconst cached = this.cache.get(key);';
  assert.deepEqual(securityAlerts({ file: bb, text: conClave, added: lines(conClave) }), [], '#30 la clave ya lleva el usuario');
  const mapLocal = 'function f() {\n  const contentCache = new Map();\n  contentCache.set(contentId, x);\n}';
  assert.deepEqual(securityAlerts({ file: bb, text: mapLocal, added: lines(mapLocal) }), [], '#33 Map local de una llamada');
});

test('seguridad: los tests, migraciones y scripts no se escanean', () => {
  assert.deepEqual(rules('apps/backend/src/x.spec.ts', 'el.innerHTML = x;'), []);
  assert.deepEqual(rules('apps/backend/scripts/medir.ts', 'const k = process.env.API_KEY;'), []);
});

test('scope-param-unused: recibe careerCode y no lo usa (IDOR)', () => {
  const bad = 'async listar(id: number, careerCode: string) {\n  return this.repo.find(id);\n}';
  const good = 'async listar(id: number, careerCode: string) {\n  return this.repo.find(id, careerCode);\n}';
  const all = new Set([1, 2, 3]);
  assert.equal(findUnusedScopeParams({ text: bad, addedNums: all }).length, 1);
  assert.equal(findUnusedScopeParams({ text: good, addedNums: all }).length, 0);
  assert.equal(findUnusedScopeParams({ text: bad, addedNums: new Set() }).length, 0, 'firma no tocada: no se reporta');
});

test('cache-key-without-user: solo en Blackboard y solo sin usuario en la clave', () => {
  const bb = 'apps/backend/src/modules/blackboard/application/x.service.ts';
  assert.ok(rules(bb, 'this.rosterCache.set(courseId, roster);').includes('cache-key-without-user'));
  assert.ok(!rules(bb, 'this.rosterCache.set(`${userId}:${courseId}`, roster);').includes('cache-key-without-user'));
  assert.ok(!rules(SVC, 'this.rosterCache.set(courseId, roster);').includes('cache-key-without-user'));
});

// ── duplicados ──────────────────────────────────────────────────────────────────────────
const BLOCK = `function normalizarRotulo(texto) {
  const limpio = texto.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  const partes = limpio.split(/[\\s_-]+/).filter(Boolean);
  const resultado = [];
  for (const parte of partes) {
    if (parte.length > 2) resultado.push(parte.toLowerCase());
    else resultado.push(parte.toUpperCase());
  }
  const unido = resultado.join(' ').trim();
  if (!unido) throw new Error('rótulo vacío después de normalizar');
  return unido.replace(/\\s+/g, ' ');
}`;
const renamed = BLOCK.replace(/normalizarRotulo/g, 'limpiarNombre').replace(/limpio/g, 'base').replace(/partes/g, 'trozos');
const target = (file, text) => ({ file, text, addedNums: new Set(text.split('\n').map((_, i) => i + 1)) });

test('duplicados: tercera copia → extraer; segunda → tolerada', () => {
  const t = target('apps/backend/src/a/nuevo.ts', BLOCK);
  const tres = findClones({ targets: [t], corpus: [t, { file: 'apps/backend/src/b/uno.ts', text: BLOCK }, { file: 'apps/backend/src/c/dos.ts', text: BLOCK }] });
  assert.equal(tres[0]?.verdict, 'extract');
  assert.equal(tres[0]?.copies, 3);
  const dos = findClones({ targets: [t], corpus: [t, { file: 'apps/backend/src/b/uno.ts', text: BLOCK }] });
  assert.equal(dos[0]?.verdict, 'tolerated');
});

test('duplicados: detecta la copia con nombres cambiados, y no cruza paquetes', () => {
  const t = target('apps/backend/src/a/nuevo.ts', BLOCK);
  const r = findClones({ targets: [t], corpus: [t, { file: 'apps/backend/src/b/uno.ts', text: renamed }] });
  assert.equal(r[0]?.kind, 'renamed');
  const front = findClones({ targets: [t], corpus: [t, { file: 'apps/frontend/src/lib/uno.ts', text: BLOCK }] });
  assert.equal(front.length, 0);
});

// ── reutilización y código muerto ───────────────────────────────────────────────────────
test('redeclared-export: declara algo que otro archivo del paquete ya exporta', () => {
  const corpus = [{ file: 'apps/backend/src/common/rotulos.ts', text: 'export function normalizarRotulo(x) { return x; }' }];
  const added = lines('function normalizarRotulo(t) { return t.trim(); }');
  assert.equal(findRedeclared({ file: SVC, added, index: buildIndex(corpus) })[0]?.rule, 'redeclared-export');
  assert.equal(findRedeclared({ file: 'apps/frontend/src/lib/x.ts', added, index: buildIndex(corpus) }).length, 0, 'otro paquete');
});

test('dead-export y dead-file: lo nuevo que nadie usa', () => {
  const file = 'apps/backend/src/modules/x/helpers-nuevos.ts';
  const src = 'export function sinUso() {}\nexport function usada() {}\nexport function soloTest() {}\nexport type Opciones = { a: number };\nexport function interna(o: Opciones) {}\nexport const local = 1;\nconst y = local;';
  const added = lines(src);
  const corpus = [
    { file, text: src },
    { file: SVC, text: "import { usada, interna } from './helpers-nuevos';\nusada(); interna({ a: 1 });" },
    { file: 'apps/backend/src/modules/x/x.spec.ts', text: 'soloTest();' },
  ];
  const r = findDeadCode({ file, added, isNew: true, corpus });
  // usada: otro archivo · soloTest: un test (patrón del repo) · Opciones: tipo · local: su propio archivo
  assert.deepEqual(r.map((a) => a.msg.split(' ')[0]), ['sinUso']);
  const huerfano = findDeadCode({ file, added: [], isNew: true, corpus: corpus.filter((c) => c.file !== SVC) });
  assert.equal(huerfano[0]?.rule, 'dead-file');
});

test('dead-*: las entradas del framework no cuentan', () => {
  assert.equal(findDeadCode({ file: 'apps/frontend/src/app/(app)/x/page.tsx', added: lines('export const metadata = {}'), isNew: true, corpus: [] }).length, 0);
});
