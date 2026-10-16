#!/usr/bin/env node
/**
 * Reinstala las herramientas en un checkout de PORTFOLIO-AUDIT (por ejemplo, tras clonar de nuevo).
 *
 *   node restore.mjs <ruta-a-PORTFOLIO-AUDIT> [--force]
 *
 * - Copia `portfolio-audit/.claude/` y `CLAUDE.local.md` a la raíz del checkout.
 * - Agrega `/.claude/` y `/CLAUDE.local.md` a `.git/info/exclude`, para que git no los vea ni se
 *   suban por accidente (es local: no toca `.gitignore`, que es compartido).
 * - No pisa un archivo que ya existe con contenido distinto salvo con `--force`; los lista.
 */
import { cpSync, existsSync, readFileSync, appendFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const [target, ...flags] = process.argv.slice(2);
const force = flags.includes('--force');
if (!target || !existsSync(join(target, '.git')) || !existsSync(join(target, 'apps'))) {
  console.error('uso: node restore.mjs <ruta-a-PORTFOLIO-AUDIT> [--force]  (no parece un checkout de PORTFOLIO-AUDIT)');
  process.exit(2);
}

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(HERE, 'portfolio-audit');
const list = (dir, base = dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? list(p, base) : [relative(base, p)];
});

const conflicts = [];
let copied = 0;
for (const rel of list(SRC)) {
  const to = join(target, rel);
  if (existsSync(to) && !force && !readFileSync(to).equals(readFileSync(join(SRC, rel)))) { conflicts.push(rel); continue; }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(SRC, rel), to);
  copied++;
}

const exclude = join(target, '.git', 'info', 'exclude');
mkdirSync(dirname(exclude), { recursive: true });
const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
const missing = ['/.claude/', '/CLAUDE.local.md'].filter((l) => !current.split(/\r?\n/).includes(l));
if (missing.length) appendFileSync(exclude, `\n# Skills y herramientas pa-* para Claude Code: solo locales, no se suben al repositorio\n${missing.join('\n')}\n`);

console.log([
  `restaurado en ${target}: ${copied} archivo(s)`,
  missing.length ? `exclusión agregada en .git/info/exclude: ${missing.join(' ')}` : 'exclusión ya presente en .git/info/exclude',
  conflicts.length ? `NO se pisaron ${conflicts.length} archivo(s) distintos (usa --force para reemplazarlos):\n  ${conflicts.join('\n  ')}` : '',
  'siguiente: abrir una sesión nueva de Claude Code en el checkout (los hooks y skills se cargan al iniciar)',
].filter(Boolean).join('\n'));
