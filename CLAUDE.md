# theme-merge

Sistema para sincronizar y mergear cambios de themes de Shopify entre tres
fuentes: el theme editor del admin, un IDE, y agentes de código.

Repo: `LatechFactory/Theme-Developer`
Tienda de desarrollo: `develop-latech.myshopify.com`

El diseño completo está en `docs/DESIGN.md`. Este archivo es el contexto
operativo: estado actual, convenciones y trampas ya descubiertas.

---

## Estado

| Etapa | Estado |
|---|---|
| 0 — Credenciales y CLI en Actions | Hecho |
| 1 — `mirror.yml`, espejo diario del live | Hecho |
| 2 — `new-theme.yml`, alta de theme | Hecho |
| 3 — `push-on-commit.yml`, deploy + guard de rol | Hecho, guard validado en Actions |
| 4a — Merge dry run (`merge.yml`) | Hecho, validado en Actions |
| 4b — Merge apply (`merge-apply.yml`, política B) | Hecho, sin probar en Actions |
| 5 — Gate de JSON | Absorbido en 4b como anotación (política B) |
| 6 — Reaper | **Siguiente** |

**Guard de rol validado:** se publicó un theme a propósito y `push-on-commit`
abortó en "Verificar que no sea el live" con `rol 'live'` → exit 1, saltando
push y `last_push`. La lista blanca (`role == "unpublished"`) funciona.

**4a validado:** dry run `191025840442` → `191028625722` dio merge limpio,
trajo `templates/index.json` y lo marcó como JSON a revisar.

**Pendiente inmediato:** probar `merge-apply.yml` en los dos caminos —
(a) merge limpio: verificar push al destino, preview link y anotación de
`settings_data.json`; (b) conflicto de git: verificar que abre PR y **no**
pushea a Shopify.

---

## Autenticación

Se usa un token de **Theme Access** (`shptka_...`), no una custom app.

- Secret: `SHOPIFY_THEME_TOKEN`
- Variable: `SHOP_DOMAIN` = `develop-latech.myshopify.com`

En los workflows va a nivel de job:

```yaml
env:
  SHOPIFY_CLI_THEME_TOKEN: ${{ secrets.SHOPIFY_THEME_TOKEN }}
  SHOPIFY_FLAG_STORE: ${{ vars.SHOP_DOMAIN }}
```

Con `SHOPIFY_FLAG_STORE` seteado no hace falta pasar `--store` en cada comando.

### No usar tokens de custom app

Se intentó con client credentials grant (`shpua_...`) y **no funciona para
escribir archivos de theme**. Falla con:

```
Access denied for themeFilesUpsert field. Required access: The user needs
write_themes and an exemption from Shopify to modify theme files.
```

Shopify restringe la escritura de archivos de theme por API más allá del
scope; hace falta una exención que solo se otorga a apps publicadas en la
App Store. Theme Access es la app de primera parte que ya tiene esa
exención — sus llamadas van por `theme-kit-access.shopifyapps.com`.

Localmente el CLI sí funciona sin Theme Access porque autentica como
usuario (sesión de browser), y la restricción aplica a apps, no a personas.
Por eso "anda en mi máquina y no en CI".

---

## Hechos verificados del CLI

Cosas que costaron intentos. No re-derivar.

**Crear un theme con nombre:**
```bash
shopify theme push --unpublished --json --theme "NOMBRE" --path .
```
Con `--unpublished` sin `--development`, el nombre se pasa en `--theme`.
No existe `--theme-name`. El ID sale de `.theme.id` del JSON.

**Roles:** `shopify theme list --json` devuelve `"role": "live"` para el
publicado y `"unpublished"` para el resto.

**El `id` es numérico**, no string. En jq usar `--argjson`, no `--arg`:
```bash
jq -r --argjson id "$THEME_ID" '.[] | select(.id == $id) | .role'
```
Con `--arg` la comparación nunca matchea, `ROLE` queda vacío, y un guard
mal escrito deja pasar el push. Es el modo de falla peligroso.

**Flags útiles no usados todavía:** `push --strict` bloquea el push si
Theme Check encuentra errores (candidato para la etapa 5).

---

## Convenciones

**Branches:** `theme/<slug>`. Una por theme del sistema.

**`themes.json`:** vive solo en `main`. Es el registro maestro, mapeo por
theme ID.

```json
{
  "190991302970": {
    "branch": "theme/testnewtheme",
    "title": "1234 - testnewtheme",
    "ticket": "1234",
    "origin": "sistema",
    "created": "2026-08-31",
    "last_push": "2026-08-31T14:02:00Z",
    "status": "open"
  }
}
```

