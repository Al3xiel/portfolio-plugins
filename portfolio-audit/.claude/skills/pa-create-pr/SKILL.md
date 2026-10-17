---
name: pa-create-pr
description: "Decide whether this branch deserves its own merge to main (each one runs the full GitHub Actions pipeline) or should be bundled; then open the PR from the facts the script gathers, with no code re-reading. Waits for approval. Cost: light."
argument-hint: "[--base main]"
disable-model-invocation: true
effort: low
---

# Crear el PR

Cada merge a `main` corre **todo** el pipeline de GitHub Actions (tests de backend y frontend, build
de imágenes, deploy), sea una línea o una feature, y eso cuesta. El objetivo es menos PRs, más
completos.

## 1. Hechos — una llamada

`node .claude/pa/pa.mjs pr`. No leas código: los hechos ya están ahí, incluidas las otras ramas
abiertas sin mergear y si este cambio toca código de la app.

Paradas (pregunta antes de seguir): `PARADA` por cambios sin commitear, tareas abiertas en el plan,
o `MIGRACIONES` (avisa: el merge las aplica en producción).

## 2. ¿Merece su propio pipeline?

Antes de armar nada, con lo que imprimió el script:

- **`SIN CÓDIGO DE APP`** (solo docs, `odd/`, config local): no abras PR. Propón sumarlo a una de las
  ramas abiertas que listó el script, o dejarlo commiteado en la rama hasta el próximo PR con código.
- **Arreglo chico** (pocas líneas, sin migración) **y hay otras ramas abiertas**: propón juntarlas en
  un solo PR (traer los commits a una rama con `git merge` o `cherry-pick`, con aprobación) o esperar
  a la siguiente tarea para mandarlas juntas.
- **Parte de una feature** cuyo resto sigue abierto: no; va en el PR de la feature completa.
- PR propio solo si es la feature completa, o si el usuario necesita que llegue a producción **ya**.

Pregunta en una línea qué prefiere, con tu recomendación. Si decide esperar, cierra ahí: el trabajo
queda commiteado en su rama.

## 3. Cuerpo

```markdown
## Qué cambia
<1-2 frases, del objective o de los commits; si junta varias tareas, una viñeta por tarea>

## Cómo se probó
- <specs> — n/n · tsc ok

## Riesgo de despliegue
<migraciones · endpoints y su permiso, tal como los listó el script · nada que dispare la Fase 3>
```

Título: Conventional Commit de una línea. Sin atribución de IA.

## 4. Publicar

Muestra título y cuerpo y **espera un sí explícito**. Luego `git push -u origin <rama>` si no
tiene upstream, y:
- con `gh`: `gh pr create --base main --title "…" --body-file <tmp>`;
- sin `gh`: el enlace `compare` que imprimió el script, y el cuerpo listo para pegar.

Cada push a la rama del PR no corre el pipeline (solo el merge a `main`), pero conviene no mergear
hasta que el PR esté completo: un "fix del fix" después del merge es otro pipeline entero.

Cierre: el enlace, y una línea: al hacer merge se despliega.
