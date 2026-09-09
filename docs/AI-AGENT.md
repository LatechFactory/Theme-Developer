# Agente de IA que resuelve tickets — arquitectura

**Estado: Fase 1 HECHA y validada end-to-end. Fases 2 y 3 pendientes.**
Fase 1 (`agent-run.yml`, disparo manual con la tarea pegada) crea el theme,
el agente aplica el fix y el deploy sincrónico lo sube a Shopify — probado.
Los inputs `actor`/`shop` (Fase 2) y el self-check visual (Fase 3) siguen sin
implementar. Ver §12.1 (trampas de implementación) para lo que costó.

---

## 0. La idea

Alguien carga una tarea (al principio a mano; después desde Jira/Trello) y un
agente de IA la **resuelve de forma agéntica sobre el código del theme**,
apoyándose en los workflows que ya existen: crear un theme de trabajo y deployar
por commit. El resultado es un **preview** para que un humano revise.

Esto **no es un bolt-on**: es la tercera fuente que el diseño ya anticipaba
(`DESIGN.md §1`: el merchant, un developer, y **"un agente de código operando
sobre los archivos del repo"**). El sistema ya provee las "manos" (crear theme,
deployar, preview, merge) y las "barandas" (nunca live, push scopeado, publicar
manual). El agente es un **"developer efímero"** más.

**Trabajo del agente (estrecho):** convertir un ticket en **commits sobre una
branch de trabajo**. Nada más. No le habla a Shopify, no deploya, no publica —
de eso ya se encargan los workflows.

---

## 1. Pipeline

```
Tarea
  · Fase 1: workflow_dispatch a mano (pego título + descripción)
  · Fase 2: card de Jira/Trello → webhook → DO Function → repository_dispatch
  │
  ▼  agent-run.yml  (GitHub Actions)
  │    1. crea theme+branch        ← reusa new-theme.yml (born del live, invariante 3)
  │    2. corre el AGENTE sobre esa branch:
  │         contexto: CLAUDE.md + estructura del theme + texto del ticket
  │         tools: leer/editar archivos, grep, bash (shopify theme check)
  │         loop: entender → editar Liquid/CSS/schema → theme check → commit
  │    3. push de la branch
  │         └─→ push-on-commit.yml deploya el diff → PREVIEW LINK   (ya existe)
  │    4. (Fase 3) self-check visual: Playwright vs preview → screenshots
  │    5. (Fase 2) comenta en la card: preview + resumen + screenshots
  │
  ▼  Humano revisa el preview
       · OK    → merge-apply.yml (portar al destino) → publicar (manual)
       · cambios → re-corre el agente en la MISMA branch (iteración)
```

---

## 2. Fases

### Fase 1 — Opción A, disparo manual  *(el arranque)*
`agent-run.yml` con **`workflow_dispatch`** (pegás título + descripción del
ticket) que corre la **Claude Code GitHub Action** sobre una branch de trabajo.
Sin Jira/Trello todavía.

**Objetivo:** validar la **calidad** del agente aislada — "pego un ticket → sale
un preview" — antes de invertir en integraciones. En una tarde está andando.

### Fase 2 — Opción B (Agent SDK) + webhook  *(hacerlo bien controlado)*
Se reemplaza/complementa la Action por un **programa propio con el Claude Agent
SDK**, para ganar control: system prompt afinado, tools acotadas, ruteo de
modelo por tipo de ticket, guardrails custom, y el **post-back a Jira/Trello**
en el mismo script. Se suma el **webhook** (Jira o Trello → DO → `repository_dispatch`,
mismo patrón que el webhook de Shopify) y el **loop de iteración** por comentarios.

### Fase 3 — Self-check visual
El agente corre Playwright contra el preview, saca screenshots (desktop+mobile)
de los templates tocados y —como Claude es multimodal— se los pasa a sí mismo
para verificar antes de comentar. Cierra el hueco más grande del sistema
(`DESIGN.md §7.1`).

---

## 3. Opción A vs Opción B

| | Opción A — Claude Code Action | Opción B — Agent SDK |
|---|---|---|
| Qué es | Step pre-armado (`anthropics/claude-code-action`) | Librería (TS/Python) con la que escribís tu agente |
| Loop y tools | Resueltos | Los definís vos |
| Código | Mínimo (prompt + API key) | Un script (`agent.mjs`) |
| Control | Bajo | Alto (modelo por ticket, guardrails, post-back) |
| Cuándo | **Arrancar / validar (Fase 1)** | **Producción controlada (Fase 2)** |

