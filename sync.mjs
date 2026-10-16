#!/usr/bin/env node
/**
 * Trae al respaldo lo que hoy está instalado en un checkout de PORTFOLIO-AUDIT.
 *
 *   node sync.mjs <ruta-a-PORTFOLIO-AUDIT> [--dry-run]
 *
 * Copia `.claude/` y `CLAUDE.local.md` a `portfolio-audit/`, sin los datos de trabajo locales
 * (`.claude/pa/work/`: planes por rama y resultados de backtest). Lo que ya no existe en el
 * checkout se borra del respaldo, para que sea un espejo. Después: revisar `git diff` y commitear.
 */
import { cpSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [source, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry-run');
if (!source || !existsSync(join(source, '.claude'))) {
  console.error('uso: node sync.mjs <ruta-a-PORTFOLIO-AUDIT> [--dry-run]  (no encontré .claude/ ahí)');
  process.exit(2);
}

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DEST = join(HERE, 'portfolio-audit');
/** Datos de trabajo de cada máquina: no son la herramienta. */
const SKIP = /[\\/]\.claude[\\/]pa[\\/]work([\\/]|$)/;
const ITEMS = ['.claude', 'CLAUDE.local.md'];

const list = (dir, base = dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? list(p, base) : [relative(base, p)];
}) : []);

const before = new Set(list(DEST));
if (!dry) rmSync(DEST, { recursive: true, force: true });
for (const item of ITEMS) {
  const from = join(source, item);
  if (!existsSync(from)) { console.warn(`aviso: no existe ${item} en el checkout`); continue; }
  if (!dry) cpSync(from, join(DEST, item), { recursive: true, filter: (p) => !SKIP.test(p) });
}
const after = dry ? new Set() : new Set(list(DEST));
const added = [...after].filter((f) => !before.has(f));
const removed = [...before].filter((f) => !after.has(f));
console.log(dry
  ? `simulación: se copiarían ${ITEMS.join(' y ')} desde ${source} (sin .claude/pa/work/)`
  : `respaldo actualizado: ${after.size} archivos (${added.length} nuevos, ${removed.length} borrados). Revisa con git diff y commitea.`);
