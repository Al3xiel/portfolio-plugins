---
name: pa-create-pr
description: "Open the PR against main from the facts the script gathers (commits, migrations, endpoints and their permissions), with no code re-reading; reminds that merging deploys; waits for approval. Cost: light."
argument-hint: "[--base main]"
disable-model-invocation: true
effort: low
---

# Crear el PR

## 1. Hechos — una llamada

`node .claude/pa/pa.mjs pr`. No leas código: los hechos ya están ahí.

Paradas (pregunta antes de seguir): `PARADA` por cambios sin commitear, tareas abiertas en el plan,
o `MIGRACIONES` (avisa: el merge las aplica en producción).

## 2. Cuerpo

```markdown
## Qué cambia
<1-2 frases, del objective o de los commits>

## Cómo se probó
- <specs> — n/n · tsc ok

## Riesgo de despliegue
<migraciones · endpoints y su permiso, tal como los listó el script · nada que dispare la Fase 3>
```

Título: Conventional Commit de una línea. Sin atribución de IA.

## 3. Publicar

Muestra título y cuerpo y **espera un sí explícito**. Luego `git push -u origin <rama>` si no
tiene upstream, y:
- con `gh`: `gh pr create --base main --title "…" --body-file <tmp>`;
- sin `gh`: el enlace `compare` que imprimió el script, y el cuerpo listo para pegar.

Cierre: el enlace, y una línea: al hacer merge se despliega.