**Grupo de concurrencia `registry`** en todo workflow que escriba en `main`,
para serializar las escrituras a `themes.json`.

**`permissions: contents: write`** en todo workflow que pushee a git.

---

## Trampas de GitHub Actions ya encontradas

**Los workflows con trigger `push` se leen de la rama pusheada**, no de
`main`. Una branch creada antes de que existiera `push-on-commit.yml` no lo
tiene y no dispara nada — ni siquiera un job fallido. Tras modificar un
workflow, mergear `main` a las branches abiertas.

(Los triggers `schedule` sí se leen solo de la rama default.)

**Leer `themes.json` desde una branch requiere ir a `main`:**
```bash
git show origin/main:themes.json > /tmp/registry.json
```
La branch se crea antes de que se escriba la entrada del registro, así que
su copia local nunca la tiene.

**`git pull --rebase` antes de cada push a `main`**, porque `mirror.yml`
puede haber commiteado durante el job.

**La org bloquea que Actions cree PRs.** El `GITHUB_TOKEN` no puede correr
`gh pr create` (da 403) porque `LatechFactory` fuerza "Read repository
contents" y desactiva "Allow GitHub Actions to create and approve pull
requests" a nivel org — el repo lo ve grisado, no lo puede cambiar. Por eso
`merge-apply.yml` en el camino de conflicto **no crea el PR**: pushea las
branches y entrega un link de `compare` para abrirlo con un click. Para
auto-PR habría que habilitarlo en la org, o usar un PAT/App token como secret.

---

## Invariantes del diseño

No romper sin discutirlo primero. La justificación está en `docs/DESIGN.md`.

1. **Nunca escribir sobre el theme live.** El guard de rol se consulta
   inmediatamente antes de cada push, no al iniciar la operación. Usa lista
   blanca (`role == "unpublished"`), no lista negra: cualquier valor
   inesperado debe abortar.

2. **Publicar es manual.** Lo hace una persona desde el admin. El sistema
   nunca publica.

3. **Toda branch nace de un pull del theme live.** Eso garantiza que el diff
   de la branch sea el delta del fix, portable a cualquier theme destino.

4. **Push siempre scopeado** con `--only` a los archivos del diff. Nunca el
   theme completo.

5. **Antes de un merge se pullean AMBOS themes**, origen y destino. El del
   origen trae trabajo hecho por el theme editor (imágenes, settings) que es
   parte del fix; el del destino captura el drift del merchant.

6. **El mapeo branch ↔ theme es por ID**, nunca por nombre. Los títulos se
   renombran desde el admin.

---

## Reglas para archivos JSON (política B, etapa 5)

Revisada. **El único caso que escala a un developer es el conflicto de git.**
Un merge limpio se pushea al theme destino (sin publicar) y se verifica
**visualmente contra el preview** — lo puede hacer cualquiera, no un developer.
Es seguro porque el sistema nunca publica (invariante 2).

Los diffs JSON destructivos no bloquean: se **anotan** para orientar la
revisión visual.

| Archivo | Tratamiento |
|---|---|
| `config/settings_schema.json` | Es código. Merge normal. |
| `config/settings_data.json`, diff **aditivo** | Push automático |
| `config/settings_data.json`, modifica/elimina claves | Push automático **+ anotación** de las claves tocadas |
| `templates/*.json`, `sections/*.json` | Push automático; se listan como cambio estructural a mirar en el preview |
| Cualquier archivo con **conflicto de git** | Único caso que escala a developer (PR) |

Para shippear un setting nuevo alcanza con mergear `settings_schema.json`:
Shopify usa el `default` declarado cuando la clave no existe en
`settings_data.json`.

Detalle completo y justificación en `docs/DESIGN.md §5`.

---

## Límites conocidos

- **No hay verificación visual.** El sistema valida transporte y control de
  cambios, no que la página se vea bien. Pendiente: Playwright contra el
  preview link.
- **Máximo 20 themes por tienda.** Sin el reaper (etapa 6), el sistema se
  bloquea solo.
- **Fuera de alcance:** app embeds, theme app extensions, metafields y
  metaobjects. Un fix que dependa de eso necesita coordinación manual.

---

## Cómo trabajar en este repo

- Cambios de lógica van en los workflows de `.github/workflows/`.
- Probar siempre en `develop-latech`, nunca en una tienda con ventas.
- Los archivos del theme en la raíz (`assets/`, `sections/`, etc.) son el
  espejo del live y los escribe `mirror.yml`. No editarlos a mano en `main`.
- Al terminar una etapa, actualizar la tabla de Estado de este archivo.
