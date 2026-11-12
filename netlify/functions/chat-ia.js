// Relais serveur pour Groq et OpenRouter : garde GROQ_API_KEY et OPENROUTER_API_KEY hors du
// navigateur. Les deux clés doivent être définies dans Netlify → Site configuration →
// Environment variables (noms exacts : GROQ_API_KEY, OPENROUTER_API_KEY — mêmes valeurs que les
// anciennes clés codées en dur dans index.html).
//
// Le client (index.html) envoie { provider: "groq" | "openrouter", model, messages, extraHeaders },
// sans jamais connaître les clés — cette fonction choisit le bon fournisseur, ajoute sa clé
// secrète en en-tête Authorization, et relaie la requête.

// Relais serveur pour Groq, OpenRouter, Hugging Face et OpenAI : garde toutes les clés hors du
// navigateur. Chacune doit être définie dans Netlify → Site configuration → Environment
// variables, sous le nom exact indiqué dans envVar ci-dessous.
//
// Le client (index.html) envoie { provider: "groq" | "openrouter" | "huggingface" | "openai" | "mistral",
// model, messages, extraHeaders }, sans jamais connaître les clés — cette fonction choisit le
// bon fournisseur, ajoute sa clé secrète en en-tête Authorization, et relaie la requête telle
// quelle (les quatre exposent une API "chat completions" compatible OpenAI, donc pas de
// transformation de payload nécessaire ici).

const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    envVar: "GROQ_API_KEY"
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    envVar: "OPENROUTER_API_KEY"
  },
  // Hugging Face "Inference Providers" — passerelle unifiée compatible OpenAI, le modèle attend
  // un format "id_du_modele:fournisseur" (ex. "meta-llama/Llama-3.3-70B-Instruct:novita").
  // NON VÉRIFIÉ en direct sur la doc actuelle au moment où j'écris ça (recherche web indisponible) —
  // teste cette entrée avant de compter dessus, l'URL ou le format de "model" a pu changer.
  huggingface: {
    url: "https://router.huggingface.co/v1/chat/completions",
    envVar: "HUGGINGFACE_API_KEY"
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    envVar: "OPENAI_API_KEY"
  },
  // Mistral : API compatible OpenAI (texte : mistral-small-latest, photos : pixtral-12b-2409).
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    envVar: "MISTRAL_API_KEY"
  }
};

// En-têtes CORS : indispensables depuis que l'app existe aussi en version native (Capacitor) —
// voir explication détaillée dans gemini.js.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  const reponse = await gererRequete(event);
  return { ...reponse, headers: { ...CORS_HEADERS, ...(reponse.headers || {}) } };
};

async function gererRequete(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: { message: "Méthode non autorisée." } }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Corps de requête JSON invalide." } }) };
  }

  const provider = PROVIDERS[payload.provider];
  if (!provider) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Fournisseur inconnu : " + payload.provider } }) };
  }

  const apiKey = process.env[provider.envVar];
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: provider.envVar + " absente des variables d'environnement Netlify." } })
    };
  }

  // Les en-têtes HTTP doivent être en Latin-1 strict (ByteString) — fetch() de Node rejette tout
  // caractère au-delà de 255 (accents, tirets cadratins "—", emojis...) avec une erreur cryptique
  // ("Cannot convert argument to a ByteString..."). Sécurité en plus de la vigilance côté client :
  // on nettoie ici toute valeur d'en-tête fournie par le client avant de l'envoyer au fournisseur.
  const entetesSurs = {};
  for (const [cle, valeur] of Object.entries(payload.extraHeaders || {})) {
    entetesSurs[cle] = String(valeur).replace(/[^\x00-\xFF]/g, "-");
  }

  try {
    const upstream = await fetch(provider.url, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        entetesSurs
      ),
      body: JSON.stringify({ model: payload.model, messages: payload.messages, temperature: 0.6 })
    });
    const texte = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json" },
      body: texte
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: "Relais vers " + payload.provider + " indisponible : " + (err && err.message || "cause inconnue") } })
    };
  }
};
