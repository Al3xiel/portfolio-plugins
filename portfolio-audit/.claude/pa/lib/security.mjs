/**
 * Reglas de seguridad deterministas sobre lo que agrega un diff.
 *
 * Adaptadas de abet-plugins (shared/scripts/lib/security.mjs) al modelo de este repo: aquí el
 * alcance no es schoolId sino la carrera (`careerCode`), la ruta S3 y el usuario (los datos de
 * Blackboard son por usuario). Un hit es un candidato: el auditor lo confirma o lo descarta con
 * una razón, pero encontrarlo no cuesta tokens ni depende de que el modelo lo note.
 */

const SOURCE = /^apps\/backend\/.*\.ts$/;
const TEST = /\.(spec|test)\.ts$/;
const NOT_RUNTIME = /(^|\/)(migrations|seeds?|scripts)\//;

/** Reglas de una línea: `re` corre sobre cada línea agregada de un archivo que calce con `files`. */
export const LINE_RULES = [
  {
    id: 'public-route', files: SOURCE,
    re: /@Public\(\)/,
    msg: 'ruta @Public(): sin JWT ni permiso — confirmar que es intencional y que no expone datos de una carrera',
  },
  {
    id: 'process-env-secret', files: SOURCE, skip: /(^|\/)(main|[\w.-]*config)\.ts$/,
    re: /process\.env\.\w*(KEY|SECRET|TOKEN|PASSWORD|PASS)\b/i,
    msg: 'secreto leído de process.env: las credenciales van en system.parameters',
  },
  {
    id: 'raw-sql-unsafe', files: SOURCE,
    re: /\$(queryRaw|executeRaw)Unsafe\s*\(|Prisma\.raw\s*\(/,
    msg: '$queryRawUnsafe / Prisma.raw: SQL armado a mano — usar $queryRaw con template (parámetros) salvo que el texto sea constante',
  },
  {
    id: 'dangerous-api', files: /^apps\/.*\.tsx?$/,
    // `innerHTML = ''` solo limpia (backtest #59): no inyecta nada.
    re: /\b(eval\s*\(|new Function\s*\()|dangerouslySetInnerHTML|\.innerHTML\s*=(?!\s*['"`]{2})|rejectUnauthorized\s*:\s*false/,
    msg: 'ejecuta o inyecta contenido arbitrario, o apaga la verificación TLS',
  },
  {
    id: 'weak-crypto', files: SOURCE,
    re: /createHash\(\s*['"](md5|sha1)['"]/,
    msg: 'MD5/SHA-1 no sirven para integridad ni contraseñas',
  },
  {
    id: 'cors-any-origin', files: SOURCE,
    // `origin: true` sin `cors` en la línea es casi siempre un select de Prisma (backtest #23).
    re: /\b(enableCors|cors)\b.*\borigin\s*:\s*(['"]\*['"]|true\b)|\borigin\s*:\s*['"]\*['"]/,
    msg: 'CORS abierto a cualquier origen',
  },
  {
    id: 'log-sensitive', files: SOURCE,
    re: /(console\.\w+|logger\.\w+|this\.logger\.\w+)\s*\([^)]*\b(password|passwd|secret|token|authorization|api_?key|cookie|encryptedSession)\b/i,
    msg: 'un valor sensible puede llegar al log',
  },
  {
    id: 'shell-interpolation', files: SOURCE,
    re: /\b(exec|execSync|spawn|spawnSync)\s*\(\s*`[^`]*\$\{/,
    msg: 'interpolar un valor en un comando de shell es inyección salvo que sea fijo y confiable',
  },
  {
    id: 'error-message-in-response', files: SOURCE,
    re: /new\s+\w*(Exception|Error)\s*\([^)]*\b(err|error|e)\.message\b|res\.(status\([^)]*\)\.)?(json|send)\([^)]*\b(err|error|e)\.message\b/,
    msg: 'el mensaje interno de un error (driver, librería, S3) vuelve al cliente: devolver un texto fijo y dejar el detalle en el log',
  },
];

/** Parámetros que definen el alcance en este repo: si una función los recibe y no los usa, no filtra por ellos. */
const SCOPE_PARAM = /^(careerCode|carrera|programCode|userId|s3BasePath|basePath)$/;
const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor', 'return', 'await']);

/**
 * Una función que recibe el alcance (carrera, usuario, ruta base) y nunca lo usa en su cuerpo:
 * lo que hace no está limitado a lo que el llamador puede ver. Es la forma exacta de los IDOR
 * que el ledger de abet-plugins encontraba a mano (`getRoster(id, schoolId) { return find(id) }`).
 */
export function findUnusedScopeParams({ text, addedNums }) {
  const issues = [];
  const start = /^[ \t]*(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
  for (const m of text.matchAll(start)) {
    if (NOT_A_FUNCTION.has(m[1])) continue;
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = closingBracket(text, parenOpen, '(', ')');
    if (!/^\s*[{:]/.test(text.slice(parenClose + 1, parenClose + 40))) continue; // llamada, no declaración
    const names = text.slice(parenOpen + 1, parenClose).replace(/@\w+\([^)]*\)/g, '').split(',')
      .map((p) => p.trim().replace(/^(readonly|private|public|protected)\s+/, '').split(/[?:=\s]/)[0])
      .filter((p) => SCOPE_PARAM.test(p));
    if (!names.length) continue;
    let angle = 0, open = -1;
    for (let i = parenClose + 1; i < text.length; i++) {
      const c = text[i];
      if (c === '<') angle++;
      else if (c === '>' && text[i - 1] !== '=') angle = Math.max(0, angle - 1);
      else if (c === ';' && angle === 0) break;
      else if (c === '{' && angle === 0) { open = i; break; }
    }
    if (open < 0) continue;
    const line = text.slice(0, parenOpen).split('\n').length;
    const lastLine = text.slice(0, open).split('\n').length;
    if (![...Array(lastLine - line + 1).keys()].some((k) => addedNums.has(line + k))) continue; // firma no tocada
    const body = text.slice(open, closingBrace(text, open));
    for (const p of names) {
      if (!new RegExp(`\\b${p}\\b`).test(body)) {
        issues.push({ rule: 'scope-param-unused', line, msg: `${m[1]}() recibe ${p} y no lo usa: lo que hace no queda limitado a ese alcance (posible IDOR)` });
      }
    }
  }
  return issues;
}

/** Cachés del módulo de Blackboard: sus datos son por usuario, y la clave debe decir de quién. */
const CACHE_CALL = /\b(\w*[cC]ache\w*)\.(get|set|has)\(\s*([^,)]+)/;
const USER_SCOPE = /user|connection|owner|session|cookie/i;

export function findCacheWithoutUser({ file, text = '', added }) {
  if (!/^apps\/backend\/src\/modules\/blackboard\//.test(file)) return [];
  // Calibrado con el backtest (#30, #33): la clave suele armarse antes (`const key = \`${userId}|…\``),
  // y un Map declarado dentro de una función vive una sola llamada, así que no se comparte.
  const keyDef = (name) => text.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*([^;\\n]+)`))?.[1] ?? '';
  const localMap = (name) => new RegExp(`^\\s{2,}(?:const|let)\\s+${name}\\s*=\\s*new\\s+Map`, 'm').test(text);
  return added
    .map(({ n, line }) => ({ n, m: line.match(CACHE_CALL) }))
    .filter(({ m }) => m && !USER_SCOPE.test(m[3]) && !USER_SCOPE.test(m[1]))
    .filter(({ m }) => !/^\w+$/.test(m[3].trim()) || !USER_SCOPE.test(keyDef(m[3].trim())))
    .filter(({ m }) => !localMap(m[1]))
    .map(({ n, m }) => ({ rule: 'cache-key-without-user', line: n,
      msg: `${m[1]}.${m[2]}(${m[3].trim().slice(0, 40)}): clave sin usuario en Blackboard — confirmar que el dato no es por usuario` }));
}

/** Corre todas las reglas de seguridad sobre un archivo cambiado. */
export function securityAlerts({ file, text, added }) {
  if (TEST.test(file) || NOT_RUNTIME.test(file)) return [];
  const out = [];
  for (const r of LINE_RULES) {
    if (!r.files.test(file) || r.skip?.test(file)) continue;
    for (const { n, line } of added) if (r.re.test(line)) out.push({ rule: r.id, line: n, msg: r.msg });
  }
  if (SOURCE.test(file)) {
    out.push(...findUnusedScopeParams({ text, addedNums: new Set(added.map((a) => a.n)) }));
    out.push(...findCacheWithoutUser({ file, text, added }));
  }
  return out;
}

export function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) < 0 ? text.length : text.indexOf('*/', i) + 1;
    else if (c === '"' || c === "'" || c === '`') { for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++; }
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return text.length;
}

function closingBracket(text, open, o, c) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++; }
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return text.length;
}