Diseño clave: **el contrato no cambia entre A y B.** Ambas corren en el mismo
`agent-run.yml`, sobre una branch de `new-theme`, y terminan en un commit que
dispara `push-on-commit`. Migrar de A a B es cambiar el step del agente, no la
arquitectura. Por eso se puede arrancar con A sin pintarse a una esquina.

---

## 4. Anatomía de `agent-run.yml` (Fase 1, ilustrativo)

```yaml
name: agent-run
on:
  workflow_dispatch:                      # Fase 1: pegar el ticket a mano
    inputs:
      title:  { description: "Título del ticket", required: true }
      body:   { description: "Descripción / criterios", required: true }
  repository_dispatch:                    # Fase 2: lo dispara el webhook
    types: [ticket-ready]

permissions:
  contents: write                         # commitear/pushear. NADA de Shopify acá.

jobs:
  work:
    runs-on: ubuntu-latest
    steps:
      # (1) crear theme+branch → reusa la lógica de new-theme (born del live)
      #     new-theme.yml debe exponer workflow_call para poder reusarse.
      - uses: ./.github/workflows/new-theme.yml   # (reusable)

      # (2) el repo queda en la branch de trabajo
      - uses: actions/checkout@v5
        with: { ref: theme/<slug-del-ticket> }

      - run: npm i -g @shopify/cli         # para que el agente corra theme check

      # (3) el agente trabaja
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Resolvé este ticket editando el theme. Seguí CLAUDE.md.
            Título: ${{ inputs.title || github.event.client_payload.title }}
            Descripción: ${{ inputs.body || github.event.client_payload.body }}
            Corré `shopify theme check` antes de terminar. Commiteá y pusheá
            a esta branch.
      # el push del agente dispara push-on-commit → deploy → preview
```

*(Los nombres exactos de inputs de la Action se confirman contra su README al
implementar; acá van a título ilustrativo.)*

---

## 5. Cómo se apoya en los workflows existentes

- **Entrada — `new-theme.yml`:** da theme+branch nacido del live. El agente
  arranca con un delta limpio (invariante 3 intacto). *Pendiente:* agregarle
  `workflow_call` para poder reusarlo desde `agent-run`.
- **Salida — `push-on-commit.yml`:** el agente commitea/pushea a `theme/<branch>`;
  ese push dispara el deploy scopeado → preview. El agente **no deploya**.
- **Después — `merge-apply.yml`:** tras aprobación humana, porta el fix al destino.

El agente hace lo que haría un developer (commitear en su branch); el sistema
reacciona igual que reacciona a un developer. No hay que enseñarle a deployar.

---

## 6. Contexto y prompt del agente

- **`CLAUDE.md` del repo** ya es un brief operativo (convenciones, invariantes,
  trampas) y Claude Code lo lee solo. Gratis.
- **Falta un brief específico de "editar theme para resolver un ticket":** cómo
  es Liquid/Shopify, la estructura sections/blocks/templates, y las reglas de
  oro (ver §7). Puede vivir en una sección de CLAUDE.md o en un `AGENT-PROMPT.md`.
- **Entrada del ticket:** título, descripción, criterios de aceptación, y —si los
  hay— adjuntos/screenshots (Claude es multimodal).

**Reglas de oro para el prompt:**
1. Solo editar archivos de theme; quedarse en la branch.
2. Preferir Liquid/CSS/`settings_schema` (usando `default`) antes que tocar
   `settings_data.json` o `templates/*.json` (JSON generado por máquina; su
   merge se rige por la política B de `DESIGN.md §5`).
3. Correr `shopify theme check` y arreglar lo que marque antes de commitear.
4. Cambios acotados al ticket; no refactors amplios.
5. Nunca tocar el live ni publicar (además, no puede — ver §7).

---

## 7. Seguridad y guardrails

- **Las barandas ya existen:** aunque el agente se descarrile, **no escribe el
  live** (guard de rol), **no publica** (invariante 2), y el **push es scopeado**.
- **Aislamiento de token (frontera real):** el job del agente **no lleva el Theme
  Access token**. Solo edita archivos y commitea. El deploy lo hace
  `push-on-commit` en su propio job con el token → el agente **físicamente no
  puede** tocar Shopify.
- **Secrets del job del agente:** `ANTHROPIC_API_KEY` + el `GITHUB_TOKEN`
  automático. Nada más.
- **Límites:** tope de turnos/timeout y presupuesto de tokens por ticket. Señal
  de "necesito humano" si el agente no está seguro.
- **Humano en el loop:** el agente entrega preview + branch; merge y publicación
  quedan en manos humanas / workflows existentes.

---

## 8. Iteración y memoria

