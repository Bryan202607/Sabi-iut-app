// Edge Function (Deno, PAS une Function classique) : relaie un PDF/photo vers l'API File de
// Gemini en flux continu, sans jamais charger tout le fichier en mémoire côté serveur — c'est ce
// qui permet de dépasser la limite dure de 6 Mo par requête imposée aux Netlify Functions
// classiques (infrastructure AWS Lambda, non contournable là-bas). Les Edge Functions tournent
// sur une infra différente (Deno Deploy) sans ce plafond.
//
// Le client envoie directement les octets bruts du fichier en corps de requête (Content-Type =
// le mime type du fichier), sans jamais voir GEMINI_API_KEY. En retour : { uri, mimeType } à
// référencer via "file_data" dans l'appel de génération (voir gemini.js), qui reste minuscule
// quelle que soit la taille du fichier d'origine puisqu'il ne transporte plus le fichier lui-même.
//
// GEMINI_API_KEY doit être définie dans Netlify (Site configuration > Environment variables) —
// même variable que celle déjà utilisée par gemini.js.

// En-têtes CORS : indispensables depuis que l'app existe aussi en version native (Capacitor) —
// voir explication détaillée dans gemini.js.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const reponse = await gererRequete(request);
  const entetes = new Headers(reponse.headers);
  for (const [cle, valeur] of Object.entries(CORS_HEADERS)) entetes.set(cle, valeur);
  return new Response(reponse.body, { status: reponse.status, headers: entetes });
};

async function gererRequete(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Méthode non autorisée." } }), { status: 405 });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: "GEMINI_API_KEY absente des variables d'environnement Netlify." } }),
      { status: 500 }
    );
  }

  const mimeType = request.headers.get("content-type") || "application/octet-stream";
  const taille = request.headers.get("content-length");
  if (!taille) {
    return new Response(
      JSON.stringify({ error: { message: "Taille du fichier inconnue (en-tête Content-Length manquant)." } }),
      { status: 400 }
    );
  }

  try {
    // Étape 1 : ouvrir une session d'upload "resumable" auprès de Google — petite requête,
    // aucune limite de taille en jeu ici.
    const initResp = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + apiKey, {
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
    const uploadUrl = initResp.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      const errTexte = await initResp.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: { message: "Initialisation de l'upload Gemini échouée : " + errTexte.slice(0, 300) } }),
        { status: 502 }
      );
    }

    // Étape 2 : relayer les octets du fichier en streaming (request.body est déjà un
    // ReadableStream ici, jamais entièrement bufferisé) — c'est cette étape qui contourne la
    // limite de 6 Mo, absente sur les Edge Functions.
    const finishResp = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Length": taille
      },
      body: request.body,
      duplex: "half"
    });

    const data = await finishResp.json().catch(() => null);
    const fichier = data && data.file;
    if (!fichier || !fichier.uri) {
      return new Response(
        JSON.stringify({ error: { message: "Réponse d'upload Gemini invalide." } }),
        { status: 502 }
      );
    }
    return new Response(JSON.stringify({ uri: fichier.uri, mimeType: fichier.mimeType || mimeType }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: "Relais d'upload Gemini indisponible : " + ((err && err.message) || "cause inconnue") } }),
      { status: 502 }
    );
  }
};

// Déclaration de route directement dans le fichier — Netlify la détecte automatiquement, pas
// besoin de toucher à un éventuel netlify.toml existant.
export const config = { path: "/api/gemini-fichier" };
