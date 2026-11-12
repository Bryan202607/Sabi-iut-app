// Relais IA de Sabi pour Cloudflare Workers (remplace gemini.js, chat-ia.js et gemini-fichier.js de Netlify).
// Variables à définir dans Cloudflare (Settings > Variables and Secrets, type "Secret") :
//   GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, HUGGINGFACE_API_KEY, OPENAI_API_KEY, MISTRAL_API_KEY
// Astuce : une variable peut contenir plusieurs clés séparées par des virgules ; une est tirée au hasard
// à chaque appel, ce qui multiplie les limites gratuites.

const GEMINI_MODEL = "gemini-3.6-flash";

const PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", envVar: "GROQ_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", envVar: "OPENROUTER_API_KEY" },
  huggingface: { url: "https://router.huggingface.co/v1/chat/completions", envVar: "HUGGINGFACE_API_KEY" },
  openai: { url: "https://api.openai.com/v1/chat/completions", envVar: "OPENAI_API_KEY" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", envVar: "MISTRAL_API_KEY" }
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...CORS, "Content-Type": "application/json" } });
}
function erreur(message, status) {
  return json({ error: { message } }, status);
}
function choisirCle(valeur) {
  const cles = String(valeur || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!cles.length) return "";
  return cles[Math.floor(Math.random() * cles.length)];
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const chemin = new URL(request.url).pathname;
    if (request.method === "GET" && (chemin === "/" || chemin === "/sante")) return json({ ok: true, service: "sabi-ia" });
    if (request.method !== "POST") return erreur("Méthode non autorisée.", 405);
    try {
      if (chemin === "/.netlify/functions/gemini" || chemin === "/gemini") return await gemini(request, env);
      if (chemin === "/.netlify/functions/chat-ia" || chemin === "/chat-ia") return await chatIA(request, env);
      if (chemin === "/api/gemini-fichier" || chemin === "/gemini-fichier") return await geminiFichier(request, env);
    } catch (err) {
      return erreur("Relais indisponible : " + ((err && err.message) || "cause inconnue"), 502);
    }
    return erreur("Route inconnue : " + chemin, 404);
  }
};

async function gemini(request, env) {
  const cle = choisirCle(env.GEMINI_API_KEY);
  if (!cle) return erreur("GEMINI_API_KEY absente des variables Cloudflare.", 500);
  const corps = await request.text();
  const amont = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + cle, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corps
  });
  return new Response(await amont.text(), { status: amont.status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function chatIA(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) { return erreur("Corps de requête JSON invalide.", 400); }
  const fournisseur = PROVIDERS[payload.provider];
  if (!fournisseur) return erreur("Fournisseur inconnu : " + payload.provider, 400);
  const cle = choisirCle(env[fournisseur.envVar]);
  if (!cle) return erreur(fournisseur.envVar + " absente des variables Cloudflare.", 500);
  const entetes = {};
  for (const [k, v] of Object.entries(payload.extraHeaders || {})) entetes[k] = String(v).replace(/[^\x00-\xFF]/g, "-");
  const amont = await fetch(fournisseur.url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + cle }, entetes),
    body: JSON.stringify({ model: payload.model, messages: payload.messages, temperature: 0.6 })
  });
  return new Response(await amont.text(), { status: amont.status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function geminiFichier(request, env) {
  const cle = choisirCle(env.GEMINI_API_KEY);
  if (!cle) return erreur("GEMINI_API_KEY absente des variables Cloudflare.", 500);
  const mimeType = request.headers.get("content-type") || "application/octet-stream";
  const taille = request.headers.get("content-length");
  if (!taille) return erreur("Taille du fichier inconnue (en-tête Content-Length manquant).", 400);
  const init = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + cle, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": taille,
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: "sabi-upload" } })
  });
  const urlUpload = init.headers.get("x-goog-upload-url");
  if (!urlUpload) {
    const t = await init.text().catch(() => "");
    return erreur("Initialisation de l'upload Gemini échouée : " + t.slice(0, 300), 502);
  }
  const fin = await fetch(urlUpload, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": taille },
    body: request.body,
    duplex: "half"
  });
  const data = await fin.json().catch(() => null);
  const fichier = data && data.file;
  if (!fichier || !fichier.uri) return erreur("Réponse d'upload Gemini invalide.", 502);
  return json({ uri: fichier.uri, mimeType: fichier.mimeType || mimeType });
}
