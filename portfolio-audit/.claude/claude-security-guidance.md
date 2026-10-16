# Security guidance — PORTFOLIO-AUDIT

Read by the security-guidance plugin (end-of-turn and commit reviews) and by the Access lens of
`/pa-audit`. NestJS + Prisma backend (`apps/backend`), Next.js frontend (`apps/frontend`).

## Threat model

- Tenancy is the **career** (`careerCode`), not the user's role. A DIRECTOR and an ADMIN can both
  hold `auditoria.manage`; the org chart decides which careers each one sees. The main risk is one
  career's portfolio, audit or S3 files reaching a user of another career.
- Blackboard data (sessions, cookies, rosters, submissions) belongs to **one user**. Sharing it across
  users — through a cache key, a shared browser, an export prefix — is a data leak.
- Credentials for S3, the ACC-IA engine and Acreditación live in `system.parameters`, encrypted.
  `apps/backend/.env` points at the production database.

## Must hold on every new or changed endpoint

- `PermissionsGuard` without `@RequirePermission` (class or method) lets **any authenticated user**
  through, silently. Every route has `@RequirePermission(...)`, `@Roles(...)` with `RolesGuard`, or
  an explicit, justified `@Public()`.
- A route that takes a `careerCode`, an S3 path/prefix or a session/audit id from the client must
  also call `S3AccessService.assertCanView` (or `assertViewable` for sessions). The permission says
  *which action*; the org chart says *on which career*. Do not reimplement the check.
- Reading is inherited from the org chart; **writing** to S3 (upload, move, rename, delete) is not:
  it needs an explicit grant.
- Sibling routes on the same controller must protect the same data the same way.

## Repo-specific vulnerability patterns

- A function that receives `careerCode`, `userId` or a base path and never uses it in its query: IDOR.
- `findMany` without the career filter followed by an in-memory filter or a count: another career's
  data leaks as a number.
- `$queryRawUnsafe` / `Prisma.raw` with interpolated values. `$queryRaw` with a template is fine.
- `err.message` from Prisma, S3, Blackboard or ACC-IA returned to the client.
- `encryptedSession`, cookies or tokens in a response DTO or a log line.
- A Blackboard `courseUrl` or download URL the server fetches with the user's cookies: its origin
  must equal the connection's `baseUrl` and use https (SSRF with credentials).

## Not findings here

- Content sent to the ACC-IA engine inside a prompt (user-controlled text in an AI prompt is not a
  vulnerability by itself).
- Missing permission checks in frontend code: the backend enforces them.
- Rate limiting, DoS, memory/CPU exhaustion, outdated dependencies, missing hardening headers.
- Scripts under `apps/backend/scripts/` and test files.
