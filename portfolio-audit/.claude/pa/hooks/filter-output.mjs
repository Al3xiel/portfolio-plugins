#!/usr/bin/env node
/**
 * PreToolUse (Bash): si Claude corre jest, vitest, tsc o eslint directo, reescribe el comando
 * para que pase por `pa.mjs exec`, que devuelve solo conteos y fallos. Una corrida de jest puede
 * ser miles de líneas que quedan en el contexto y se reenvían en cada turno; el resumen, decenas.
 *
 * No aprueba nada: devuelve solo `updatedInput`, así que las reglas de permisos de siempre se
 * evalúan sobre el comando reescrito. Cualquier error aquí deja el comando original intacto.
 * Para ver la salida completa a propósito, agregar `| cat` al comando: el hook no lo toca.
 */
import { readFileSync } from 'node:fs';

/**
 * Misma expresión que SAFE_EXEC en pa.mjs: un `cd` opcional y una sola herramienta, sin `|`,
 * `;`, `&&` extra ni sustituciones. Lo demás (incluido `… | cat` para ver todo) pasa intacto.
 */
const SAFE_EXEC = /^\s*(cd\s+[\w./\\:-]+\s*&&\s*)?(npx\s+(jest|vitest|tsc|eslint)|npm\s+(test|run\s+(test|lint)))(\s+[^;&|`$()<>\n]*)?$/;

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const command = input.tool_input?.command ?? '';
  const skip = !SAFE_EXEC.test(command)
    || /--watch\b|\bwatch\b/.test(command)
    || input.tool_input?.run_in_background;
  if (skip) process.exit(0);

  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const script = `${project.replace(/\\/g, '/')}/.claude/pa/pa.mjs`;
  const b64 = Buffer.from(command, 'utf8').toString('base64');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { ...input.tool_input, command: `node "${script}" exec --b64 ${b64}` },
    },
  }));
} catch {
  process.exit(0);
}
