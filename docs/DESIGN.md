# Sistematización de modificaciones sobre themes de Shopify

Documento de diseño. Última revisión: 2026-09-02 (v3).

> v3 sincroniza este documento con lo ya implementado en los workflows y con
> los hechos operativos de `CLAUDE.md`: autenticación por Theme Access token
> (no custom app), valor real del `role` del theme live (`live`, no `main`),
> guard por lista blanca, lógica inline en los workflows (sin `scripts/`), e
> inclusión del directorio `blocks/`.

---

## 1. Problema

En una tienda Shopify conviven tres fuentes de cambio sobre un mismo theme:

1. **El merchant**, desde el theme editor del admin (settings, orden de secciones, contenido, imágenes).
2. **Un developer**, editando archivos del theme en un IDE.
3. **Un agente de código**, operando sobre los archivos del repo.

Hoy esas tres fuentes no tienen un punto de encuentro. No hay historial común, no hay forma de saber quién cambió qué, y cualquier deploy de código corre el riesgo de pisar configuración que el merchant hizo por la interfaz.

El sistema debe permitir que los cambios de las tres fuentes convivan, se versionen, y se combinen de forma controlada y auditable.

---

## 2. Decisiones de diseño

### 2.1 No se usa la integración nativa de Shopify–GitHub

Shopify ofrece una integración oficial que sincroniza bidireccionalmente una branch con un theme. Se evaluó y se descartó.

**Razón:** ata cada branch a un theme de forma fija y no provee orquestación multi-theme ni control sobre la operación de merge, que es exactamente el valor que este sistema aporta.

### 2.2 La branch no necesita estar sincronizada permanentemente

Una branch puede divergir de su theme entre operaciones. Solo tiene que estar actualizada **en el momento del merge**, que es cuando git necesita una base y un destino correctos.

Esto simplifica el sistema: no hace falta escuchar cada guardado del theme editor.

### 2.3 Toda branch nace de un pull del theme live

Es el invariante central del sistema.

Fijar el live como punto de partida garantiza que el diff de la branch contra su base sea **el delta del trabajo**, y no incluya diferencias preexistentes del theme donde se trabajó. Eso es lo que hace que un fix sea portable a cualquier theme destino.

### 2.4 Nunca se escribe sobre el theme live

Todo push va a un theme sin publicar. La publicación es siempre un acto manual del usuario desde el admin de Shopify.

**Razón:** publicar es un intercambio de rol — instantáneo y reversible con un click. Sobrescribir archivos del theme live no tiene vuelta atrás.

### 2.5 El mapeo entre branch y theme es por ID

Los títulos de theme se renombran desde el admin; los IDs son estables. El vínculo autoritativo vive en `themes.json` (§3.2), no en el nombre de la branch.

Los nombres de branch y las etiquetas de la interfaz son descriptivos, para humanos.

---

## 3. Estructura

### 3.1 Repositorio

Un repo de GitHub por tienda.

```
tienda-theme/
├── .github/workflows/
│   ├── mirror.yml           # cron diario: espejo del theme live      [hecho]
│   ├── new-theme.yml        # alta de theme en el sistema             [hecho]
│   ├── push-on-commit.yml   # deploy de branch a su theme             [hecho]
│   ├── merge.yml            # operación de merge                  [pendiente]
│   └── reaper.yml           # limpieza de themes y branches       [pendiente]
├── themes.json              # registro del sistema
└── assets/ blocks/ config/ layout/ locales/ sections/ snippets/ templates/
```

La lógica de apoyo (cliente de la API, resolución de roles e IDs, lectura y
escritura de `themes.json`, y a futuro el gate de JSON) va **inline en cada
workflow** con `jq` y bash, no en un directorio `scripts/` separado. Se
prefirió mantener cada workflow autocontenido mientras la lógica sea acotada;
si crece, se puede extraer a `scripts/`.

`blocks/` (theme blocks de Online Store 2.0) es parte del theme y del alcance
de los pushes, igual que el resto de los directorios de tema.

### 3.2 Registro de themes (`themes.json`)

Commiteado en `main`. Es la fuente de verdad del sistema.

```json
{
  "184729301": {
    "branch": "theme/cart-drawer-fix",
    "title": "GYM-142 · cart-qty",
    "ticket": "GYM-142",
    "origin": "sistema",
    "created": "2026-08-20",
    "last_push": "2026-08-27T14:02:00Z",
    "status": "open"
  }
}
```

`origin` es `sistema` o `manual`, a título informativo. No cambia el tratamiento: ambos casos se comportan igual.

