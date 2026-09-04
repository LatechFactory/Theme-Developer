// DigitalOcean Function (web: raw) — endpoint del webhook themes/create.
//
// Verifica el HMAC de Shopify y dispara un repository_dispatch en GitHub
// (event_type: theme-created) que corre adopt-theme.yml.
//
// En modo raw, DO pasa el body como string de texto en args.__ow_body y los
// headers (en minuscula) en args.__ow_headers. El HMAC se calcula sobre esos bytes.

const crypto = require("crypto");

async function main(args) {
  if ((args.__ow_method || "").toLowerCase() !== "post") {
    return reply(405, "Method Not Allowed");
  }

  const headers = args.__ow_headers || {};
  const hmacHeader = headers["x-shopify-hmac-sha256"] || "";
  // DO (web: raw) pasa el body como string de texto en __ow_body, no base64.
  const raw = Buffer.from(args.__ow_body || "", "utf8");

  if (!validHmac(process.env.SHOPIFY_CLIENT_SECRET, raw, hmacHeader)) {
    return reply(401, "Invalid HMAC");
  }

  // Defensa en profundidad: solo el topic esperado.
  const topic = headers["x-shopify-topic"] || "";
  if (topic && topic !== "themes/create") {
    return reply(200, "Ignored topic");
  }

  let theme;
  try {
    theme = JSON.parse(raw.toString("utf8"));
  } catch {
    return reply(400, "Bad JSON");
  }
  if (!theme || theme.id == null) {
    return reply(200, "Sin theme id");
  }

  const resp = await fetch(
    `https://api.github.com/repos/${process.env.GH_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "theme-adopt-webhook",
      },
      body: JSON.stringify({
        event_type: "theme-created",
        client_payload: { id: theme.id, name: theme.name || "" },
      }),
    }
  );

  if (!resp.ok) {
    // 200 igual: no queremos que Shopify reintente por un fallo de GitHub.
    console.log("dispatch fallo", resp.status, await resp.text());
  }

  return reply(200, "ok");
}

function validHmac(secret, rawBuf, headerB64) {
  if (!secret || !headerB64) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBuf).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(headerB64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function reply(statusCode, body) {
  return { statusCode, body };
}

exports.main = main;
