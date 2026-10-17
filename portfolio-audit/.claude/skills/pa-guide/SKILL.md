---
name: pa-guide
description: "Which pa-* command to use for a situation, from the command and case guide (.claude/pa/GUIA.md). Reads only the section that applies. Cost: light."
argument-hint: "<qué quieres hacer, o vacío para ver el índice>"
disable-model-invocation: true
effort: low
---

# Guía de comandos

La guía completa está en `.claude/pa/GUIA.md`. No la leas entera:

1. `node .claude/pa/pa.mjs outline .claude/pa/GUIA.md` (secciones con su rango de líneas).
2. Sin `$ARGUMENTS`: muestra las tablas *Skills* y *Script* (lee solo esos rangos) y la lista de casos.
3. Con una pregunta: lee solo el caso (o los dos) que la responden, y contesta en pocas líneas con el
   comando exacto y el orden. Si ningún caso aplica, dilo y propone el más cercano.

No ejecutes nada: esta skill solo orienta.
