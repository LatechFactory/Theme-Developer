# UI embebida en el admin de Shopify — arquitectura

**Estado: propuesta de diseño. NADA de esto está implementado todavía.**
Este documento describe el control plane (UI) para operar el sistema de merge.
No modifica los workflows ni el diseño ya existentes (`DESIGN.md`); los cambios
que menciona sobre los workflows (inputs `actor`/`shop`) son **pendientes**, no
aplicados.

---

## 0. Por qué embebida (y no una página standalone)

Decidido tras evaluar ambas. Embeber en el admin de Shopify gana por tres
razones propias de este caso:

- **Multi-store sin cruces.** Una página standalone con todas las tiendas
  mezcladas es propensa a operar la tienda equivocada. El admin da aislamiento
  por tienda gratis: la app corre en el contexto de *esa* tienda.
- **Auth de usuario nativa.** El session token identifica al usuario del admin
  sin construir un login. Habilita el log por usuario (§8), imposible con un
  password compartido.
- **Audiencia.** Quien edita themes ya tiene admin del merchant; que el merchant
  pueda operar no es un problema, es deseable.

El costo (maquinaria de app embebida) se justifica porque **compra** el
aislamiento y la identidad de usuario. Para un tool puramente interno no valdría
la pena; para este escenario sí.

---

## 1. Componentes y flujo general

```
┌────────────────────────────────────────────────────────────┐
│  Shopify Admin de la tienda X  (iframe)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Frontend embebido — App Bridge + Polaris            │   │
│  │  · dropdowns con los themes de ESTA tienda           │   │
│  │  · botón Merge / Adoptar / (Cerrar)                  │   │
│  └───────────────┬──────────────────────────────────────┘   │
└──────────────────┼───────────────────────────────────────────┘
                   │  session token (JWT) en cada request
                   ▼
┌────────────────────────────────────────────────────────────┐
│  Backend de la app  (DO App Platform, siempre on)            │
│  · sirve el HTML embebible (CSP frame-ancestors)             │
│  · verifica el session token (firma con client secret)       │
│  · token exchange → access token de la Admin API             │
│  · resuelve shop → repo                                       │
│  · dispara workflow_dispatch con { actor, shop, ... }        │
│  Config: client secret · GitHub token · mapa shop→repo       │
└──────┬───────────────────────────────────┬──────────────────┘
       │ (Admin API de la tienda)          │ (GitHub API)
       ▼                                   ▼
┌────────────────┐              ┌──────────────────────────────┐
│ Shopify        │              │ GitHub (repo de la tienda X)  │
│ theme list +   │              │ · contents API → themes.json  │
│ roles          │              │ · workflow_dispatch           │
└────────────────┘              │ · Actions run = LOG auditoría │
                                └──────────────┬────────────────┘
                                               ▼
                                ┌──────────────────────────────┐
                                │ Workflows (sin cambios core)  │
                                │ merge-apply / adopt / ...     │
                                │ (Theme Access token)          │
                                └──────────────────────────────┘
```

Invariante de aislamiento: **la tienda sale del session token (`dest`), nunca de
un input del browser.** El usuario no puede operar otra tienda que la de su admin.

---

## 2. Mapeo tienda → repo

Config en el backend (env var o JSON):

```json
{
  "develop-latech.myshopify.com": "LatechFactory/Theme-Developer",
  "clienteA.myshopify.com":       "LatechFactory/clienteA-theme"
}
```

Toda acción resuelve el repo desde `dest`. Único punto donde se decide "sobre qué
tienda trabajo", y no lo controla el cliente. Esto elimina los errores cruzados.

---

## 3. Los tokens — cada uno su trabajo

| Token | Quién lo tiene | Para qué |
|---|---|---|
| **Session token** (JWT App Bridge) | Frontend → backend, por request | Identifica **usuario + tienda**. Base de auth y del log. |
| **Admin API access token** (por tienda) | Backend, vía *token exchange* | Listar themes/roles de esa tienda. |
| **GitHub token** (PAT o GitHub App) | Backend | `workflow_dispatch` + leer `themes.json`. |
| **Theme Access token** (`shptka_`) | Los workflows | Escribir archivos de theme. **No cambia.** |

---

## 4. Auth — versión moderna (menos maquinaria)

En vez del OAuth redirect clásico + guardar tokens por tienda:

- **Managed installation:** Shopify maneja el consentimiento/scopes. No se escribe
  flujo de install/callback.
