---
paths:
  - "apps/frontend/**"
---

# Frontend (Next.js App Router)

- Next 16: revisa la guía en `apps/frontend/node_modules/next/dist/docs/` antes de usar una API que
  no hayas visto en este repo (ver `apps/frontend/AGENTS.md`).
- Tests: Vitest, solo lógica pura (`src/lib`, servicios, helpers); no se montan componentes.
  Correr con `node .claude/pa/pa.mjs test <spec>`.
- Lo que el usuario ve según sus permisos se decide en `src/lib` y se prueba ahí; el backend
  igual valida (`@RequirePermission`, `assertCanView`): ocultar un botón no es control de acceso.

## Estructura de archivos nuevos (un hook la hace cumplir al crear)

- `app/` es el cascarón de las rutas: solo `page`, `layout`, `loading`, `error`, `route`… La página
  importa un componente de `components/<área>/`; la lógica va en hooks y `lib/`. Una `page.tsx` de más
  de 300 líneas no crece con lógica nueva.
- Componentes en `components/<área>/` (`audit`, `blackboard`, `evidencias`…), no sueltos en `components/`.
- Prohibido: nombres `*Utils.ts`, `*Helpers.ts` y carpetas `helpers/`. Una función pura va en `lib/`
  con el nombre de lo que calcula; un mapeo, `<cosa>Mapper.ts`; un hook, `hooks/use<Algo>.ts`.
- Un archivo de más de 1200 líneas tolera un arreglo (≤ 40 líneas), no una feature.
