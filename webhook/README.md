# Webhook themes/create → adopt-theme

Puente entre el webhook `themes/create` de Shopify y GitHub Actions. Cuando se
crea un theme en el admin, este endpoint dispara `adopt-theme.yml` vía
`repository_dispatch`, que lo da de alta con `origin: manual`.

Es necesario porque **un webhook de Shopify no puede pegarle directo a GitHub
Actions**: Actions no recibe POSTs arbitrarios. El endpoint hace de traductor
(verifica HMAC → dispara `repository_dispatch`).

`adopt-theme.yml` es idempotente por theme ID, así que reintentos del webhook o
el disparo por un theme ya registrado no duplican nada.

## Implementación (DigitalOcean Functions)

Archivos: `project.yml` + `packages/shopify/adopt/index.js`. El function corre en
modo `web: raw` para recibir el body crudo (necesario para verificar el HMAC).

### 1. Secrets locales

```bash
cd webhook
cp .env.example .env      # completar SHOPIFY_CLIENT_SECRET y GH_PAT (no se commitea)
```

- **`GH_PAT`** — token de GitHub, se usa solo para disparar `repository_dispatch`
  (no lo afecta la política de la org sobre PRs). PAT clásico con scope `repo`, o
  fine-grained con `Contents: Read and write` sobre `Theme-Developer`.
- **`SHOPIFY_CLIENT_SECRET`** — el **client secret** de la app (el mismo que usás
  para el client credentials grant). Shopify firma los webhooks de la app con él.
  Dev Dashboard → Apps → [tu app] → Settings → client secret.

### 2. Desplegar

```bash
doctl serverless deploy .
doctl serverless functions get shopify/adopt --url   # URL del endpoint
```

### 3. Registrar el webhook en Shopify

No hay un toggle de "activar": se crea una webhook subscription y desde ese
instante Shopify empieza a postear al endpoint. El topic `themes/create` **no**
está en el UI de Settings → Notifications, así que se registra por Admin API con
la app custom que tiene `read_themes` (el token que ya tenemos):

```bash
curl -X POST \
  "https://develop-latech.myshopify.com/admin/api/2026-07/webhooks.json" \
  -H "X-Shopify-Access-Token: <admin_api_token>" \
  -H "Content-Type: application/json" \
  -d '{"webhook":{"topic":"themes/create","address":"<URL_DEL_ENDPOINT>","format":"json"}}'
```

Respuesta `201` = quedó activo. La versión (`2026-07`) puede ser cualquiera
soportada; el topic existe hace años. `<URL_DEL_ENDPOINT>` es HTTPS (la URL de DO).

**El signing secret** (`SHOPIFY_CLIENT_SECRET`) es el **client secret** de la app
con la que se crea el webhook — el mismo que ya usás para obtener el access token
por client credentials. Shopify firma los webhooks de la app con ese secret
([doc oficial](https://shopify.dev/docs/apps/build/authentication-authorization/client-secrets)).
Está en Dev Dashboard → Apps → [tu app] → Settings (client ID + client secret).
Tiene que ser la **misma app** cuyo token usás en el POST; si mezclás apps, el
HMAC no matchea y el endpoint devuelve 401. (El token de Theme Access `shptka_...`
del resto del sistema no sirve para registrar webhooks; es solo de archivos de theme.)

**Verificar los webhooks registrados:**

```bash
curl "https://develop-latech.myshopify.com/admin/api/2026-07/webhooks.json" \
  -H "X-Shopify-Access-Token: <admin_api_token>"
```

Buscá tu `topic: themes/create` con el `address` correcto y anotá su `id`.

**Borrar / reemplazar un webhook** (con el `id` del listado):

```bash
curl -X DELETE \
  "https://develop-latech.myshopify.com/admin/api/2026-07/webhooks/<id>.json" \
  -H "X-Shopify-Access-Token: <admin_api_token>"
```

### 4. Probar

Duplicá un theme en el admin. Deberías ver:

1. El endpoint recibiendo el POST y devolviendo `ok` (`doctl serverless activations logs --follow`).
2. En Actions, una corrida de **adopt-theme** disparada por `repository_dispatch`.
3. En `themes.json`, la entrada nueva con `origin: manual`.

Para probar la adopción **sin** el webhook: Actions → **adopt-theme** → Run
workflow, pegando un theme ID. Es el mismo camino, disparado a mano.

## Notas

- **Adopta todos los themes sin filtro** (decisión de diseño). `adopt-theme.yml`
  saltea los ya registrados y el live; el resto entra. Cada duplicado exploratorio
  del merchant se adopta, lo que presiona el tope de 20 themes hasta que exista el
  reaper.
- El endpoint devuelve `200` aun si el `repository_dispatch` falla, para que
  Shopify no reintente en loop; el fallo queda en el log.
- Shopify espera respuesta en **~5s**; si el endpoint falla repetido, reintenta con
  backoff y termina **eliminando la suscripción** tras muchos fallos. Por eso el
  endpoint responde rápido y siempre `200`.