Se prefiere este registro por sobre codificar el ID en el nombre de la branch porque:

- Guarda metadata que un nombre no puede (fechas, estado, ticket asociado).
- Permite consultas del reaper sin llamar a APIs externas por cada branch.
- Deja los nombres de branch libres para ser descriptivos.
- Tiene historial en git.

**Contrapartida:** es estado mutable en git. Las escrituras deben serializarse (§6.3).

### 3.3 Branches

| Branch | Rol |
|---|---|
| `main` | Espejo del theme live. Solo escribe el cron. |
| `theme/<descripcion>` | Corresponde a un theme del sistema. |

---

## 4. Flujos

### 4.1 Espejo del theme live

**Disparador:** cron diario.

1. `shopify theme pull --live`
2. Si hay diferencias, commit a `main`.

Es backup y auditoría. **Ninguna operación del sistema depende de este flujo**: cada alta hace su propio pull del live en el momento.

### 4.2 Alta de un theme en el sistema

Dos caminos que convergen en la misma estructura. En ambos, la branch nace de un pull del live.

**Alta por sistema** — se quiere arreglar o desarrollar algo:

1. `shopify theme pull --live`, commit sobre `main`.
2. Crear la branch desde ese commit.
3. Crear el theme sin publicar a partir de la branch, con nombre según convención.
4. Registrar en `themes.json` con `origin: sistema`.

**Alta manual** — un admin duplicó un theme desde el panel y va a trabajar ahí:

1. Se detecta el theme por webhook `themes/create` o alta explícita, filtrando por convención de nombre.
2. `shopify theme pull --live`, commit sobre `main`.
3. Crear la branch desde ese commit.
4. Registrar en `themes.json` con `origin: manual`.

En el caso manual **no se hace ningún pull del theme ni se commitea nada más**. La branch queda fijada en el estado del live y no se toca hasta el merge.

> La convención de nombre (ej. `GYM-*`) es la que evita que cada duplicado exploratorio del merchant entre al sistema.

### 4.3 Cambios y deploy

Los cambios sobre la branch —desde un IDE o desde un agente— disparan deploy.

**Disparador:** commit sobre una branch registrada.

1. Se resuelve el theme ID desde `themes.json`.
2. Se consulta el `role` del theme (`shopify theme list --json`). **Se
   aborta salvo que sea `unpublished`** (lista blanca; ver §6.1).
3. `shopify theme push --theme <id> --only <archivos del diff>`
4. Se compone el preview link: `https://<tienda>.myshopify.com/?preview_theme_id=<id>`
5. Se actualiza `last_push` en el registro.

El push es siempre scopeado a los archivos modificados. Nunca se sube el theme completo.

Los cambios hechos desde el theme editor **no** disparan este flujo. Se incorporan en el merge (§4.4).

### 4.4 Merge

**Disparador:** solicitud del usuario, eligiendo theme origen (X) y theme destino (A) del listado.

1. Se listan los themes de la tienda con su rol. El live queda excluido como destino.
2. **`shopify theme pull` de ambos themes** sobre sus respectivas branches, con commit en cada una.
   - El pull de X trae todo lo que difiere del live: el trabajo hecho por editor (imágenes, settings, contenido) además de lo ya deployado. Ese es el delta del fix.
   - El pull de A captura el drift del merchant en el destino, y es lo que hace correcto el three-way merge.
3. `git merge branch-X` sobre `branch-A`.
4. **Si hay conflicto:** se abre un PR en GitHub y el flujo termina. Resolución manual.
5. **Si no hay conflicto:** se corre el gate de JSON (§5). Si requiere revisión, se abre PR.
6. Se consulta el `role` de theme A **inmediatamente antes del push**. Se aborta salvo que sea `unpublished` (§6.1).
7. `shopify theme push --theme <A> --only <archivos del merge>`

### 4.5 Publicación

Fuera del sistema. El usuario publica desde el admin de Shopify cuando lo considera verificado.

### 4.6 Reaper

**Disparador:** cron diario.

Cierra branches y borra themes de entradas con `status: closed` y antigüedad mayor a N días.

**Necesario, no opcional:** Shopify limita a 20 themes por tienda. Sin limpieza, el sistema se bloquea solo.

---

## 5. Tratamiento de archivos JSON

El JSON de configuración es generado por máquina, con anidamiento profundo e IDs autogenerados. Git lo mergea por línea, lo cual produce dos riesgos: conflictos ilegibles, y —peor— merges automáticos sintácticamente válidos pero semánticamente rotos.

La regla es por **forma del diff**, no por nombre de archivo.

