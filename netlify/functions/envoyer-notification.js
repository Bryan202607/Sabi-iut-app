// Envoie une vraie notification push (Firebase Cloud Messaging), délivrée même téléphone
// verrouillé / app fermée — contrairement à la précédente approche "web push" qui ne
// réveillait pas fiablement l'app native.
//
// Deux modes selon le corps de la requête :
// - { cibleUid, titre, corps }      -> notifie UN SEUL utilisateur (ex: réponse à un bounty)
// - { diffusion: true, titre, corps } -> notifie TOUS les utilisateurs ayant un token enregistré
//   (ex: nouveau message chat, nouvelle épreuve, annonce admin)
//
// Variables d'environnement Netlify requises (déjà en place pour verifier-paiement.js) :
// - FIREBASE_DB_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const crypto = require("crypto");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Même mécanisme d'authentification que verifier-paiement.js, mais avec le scope FCM
// (l'écriture Realtime Database et l'envoi de notifications sont deux permissions distinctes
// côté Google, chacune avec son propre "scope" à demander).
async function obtenirAccessToken(clientEmail, privateKey) {
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const revendications = base64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database",
    aud: "https://oauth2.googleapis.com/token",
    iat: maintenant,
    exp: maintenant + 3600
  }));
  const nonSigne = entete + "." + revendications;
  const signature = base64url(crypto.sign("RSA-SHA256", Buffer.from(nonSigne), privateKey));
  const jwt = nonSigne + "." + signature;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Échec d'authentification Google : " + (data.error_description || JSON.stringify(data)));
  return data.access_token;
}

async function envoyerAUnToken(projectId, accessToken, token, titre, corps) {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    body: JSON.stringify({ message: { token, notification: { title: titre, body: corps } } })
  });
  // Best-effort : un token expiré/désinstallé ne doit jamais faire échouer tout l'envoi aux
  // autres utilisateurs — on avale l'erreur individuelle et on continue.
  if (!resp.ok) { try { console.warn("Échec envoi FCM (token invalide ?) :", await resp.text()); } catch {} }
  return resp.ok;
}

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
    return { statusCode: 405, body: JSON.stringify({ ok: false, message: "Méthode non autorisée." }) };
  }

  const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!FIREBASE_DB_URL || !FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: "Configuration serveur incomplète (identifiants Firebase manquants)." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, message: "Corps de requête invalide." }) };
  }
  const { cibleUid, diffusion, titre, corps } = payload;
  if (!titre || !corps || (!cibleUid && !diffusion)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, message: "titre, corps, et (cibleUid ou diffusion) sont requis." }) };
  }

  try {
    const accessToken = await obtenirAccessToken(FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY);

    let tokens = [];
    if (cibleUid) {
      const resp = await fetch(`${FIREBASE_DB_URL}/users/${cibleUid}/fcmToken.json?access_token=${accessToken}`);
      const token = await resp.json();
      if (token) tokens = [token];
    } else {
      const resp = await fetch(`${FIREBASE_DB_URL}/users.json?shallow=false&access_token=${accessToken}`);
      const users = await resp.json();
      tokens = Object.values(users || {}).map(u => u && u.fcmToken).filter(Boolean);
    }

    if (tokens.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, envoyes: 0, message: "Aucun appareil enregistré pour cette cible." }) };
    }

    const resultats = await Promise.all(tokens.map(t => envoyerAUnToken(FIREBASE_PROJECT_ID, accessToken, t, titre, corps)));
    const envoyes = resultats.filter(Boolean).length;
    return { statusCode: 200, body: JSON.stringify({ ok: true, envoyes, total: tokens.length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: e.message || "Erreur inconnue." }) };
  }
}
