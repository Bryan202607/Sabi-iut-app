// Relais serveur pour Gemini : garde GEMINI_API_KEY hors du navigateur.
// La clé doit être définie dans Netlify → Site configuration → Environment variables
// (nom exact : GEMINI_API_KEY, même valeur que l'ancienne clé codée en dur dans index.html).
//
// Le client (index.html) envoie exactement le même corps JSON qu'avant (contents, generationConfig),
// sans jamais connaître la clé — cette fonction se contente de l'ajouter et de relayer la requête.

const GEMINI_MODEL = "gemini-3.6-flash";

// En-têtes CORS : indispensables depuis que l'app existe aussi en version native (Capacitor).
// Sur le web, index.html et cette fonction partagent la même origine (netlify.app) donc le
// navigateur n'a jamais besoin de CORS. Dans l'app Android/iOS, l'app tourne sur une origine
// différente (capacitor://localhost) — sans ces en-têtes, le navigateur intégré bloque la
// réponse avant même qu'elle n'atteigne le code JS, silencieusement.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    // Requête "préflight" envoyée automatiquement par le navigateur avant la vraie requête POST
    // cross-origin — doit juste confirmer que c'est autorisé, sans body.
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  const reponse = await gererRequete(event);
  return { ...reponse, headers: { ...CORS_HEADERS, ...(reponse.headers || {}) } };
};

async function gererRequete(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: { message: "Méthode non autorisée." } }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: "GEMINI_API_KEY absente des variables d'environnement Netlify." } })
    };
  }

  try {
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: event.body
      }
    );
    const texte = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json" },
      body: texte
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: "Relais vers Gemini indisponible : " + (err && err.message || "cause inconnue") } })
    };
  }
};