- **Session token + token exchange:** App Bridge da el session token en el
  browser; el backend lo **verifica** (firma con el client secret, `aud`, `exp`)
  y lo **cambia** por un access token de la Admin API cuando lo necesita. Sin
  redirects, sin almacenar offline tokens.

Lo único obligatorio a codear es la **verificación del session token** (middleware
JWT). El resto lo cubre la plataforma.

---

## 5. Endpoints del backend

| Endpoint | Qué hace |
|---|---|
| `GET /` | Sirve el HTML embebible (con App Bridge). |
| `GET /api/themes` | Estado de la tienda: cruza `themes.json` (GitHub) + `theme list` (Shopify) → `[{id,title,branch,role,status}]`. |
| `POST /api/merge` | Valida y dispara `merge-apply` con `{origen, destino, actor, shop}`. |
| `POST /api/adopt` | Dispara `adopt-theme` (alta manual explícita). |
| `POST /api/close` *(futuro)* | Marca `status: closed` (compañero del reaper). |

Todos exigen session token válido; todos resuelven el repo desde `dest`.

---

## 6. Flujos

**Listar themes**
1. browser → `GET /api/themes` + session token
2. backend verifica → `shop = dest`, resuelve `repo`
3. lee `themes.json` (GitHub contents API) + `shopify theme list` (token de la tienda)
4. cruza y devuelve la lista
5. front puebla dropdowns: muestra `title`, value = **ID**; excluye el live como
   destino y los `closed`

**Disparar un merge**
1. usuario elige X y A → `POST /api/merge {origen, destino}` + session token
2. backend verifica → `actor = sub`, `shop = dest`
3. resuelve repo y **valida que X y A estén en el `themes.json` de esa tienda**
4. `workflow_dispatch` a `merge-apply` con `{origen, destino, actor, shop}`
5. devuelve el link a la run
6. la run queda como registro auditable

---

## 7. Cambios pendientes en los workflows (NO aplicados)

Agregar a `merge-apply` / `adopt-theme` dos inputs opcionales: **`actor`** y
**`shop`**. Se registran en el step summary y (opcional) se appendean a un
`audit.log` o al historial de `themes.json`. **La lógica core no se toca** — los
workflows siguen aceptando IDs y andando headless. Se implementa recién cuando se
construya la UI.

---

## 8. Log de auditoría

- **Fuente barata:** la propia run de Actions ya guarda inputs (`actor`, `shop`,
  `origen`, `destino`), timestamp y resultado. Eso *ya es* un log por usuario.
- **Enriquecido:** un `audit.log` commiteado por el workflow, o historial en
  `themes.json`.
- **Nombre del usuario:** el `sub` (ID) viene siempre; el nombre legible solo en
  tiendas **Plus** (Users API). En no-Plus se registra el ID.

---

## 9. GitHub: PAT vs GitHub App

- **Arrancar con un PAT** (repo + `actions:write`) — simple.
- **Escalar a GitHub App** instalada en la org: tokens por-repo, no cuelga de una
  cuenta personal, acciones figuran como la app (mejor auditoría). Destino natural
  para un control plane multi-repo.

---

## 10. Seguridad (no negociable)

1. **Verificar el session token siempre** server-side (firma + `aud` + `exp`).
2. **Repo derivado de `dest`**, nunca de un input → cero cruces de tienda.
3. **Validar** que los theme IDs pertenecen a la tienda antes de disparar.
4. GitHub token con el mínimo alcance (los repos del sistema).

---

## 11. Orden de implementación

1. Reconfigurar la app como **embedded** (Dev Dashboard: embedded on, app URL,
   scopes `read_themes`).
2. Backend mínimo: verificación de session token + `GET /api/themes` (token
   exchange).
3. Frontend mínimo: App Bridge + un dropdown que liste themes.
4. `POST /api/merge` → `workflow_dispatch` con `actor`/`shop`.
5. Inputs de auditoría en los workflows + `audit.log`.
6. Botones para el resto (adopt, close).
7. Multi-store: cargar el mapa e instalar la app en cada tienda.

---

## 12. Fuera de alcance / decisiones abiertas

- **Nombre de usuario en no-Plus:** queda el ID; resolver a nombre requiere Plus o
  un mapeo manual.
- **Persistencia del mapa shop→repo:** arranca como config; si crece, un store.
- **Quién puede disparar qué:** por ahora cualquier usuario del admin de la tienda.
  Si hace falta granularidad (ej. solo ciertos roles mergean), se evalúa después.
