---
name: pa-module-doc
description: "Write or refresh the short doc of one module (what it does, file map, main flow, rules and traps, how to test) so later sessions read 1-2 pages instead of exploring 10-20 files. Refresh mode reads only what changed since the doc's last edit. Cost: medium once; saves exploration on every later task in that module."
argument-hint: "<módulo de .claude/pa/modules.json>"
disable-model-invocation: true
---

# Documentar un módulo

Un doc corto se paga una vez; explorar el módulo se paga en cada tarea. El doc es para el
siguiente agente o persona que lo toque: orienta, no reemplaza al código.

## 1. Estado — un mensaje, en paralelo

- `node .claude/pa/pa.mjs module $ARGUMENTS` — docs que tiene, tamaño y si están desactualizados.
- `git ls-files <rutas del módulo en .claude/pa/modules.json> | head -80`.

**Refrescar** (hay doc, con commits detrás): `git log --oneline <último commit del doc>..HEAD -- <rutas>`
y lee solo lo que esos commits tocaron (`git show --stat`, `outline`, rangos). No releas el módulo entero.

**Crear** (no hay doc): `outline` de los controladores, servicios principales y archivos de más de
1200 líneas; `Read` solo los rangos que confirman cada afirmación.

## 2. Escribir — máximo ~120 líneas

En `docs/<módulo>/README.md`, o el doc que ya tenga:

```markdown
# <Módulo>

<Qué hace, en 3-5 líneas: para quién, qué entra, qué sale.>

## Mapa
| Archivo | Rol |                       ← máximo 15 filas, los que alguien abriría primero

## Flujo principal
1. <paso> (`archivo:símbolo`)

## Reglas y trampas
- <lo que se rompe si no se sabe> (`archivo:línea`)

## Permisos y alcance
<permiso por endpoint; dónde se valida la carrera, el usuario o la ruta S3>

## Cómo probar
<specs clave · `node .claude/pa/pa.mjs test <spec>`>

## Docs relacionados
```

- Cada afirmación verificada en el código, con `archivo:línea` o `archivo:símbolo`. Lo que no
  confirmaste no va; si es importante, como `Pendiente: …`.
- Nada que se lea igual del código en un vistazo (listas de DTOs, campos, imports).
- Si el módulo ya tiene docs largos (`backend.md`, `frontend.md`), el README es la puerta de entrada:
  enlázalos por sección en vez de repetirlos.

## 3. Registrar

Agrega el doc a `docs` del módulo en `.claude/pa/modules.json` si no estaba. Cierre: ruta del doc,
líneas, y qué quedó `Pendiente`. Sin commit sin aprobación.
