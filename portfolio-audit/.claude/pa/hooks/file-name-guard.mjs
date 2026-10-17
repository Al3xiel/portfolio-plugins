#!/usr/bin/env node
/**
 * PreToolUse (Write): rechaza un archivo NUEVO que no cumple el estándar de estructura
 * (.claude/pa/lib/naming.mjs) en el momento de crearlo, que es cuando corregirlo es más barato.
 * Un archivo que ya existe nunca se bloquea: lo heredado se tolera.
 *
 * Excepción deliberada: agregar la ruta a `.claude/pa/naming-exceptions.txt` (una por línea), con
 * el motivo en un comentario `#` — queda en el diff y se discute en el PR.
 * Cualquier error aquí deja pasar la escritura: el hook nunca debe trabar el trabajo por un fallo propio.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { checkNewPath } from '../lib/naming.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const target = input.tool_input?.file_path;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!target || !project) process.exit(0);
  const abs = isAbsolute(target) ? target : join(input.cwd || project, target);
  if (existsSync(abs)) process.exit(0);

  const rel = relative(project, abs).replace(/\\/g, '/');
  if (rel.startsWith('..')) process.exit(0);
  const exceptions = join(project, '.claude/pa/naming-exceptions.txt');
  if (existsSync(exceptions) && readFileSync(exceptions, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).includes(rel)) process.exit(0);

  // Planes y propuestas llevan el prefijo que dice qué son: los scripts los reconocen por el nombre.
  const doc = rel.match(/^\.claude\/pa\/(work|proposals)\/([^/]+)\.md$/);
  const docPrefix = doc && !doc[2].startsWith('backtest-') ? (doc[1] === 'work' ? 'plan-' : 'prop-') : null;
  const listDir = (dir) => execFileSync('git', ['ls-files', '--', dir], { cwd: project, encoding: 'utf8' }).split('\n').filter(Boolean);
  const problem = docPrefix && !doc[2].startsWith(docPrefix)
    ? { msg: `en ${doc[1]}/ el nombre empieza con "${docPrefix}" (${docPrefix}${doc[2].replace(/^(plan|prop)-/, '')}.md)` }
    : checkNewPath(rel, listDir);
  if (!problem) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Estándar de estructura (${rel}): ${problem.msg}. Elige otra ruta; si es una excepción justificada, agrégala a .claude/pa/naming-exceptions.txt con el motivo.`,
    },
  }));
} catch {
  process.exit(0);
}
