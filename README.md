# portfolio-plugins

Respaldo privado de las herramientas de Claude Code para **PORTFOLIO-AUDIT** (UPC-ABET). En el
repositorio del proyecto son **solo locales**: están excluidas en `.git/info/exclude` y no se suben.
Este repositorio guarda una copia para no perderlas.

## Qué hay

```
portfolio-audit/            espejo de lo que va en la raíz de PORTFOLIO-AUDIT
├── CLAUDE.local.md         instrucciones del proyecto (producción, herramientas, economía de contexto)
└── .claude/
    ├── settings.local.json hooks, permisos, plugin claude-security
    ├── claude-security-guidance.md   modelo de amenazas del repo
    ├── rules/              reglas por paquete (backend, frontend), se cargan al tocar sus archivos
    ├── skills/pa-*/        /pa-define-task · /pa-quick · /pa-implement · /pa-audit · /pa-create-pr · /pa-module-doc
    └── pa/                 pa.mjs (trabajo mecánico), hooks, reglas (lib/), tests, modules.json,
                            debt-baseline.json, ledger/ — ver portfolio-audit/.claude/pa/README.md
restore.mjs                 reinstala en un checkout
sync.mjs                    actualiza este respaldo desde un checkout
```

No se respalda `.claude/pa/work/` (planes por rama y resultados de backtest de cada máquina).

## Restaurar (checkout nuevo o máquina nueva)

```bash
git clone https://github.com/UPC-ABET/PORTFOLIO-AUDIT.git
node restore.mjs ../PORTFOLIO-AUDIT
```

Copia los archivos, agrega la exclusión local de git y no pisa archivos distintos sin `--force`.
Después, abrir una sesión nueva de Claude Code en el checkout. Requisitos: Node 20+ y git; para el
plugin `claude-security`, Python 3.9+ e instalarlo una vez (`/plugin install claude-security@claude-plugins-official`).

## Guardar cambios

```bash
node sync.mjs D:/UPC/ABET/PORTFOLIO-AUDIT
git diff --stat
git add -A && git commit -m "..."
```

`sync.mjs` deja `portfolio-audit/` como espejo exacto del checkout (agrega, actualiza y borra).
