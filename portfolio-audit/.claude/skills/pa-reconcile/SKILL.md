---
name: pa-reconcile
description: "Cross-check several plans and proposals that touch the same code: a script finds where they intersect (paths, endpoints, symbols, tables, permissions, migrations) with line numbers, and only those lines are read to classify each overlap as contradiction, duplication, dependency, merge clash or compatible. Writes a Coordination section into each document. Cost: light-medium."
argument-hint: "--session <nombre> | [slug…]  (sin argumento: todos los planes y propuestas activos)"
disable-model-invocation: true
---

# Conciliar planes y propuestas que se cruzan

Cuando varias tareas o propuestas tocan lo mismo, las fallas aparecen en los bordes: dos decisiones
opuestas sobre el mismo endpoint, el mismo trabajo hecho dos veces, una que necesita lo que otra crea,
dos ramas que editan el mismo archivo o el mismo `schema.prisma`. Esta skill las busca **sin releer
los documentos enteros**: el script ubica los cruces y se leen solo esas líneas.

## 0. El grupo

Lo normal es conciliar una **sesión** (`.claude/pa/sessions/<nombre>/`): el grupo de planes y propuestas
que se trabajan juntos. `node .claude/pa/pa.mjs session show <nombre>` muestra sus miembros, su estado y
cuántas notas de coordinación ya tienen. Si no hay sesión y el usuario nombra varios documentos que van
juntos, propone crearla (`session new <nombre> --goal "…" <slug…>`): la próxima conciliación es un comando.
`session list` muestra los documentos sin sesión.

## 1. Cruces — una llamada

`node .claude/pa/pa.mjs overlap --session <nombre>` (o `overlap [slugs]`). Lista cada par de documentos que se tocan, ordenado por peso,
con cada cruce (ruta, endpoint, tabla, permiso, símbolo) y la **línea** en cada documento, más avisos
de migraciones en ambos y de ramas distintas sobre los mismos archivos. Los documentos `convertida` o
`descartada` no entran.

Sin cruces → dilo en una línea y termina.

## 2. Leer solo lo que se cruza

Para cada par, en un mensaje: `Read` de cada documento con `offset` = línea del cruce − 3 y `limit` ≈ 8,
juntando cruces cercanos en un solo rango. **Nunca el documento entero**: si un par tiene tantos cruces
que los rangos cubren casi todo, ese par es en realidad una sola funcionalidad (ver 3, *duplicación*).
El código solo se mira si una contradicción depende de cómo está hecho hoy (`outline` + rango, o `Grep`).

## 3. Clasificar cada cruce

| Clase | Señal | Qué se propone |
| --- | --- | --- |
| **contradicción** | mismo endpoint, tabla o regla con decisiones distintas (permiso, campos, rol mínimo, comportamiento) | elegir una; es decisión del usuario |
| **duplicación** | los dos planean construir lo mismo (mismo helper, mismo endpoint, misma tabla nueva) | quién lo hace; el otro lo reutiliza |
| **dependencia** | uno necesita lo que el otro crea (un modelo, un campo, un endpoint) | orden, o **una sola rama y PR** |
| **choque de merge** | ramas distintas sobre los mismos archivos, o dos migraciones | una sola rama y PR, o secuencia explícita |
| **compatible** | tocan lo mismo sin pisarse | nada; se anota que se revisó |

Por la directriz de PRs (cada merge a `main` corre el pipeline completo), ante *dependencia* o *choque
de merge* la recomendación por defecto es **juntar en una rama y un PR**, salvo que una tenga que llegar
antes a producción.

## 4. Decidir y registrar

- Muestra la tabla de cruces no compatibles (par · clase · qué · recomendación) y pregunta las
  contradicciones y la estrategia de ramas en **un** `AskUserQuestion` (máx. 4).
- Con las respuestas, agrega o actualiza en **cada** documento afectado, con `Edit`:

```markdown
## Coordinación
- con <otro-slug>: <clase> — <qué, en una línea> — <decisión o "pendiente"> (<fecha>)
```

  Si la decisión cambia el alcance de una tarea, aplica el modo actualización de `/pa-define-task`
  (tareas `- [-]` obsoletas, tareas nuevas, `gate`). Si dos planes se juntan, uno absorbe al otro y el
  absorbido queda `Estado: descartada (absorbida por <slug>)`, y se quita de la sesión
  (`session remove`).
- En la sesión, `## Coordinación` de su `session.md`: la estrategia acordada para el **grupo**, una línea
  por decisión (orden de las tareas, qué ramas se juntan, qué PR lleva qué). Los documentos guardan lo
  que les toca a cada uno; la sesión, lo que los une.
- Las notas de *Coordinación* que ya existan se respetan: solo se agrega lo nuevo o se actualiza lo que
  la decisión cambió.
- Cierre: cuántos cruces, cuántos requieren decisión, y la estrategia de ramas/PR acordada.

Vuelve a correr `overlap` después: los cruces resueltos siguen apareciendo (los documentos se siguen
tocando), pero cada uno ya tiene su línea en *Coordinación*.
