// Création de compte côté serveur — remplace la création faite par le téléphone
// (auth.createUserWithEmailAndPassword + écriture du profil), qui restait sujette à des
// problèmes de timing/cache/permissions impossibles à diagnostiquer à distance.
//
// Ici, tout se passe en un seul appel serveur avec les droits admin : aucune règle de
// sécurité Firebase ne s'applique à ces requêtes, donc aucun des problèmes rencontrés côté
// client (jeton pas encore propagé, écriture acceptée localement mais pas vraiment
// confirmée...) ne peut se produire. Réutilise les mêmes variables d'environnement que
// envoyer-notification.js et rappel-quotidien.js.

const crypto = require("crypto");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function obtenirAccessToken(clientEmail, privateKey) {
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const revendications = base64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase.database",
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

async function traiter(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ erreur: "Méthode non autorisée." }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ erreur: "Requête invalide." }) }; }

  const email = (payload.email || "").trim();
  const password = payload.password || "";
  const pseudo = (payload.pseudo || "").trim();
  const annee = payload.annee || "";
  const filiere = payload.filiere || "";
  const matriculeNorm = (payload.matricule || "").trim().toUpperCase();
  const whatsapp = (payload.whatsapp || "").trim();

  if (!email || !password || pseudo.length < 2 || !annee || !filiere) {
    return { statusCode: 400, body: JSON.stringify({ erreur: "Champs manquants ou incomplets." }) };
  }

  const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!FIREBASE_DB_URL || !FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ erreur: "Configuration serveur incomplète." }) };
  }

  let accessToken;
  try {
    accessToken = await obtenirAccessToken(FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY);
  } catch (e) {
    console.error("Échec authentification Google :", e.message || e);
    return { statusCode: 500, body: JSON.stringify({ erreur: "Erreur serveur (authentification Google)." }) };
  }

  // 1. Création du compte (droits admin : aucun souci de règles ni de timing de jeton ici).
  let uid;
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ email, password, emailVerified: false })
    });
    const data = await resp.json();
    if (!resp.ok || !data.localId) {
      console.error("Échec création compte :", resp.status, JSON.stringify(data));
      const code = (data.error && data.error.message) || "inconnue";
      const msg = String(code).includes("EMAIL_EXISTS") ? "Cet email a déjà un compte, essaie de te connecter." : "Impossible de créer le compte (" + code + ").";
      return { statusCode: 400, body: JSON.stringify({ erreur: msg }) };
    }
    uid = data.localId;
  } catch (e) {
    console.error("Erreur réseau création compte :", e.message || e);
    return { statusCode: 500, body: JSON.stringify({ erreur: "Erreur réseau lors de la création du compte." }) };
  }

  // 2. Écriture du profil (même jeton admin, mêmes garanties).
  const profil = { pseudo, matricule: matriculeNorm || null, annee, filiere, points: 0, whatsapp: whatsapp || null };
  try {
    const respEcriture = await fetch(`${FIREBASE_DB_URL}/users/${uid}.json?access_token=${accessToken}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profil)
    });
    if (!respEcriture.ok) {
      const texte = await respEcriture.text();
      throw new Error("HTTP " + respEcriture.status + " : " + texte);
    }

    if (matriculeNorm) {
      const matriculeCle = matriculeNorm.replace(/[.#$/\[\]]/g, "_");
      await fetch(`${FIREBASE_DB_URL}/matricules/${matriculeCle}.json?access_token=${accessToken}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(uid)
      });
    }
  } catch (e) {
    console.error("Échec écriture profil pour uid", uid, ":", e.message || e, "| FIREBASE_DB_URL utilisée :", FIREBASE_DB_URL);
    // Écriture du profil impossible malgré les droits admin (cas très rare) : on supprime le
    // compte qu'on vient de créer pour ne rien laisser de fantôme derrière nous.
    try {
      await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ localId: uid })
      });
    } catch {}
    // Le détail technique est inclus directement dans la réponse (temporaire, le temps de
    // diagnostiquer) pour ne plus dépendre de l'accès aux logs Netlify depuis le téléphone.
    return { statusCode: 500, body: JSON.stringify({ erreur: "Le profil n'a pas pu être enregistré, réessaie.", detail: String(e.message || e) }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, uid }) };
}

// CORS : l'appli installée (Capacitor) appelle cette fonction depuis une autre origine que
// le site Netlify. Sans ces en-têtes, le navigateur bloque l'appel (« Failed to fetch »).
const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: ENTETES_CORS, body: "" };
  let res;
  try {
    res = await traiter(event);
  } catch (e) {
    console.error("Erreur inattendue :", e && e.message || e);
    res = { statusCode: 500, body: JSON.stringify({ erreur: "Erreur serveur inattendue.", detail: String((e && e.message) || e) }) };
  }
  return { ...res, headers: { ...ENTETES_CORS, ...(res.headers || {}) } };
};