| Archivo | Tratamiento |
|---|---|
| `config/settings_schema.json` | Es código. Define qué settings existen. Se mergea normalmente. |
| `config/settings_data.json` — diff solo aditivo | Pasa automático. Claves nuevas, ninguna existente modificada ni eliminada. |
| `config/settings_data.json` — modifica o elimina claves | **Revisión manual obligatoria.** Pisa decisiones del merchant. |
| `templates/*.json` | **Revisión manual obligatoria.** |
| `sections/*.json` (section groups) | **Revisión manual obligatoria.** |

### Nota sobre settings

Para shippear un setting nuevo alcanza con mergear `settings_schema.json`: Shopify usa el `default` declarado cuando la clave no existe en `settings_data.json`.

Tocar `settings_data.json` solo es necesario cuando el feature requiere un valor concreto distinto del default, o cuando se quiere dejar precargada una configuración. Ese caso es legítimo y lo cubre la regla aditiva.

Un diff que **modifica** claves existentes casi siempre es contaminación de un pull, no una intención. De ahí la revisión.

---

## 6. Reglas de seguridad

### 6.1 Verificación de rol antes de cada push

Cada theme tiene un campo `role`. Vía `shopify theme list --json`, el theme
publicado devuelve `role: "live"` y el resto `role: "unpublished"`.

El guard es por **lista blanca**: antes de cualquier push el sistema consulta
el rol del theme destino y **aborta salvo que sea exactamente `unpublished`**.
Cualquier otro valor —`live`, vacío por un error de la consulta, o un rol
inesperado— aborta. Una lista negra contra `"live"` sería frágil: un cambio en
el string devuelto por el CLI, o una consulta que falla y deja el rol vacío,
dejaría pasar el push.

**La consulta se hace inmediatamente antes del push**, no cuando se solicitó la operación. Entre la solicitud de merge y su ejecución pueden pasar minutos, y en ese lapso alguien puede publicar ese theme desde el admin. Verificar al solicitar convierte la garantía en una intención.

> Nota de implementación: el ID de theme se compara contra `.id` (numérico) de
> la salida del CLI con `jq --argjson`, no `--arg`. Con `--arg` la comparación
> nunca matchea, el rol queda vacío y el guard dejaría pasar el push. Es el
> modo de falla peligroso.

### 6.2 Autenticación y alcance del token

Se usa un **token de Theme Access** (`shptka_...`), no una custom app. Va en
GitHub como secret `SHOPIFY_THEME_TOKEN` y se expone al CLI como
`SHOPIFY_CLI_THEME_TOKEN`; el dominio de la tienda va en la variable
`SHOP_DOMAIN` → `SHOPIFY_FLAG_STORE`. Theme Access solo da acceso a archivos
de theme: ningún acceso a productos, pedidos ni clientes.

**Por qué no custom app.** Se probó con client credentials grant (`shpua_...`)
y **no sirve para escribir archivos de theme**: falla con `Access denied for
themeFilesUpsert field`. Shopify restringe la escritura de archivos de theme
por API más allá del scope `write_themes`; hace falta una exención que solo se
otorga a apps publicadas en la App Store. Theme Access es la app de primera
parte que ya tiene esa exención (sus llamadas van por
`theme-kit-access.shopifyapps.com`). Localmente el CLI funciona sin Theme
Access porque autentica como usuario (sesión de browser), y la restricción
aplica a apps, no a personas — de ahí el "anda en mi máquina y no en CI".

### 6.3 Concurrencia

Todo workflow que escriba en `main` (y por lo tanto en `themes.json`) usa el
grupo de concurrencia `registry` con `cancel-in-progress: false`, para
serializar las escrituras al registro. Lo aplican `mirror.yml`,
`new-theme.yml` y `push-on-commit.yml`.

Además, antes de cada push a `main` se hace `git pull --rebase`, porque
`mirror.yml` puede haber commiteado durante el job.

### 6.4 Push siempre scopeado

`--only` con los archivos del diff. Cierra la ventana entre el pull y el push, en la que el merchant podría haber tocado algo.

### 6.5 Secretos

Tokens de Shopify y credenciales en GitHub Secrets. Nunca en archivos del repo.

---

## 7. Limitaciones y cosas para refinar

### 7.1 No hay verificación visual

**La limitación más importante.** El sistema valida transporte y control de cambios. No valida que la página se vea bien.

Git detecta conflictos textuales. No dice si el resultado combinado —el Liquid modificado por el fix más los settings que tocó el merchant— renderiza correctamente.

