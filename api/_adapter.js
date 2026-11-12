// Adaptateur Netlify -> Vercel : permet de garder les fonctions telles quelles
// (exports.handler(event) qui renvoie { statusCode, headers, body }).
// Le corps est lu brut (indispensable pour la signature du webhook NotchPay).
function lireCorps(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on("data", (c) => morceaux.push(typeof c === "string" ? Buffer.from(c) : c));
    req.on("end", () => resolve(Buffer.concat(morceaux).toString("utf8")));
    req.on("error", reject);
  });
}

function envelopper(handler) {
  return async (req, res) => {
    try {
      const corps = req.method === "GET" || req.method === "HEAD" ? "" : await lireCorps(req);
      const url = new URL(req.url, "http://localhost");
      const event = {
        httpMethod: req.method,
        headers: req.headers || {},
        body: corps,
        isBase64Encoded: false,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        path: url.pathname
      };
      const r = (await handler(event, {})) || {};
      const entetes = r.headers || {};
      Object.keys(entetes).forEach((k) => res.setHeader(k, entetes[k]));
      res.statusCode = r.statusCode || 200;
      res.end(r.body || "");
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Erreur serveur : " + ((e && e.message) || e) }));
    }
  };
}

module.exports = { envelopper };
