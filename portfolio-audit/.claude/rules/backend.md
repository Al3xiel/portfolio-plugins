---
paths:
  - "apps/backend/**"
---

# Backend (NestJS + Prisma)

- `PermissionsGuard` sin `@RequirePermission` (en la clase o el método) deja pasar a cualquier
  usuario autenticado, sin error. Todo endpoint nuevo lleva el decorador.
- El permiso dice qué acción; el organigrama, sobre qué carrera. Un endpoint que recibe `careerCode`
  o una ruta S3 del cliente llama además a `S3AccessService.assertCanView`. La regla vive en
  `s3-access.service.ts`: no reimplementarla.
- Credenciales de S3, ACC-IA y Acreditación en `system.parameters`, nunca en `process.env`.
- Sin `catch {}` vacíos: en auditorías, `AuditEventLogger`; fuera, el `Logger` de Nest.
- Datos de Blackboard de un usuario nunca se comparten con otro (claves de caché incluidas).
- Migraciones: `node .claude/pa/pa.mjs migration <nombre>` (schema contra schema, sin base).
- Tests: Jest, `*.spec.ts` junto al archivo; no abren conexión. Correr con `node .claude/pa/pa.mjs test <spec>`.
- Un spec que falla con `has no exported member` o `Property '<modelo>' does not exist on type
  'PrismaService'` no es un RED: el cliente quedó viejo → `npx prisma generate` (no toca la base).

## Estructura de archivos nuevos (un hook la hace cumplir al crear)

Un nombre dice **para qué** es el archivo, nunca cómo está escrito: `<nombre>.<tipo>.ts`, un tipo
por archivo. Módulos nuevos en `src/modules/<módulo>/` con las capas que ya usan blackboard y evidence:

| Capa | Tipos |
| --- | --- |
| raíz del módulo | `module` |
| `presentation/` | `controller`, `dto`, `response`, `gateway`, `guard`, `decorator`, `pipe`, `interceptor` |
| `application/` | `service` (orquesta casos de uso), `job` (corridas en segundo plano), `template` |
| `domain/` | `entity`, `types`, `interface`, `calc` (cálculo puro), `rule` (regla de auditoría), `policy` (quién puede qué), `value`, `repository` (el puerto) |
| `infrastructure/` | `repository` (implementación Prisma), `client` (Blackboard, ACC-IA, Acreditación), `storage` (S3), `builder` (PDF, Excel, ZIP), `renderer`, `cache`, `store`, `provider`, `factory`, `concurrency`, `prompts` |
| `domain/` o `infrastructure/` | `mapper`, `errors`, `constants` |

- Prohibido en archivos nuevos: `.util.ts`, `.utils.ts`, `.helper(s).ts`, `.functions.ts`, `.common.ts`
  y nombres sin tipo. Elige el tipo por lo que hace el código.
- `domain/` no importa de `application/`, `infrastructure/` ni `presentation/`.
- Prisma solo en repositorios.
- Lo heredado no se bloquea: los módulos planos (`auditorias/`, `academic/`…) exigen el tipo en
  archivos nuevos pero no la capa; las capas llegan con su refactor. Un archivo de más de 1200 líneas
  tolera un arreglo (≤ 40 líneas), no una feature: lo nuevo va en un archivo propio.
- Excepción justificada: la ruta en `.claude/pa/naming-exceptions.txt` con su motivo.