*Refinamiento posible:* Playwright contra el preview link, con screenshots de los templates afectados en desktop y mobile, comparados contra los mismos del theme destino antes del merge. No da veredicto automático confiable, pero deja dos imágenes lado a lado que una persona evalúa en segundos.

### 7.2 El delta de un theme duplicado no es solo el fix

En el alta manual, el admin puede haber duplicado un theme que ya difería del live. En ese caso el pull del merge trae **todo lo que distingue a ese theme del live**, no solo el trabajo nuevo.

Consecuencias según el destino:

- **Destino cercano al live:** correcto, es exactamente lo que hay que traer.
- **Destino divergente:** git marca conflicto en esos archivos y el PR queda abierto.

O sea, el sistema es preciso cuando el theme duplicado venía del live, y conservador cuando no. Un merge desde un theme muy divergente va a pedir intervención humana, y eso es el diseño funcionando, no fallando. Conviene que quien lo use lo sepa de antemano.

### 7.3 El merge semántico de JSON no es verificable automáticamente

El gate de §5 detecta la **forma** del diff, no su corrección. Un merge aditivo puede igualmente producir un estado inválido (por ejemplo, una sección que referencia un block ID inexistente en la otra rama).

*Refinamiento posible:* validación estructural post-merge que verifique integridad referencial entre `settings_data.json` y los templates. Requiere modelar la estructura del theme; no es trivial.

### 7.4 El drift entre merges no queda registrado

Decisión consciente (§2.2). El costo es que no hay traza de *cuándo* el merchant cambió algo en un theme que no sea el live, solo el estado final al momento del pull.

Si en algún momento hace falta esa traza para debugging o auditoría, la alternativa es un pull periódico de todos los themes registrados, no solo del live.

### 7.5 Ventana de carrera residual

Entre el pull y el push del merge hay segundos en los que el merchant podría guardar algo. El push scopeado la reduce a los archivos tocados por el merge, pero no la elimina.

*Refinamiento posible:* comparar el checksum del theme antes del push contra el del pull y abortar si cambió. Agrega una llamada a la API por operación.

### 7.6 `themes.json` es estado mutable en git

Dos jobs escribiendo simultáneamente se pisan. El grupo de concurrencia lo mitiga pero no lo elimina del todo si en algún momento hay disparadores fuera de Actions.

*Refinamiento posible:* mover el registro a un store externo con escrituras atómicas. Agrega infraestructura; probablemente no se justifica al volumen esperado.

### 7.7 Alcance limitado a código de theme

El sistema no cubre, y no puede cubrir:

- **App embeds y theme app extensions**, que viven fuera de los archivos del theme.
- **Cambios inyectados por apps** vía ScriptTag u otros mecanismos.
- **Metafields y metaobjects**, que suelen ser dependencias de un feature pero no son parte del theme.

Un fix que dependa de cualquiera de estos requiere coordinación manual.

### 7.8 Renombre de themes

El mapeo por ID lo resuelve, pero el `title` en el registro queda desactualizado. Cosmético, no funcional.

*Refinamiento posible:* refrescar títulos en cada corrida del reaper.

### 7.9 Rollback

No hay un flujo definido para deshacer un merge ya pusheado a un theme.

Como no se toca el live, el impacto está acotado: se revierte el commit en la branch y se vuelve a pushear. Pero conviene definirlo explícitamente antes de necesitarlo con urgencia.

### 7.10 Escalado multi-tienda

El diseño es de un repo por tienda. Con varias tiendas, los workflows se duplican y divergen.

*Refinamiento posible:* workflows reutilizables en un repo central, parametrizados por tienda. Vale la pena a partir de la tercera o cuarta tienda, no antes.

### 7.11 Detección de themes nuevos

El webhook `themes/create` dispara con cualquier duplicado. La convención de nombre (§4.2) filtra el ruido, pero depende de que quien crea el theme respete la convención.

*Refinamiento posible:* alta explícita desde la interfaz del sistema, en vez de detección automática. Menos mágico, más predecible.

---

## 8. Orden de implementación sugerido

Cada etapa deja algo utilizable aunque el proyecto se detenga ahí.

1. **Espejo del live** (`mirror.yml`). Da el registro de drift sin depender de nada más.
2. **Alta + push por commit**, disparado manualmente con `workflow_dispatch`. Ya habilita trabajar con IDE o agente.
3. **Detección automática de themes nuevos** por webhook.
4. **Merge** con doble pull, gate de JSON y verificación de rol.
5. **Reaper.**

Los primeros dos pasos son plomería y pueden estar andando en pocos días. El paso 4 es lo verdaderamente nuevo del sistema.