El runner es efímero: lo único que persiste es lo pusheado (los commits en la
branch). Cuando el reviewer pide un cambio, se re-corre el agente con checkout de
la **misma branch** → ve su trabajo previo y sigue. **La branch de git es la
memoria del agente entre corridas.**

En Fase 2 el disparo de la iteración es un comentario en la card (webhook); en
Fase 1, re-correr el `workflow_dispatch` apuntando a la branch existente.

---

## 9. Ticket → agente (Fase 2, detalle)

- **Webhook:** Jira o Trello → DO Function (verifica + traduce) → `repository_dispatch`.
  Mismo patrón que el webhook `themes/create`.
- **Gate:** una lista/label/estado ("🤖 AI-ready") define qué cards entran —
  análogo a la convención que filtraba adopciones.
- **Multi-store:** un campo/label en la card, o un board por tienda, mapea a
  `owner/repo` (igual que el mapa shop→repo de `EMBEDDED-UI.md §2`).
- **Post-back:** el agente comenta en la card el preview + resumen + screenshots
  (API de Jira/Trello; token en el DO Function o como secret).

**A decidir:** ¿Jira o Trello? (cambia webhook y post-back).

---

## 10. Modelo

Opus para tickets con lógica compleja; Sonnet para lo rutinario (copy, CSS,
ajustes chicos). Ruteo por label/complejidad; default Sonnet, escala a Opus.
El ruteo por modelo es una razón concreta para pasar a Opción B (SDK).

---

## 11. Riesgos y alcance

- **Techo de calidad:** arrancar con tickets **acotados y bien especificados**
  (estilo, copy, Liquid simple), no features complejas. Setear expectativas.
- **JSON:** el agente edita el archivo donde viva el cambio, sin trato especial
  por tipo (el contenido/copy del merchant vive en templates/*.json y
  settings_data.json). La política B cubre el riesgo en el merge (anotación +
  revisión visual).
- **El agente crea un theme por ticket** → acelera el tope de 20. **El reaper
  (etapa 6) es prerrequisito** para que el uso del agente sea sostenible.
- **Costo:** centavos a pocos dólares por ticket según complejidad; se acota con
  tope de turnos.

---

## 12. Orden de implementación

1. **Fase 1 — HECHA.** `new-theme` con `workflow_call`; `agent-run.yml`
   (`workflow_dispatch`, jobs `create` → `agent` → `deploy`) + Claude Code Action;
   `push-on-commit` convertido en reusable para el deploy sincrónico. Validado:
   ticket a mano → theme → fix aplicado → deploy a Shopify.
2. **Fase 2:** pasar el agente a Agent SDK (control + ruteo de modelo); webhook
   Jira/Trello → DO → `repository_dispatch`; post-back a la card; loop de iteración.
3. **Fase 3:** self-check visual (Playwright + screenshots).

**Prerrequisito transversal:** el **reaper** (evita que el agente ahogue el tope
de 20 themes).

### 12.1 Trampas de implementación (Fase 1) — no re-derivar

Costó una cadena de bloqueos, cada uno con el mismo síntoma genérico
(`is_error: true`) pero causa distinta:

- **Auth: el token es de suscripción, no API key.** Un `sk-ant-oat01-` (de
  `claude setup-token`) va en el input `claude_code_oauth_token`, NO en
  `anthropic_api_key`. Con el input equivocado: 0 uso, 0 costo, `is_error`.
- **Modelo: el default usa la ventana de 1M (`claude-opus-5[1m]`)**, un beta que
  la cuenta puede no tener → falla con 0 uso. Fijar el modelo:
  `claude_args: "--model claude-sonnet-5"`.
- **Escritura bloqueada en CI.** Sin aprobador interactivo, Claude Code bloquea
  toda escritura ("allowed working directories for this session"). Hay que pasar
  `--dangerously-skip-permissions` en `claude_args` (el runner es no-root, lo acepta).
- **El `GITHUB_TOKEN` no dispara otros workflows.** El push del agente con el
  token por defecto NO dispara `push-on-commit` → no deployaba. Solución: `deploy`
  como job reusable (`push-on-commit` con `workflow_call`), encadenado por `needs`.
  Bonus: deploy **sincrónico** (run verde = ya deployado).
- **Diagnóstico:** con `show_full_output: true` en la Action se ve lo que hace
  Claude (se saca después; es ruidoso y expone el output).

**Config que quedó funcionando** (en `agent-run.yml`, job `agent`):
`claude_code_oauth_token` + `claude_args: "--model claude-sonnet-5 --dangerously-skip-permissions"`,
y el deploy vía job reusable, no vía el evento push.
