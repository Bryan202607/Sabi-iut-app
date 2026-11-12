// Code partagé par creer-paiement.js, verifier-paiement.js et webhook-notchpay.js.
// (Dossier "lib" : Netlify ne le déploie pas comme une fonction à part, il est simplement inclus.)
//
// Variables d'environnement Netlify requises :
//  - NOTCHPAY_SECRET_KEY    : clé SECRÈTE NotchPay (Réglages > Clés API)
//  - NOTCHPAY_WEBHOOK_HASH  : "Hash Key" du webhook NotchPay (Réglages > Clés API > ton webhook)
//  - FIREBASE_DB_URL        : ex. https://sabi-41823-default-rtdb.firebaseio.com
//  - FIREBASE_CLIENT_EMAIL  : champ "client_email" du JSON du compte de service
//  - FIREBASE_PRIVATE_KEY   : champ "private_key" du JSON du compte de service (avec ses \n)
//  - FIREBASE_API_KEY       : (optionnel) clé web Firebase, par défaut celle de l'app
//  - SITE_URL               : (optionnel) par défaut https://sabi-iut-fv.netlify.app

const crypto = require("crypto");

const FIREBASE_API_KEY_DEFAUT = "AIzaSyBCgSKNEcsCNTpzK2Qi11Q9n9xpePJztVc"; // clé web publique (déjà dans index.html)
const SITE_URL_DEFAUT = "https://sabi-iut-fv.netlify.app";

// Mêmes prix que dans index.html (PRIX_PRO_SEMESTRE, etc.). Le serveur est la source de vérité :
// l'appli n'envoie JAMAIS de montant, seulement le pack choisi.
const PRIX = {
  pro: { semestre: 2000, annee: 3000 },
  proplus: { semestre: 5000, annee: 8000 }
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function reponse(statusCode, objet) {
  return { statusCode, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(objet) };
}

function config() {
  const c = {
    notchSecret: process.env.NOTCHPAY_SECRET_KEY,
    notchHash: process.env.NOTCHPAY_WEBHOOK_HASH,
    dbUrl: (process.env.FIREBASE_DB_URL || "").replace(/\/+$/, ""),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    apiKey: process.env.FIREBASE_API_KEY || FIREBASE_API_KEY_DEFAUT,
    siteUrl: (process.env.SITE_URL || SITE_URL_DEFAUT).replace(/\/+$/, "")
  };
  return c;
}

function manquants(c, cles) {
  const noms = { notchSecret: "NOTCHPAY_SECRET_KEY", notchHash: "NOTCHPAY_WEBHOOK_HASH", dbUrl: "FIREBASE_DB_URL", clientEmail: "FIREBASE_CLIENT_EMAIL", privateKey: "FIREBASE_PRIVATE_KEY" };
  return cles.filter(k => !c[k]).map(k => noms[k]);
}

// ---------- Google / Firebase ----------
function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let jetonEnCache = null; // { valeur, expire }
async function obtenirAccessToken(c) {
  if (jetonEnCache && jetonEnCache.expire > Date.now() + 60000) return jetonEnCache.valeur;
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const revendications = base64url(JSON.stringify({
    iss: c.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: maintenant,
    exp: maintenant + 3600
  }));
  const nonSigne = entete + "." + revendications;
  const signature = base64url(crypto.sign("RSA-SHA256", Buffer.from(nonSigne), c.privateKey));
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + nonSigne + "." + signature
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Échec d'authentification Google : " + (data.error_description || JSON.stringify(data)));
  jetonEnCache = { valeur: data.access_token, expire: Date.now() + (data.expires_in || 3600) * 1000 };
  return jetonEnCache.valeur;
}

// Petit client REST pour la Realtime Database, avec droits admin (compte de service).
async function db(c, methode, chemin, corps) {
  const jeton = await obtenirAccessToken(c);
  const resp = await fetch(`${c.dbUrl}/${chemin}.json`, {
    method: methode,
    headers: { Authorization: "Bearer " + jeton, "Content-Type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  if (!resp.ok) throw new Error(`Firebase ${methode} /${chemin} → HTTP ${resp.status}`);
  return resp.json();
}

// Vérifie le jeton de connexion Firebase envoyé par l'appli et renvoie l'uid RÉEL de l'utilisateur.
// (On ne fait jamais confiance à un uid envoyé dans le corps de la requête.)
async function verifierIdToken(c, idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const resp = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + c.apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const u = data && data.users && data.users[0];
  return u ? { uid: u.localId, email: u.email || "" } : null;
}

// ---------- Prix ----------
// Identique à prixEffectif() dans index.html : une promo expirée est ignorée automatiquement.
function prixAttendu(tier, duree, promo) {
  const base = PRIX[tier][duree];
  const promoActive = promo && promo.finLe && promo.finLe > Date.now() && promo.prix > 0;
  return { base, effectif: promoActive ? promo.prix : base, promo: !!promoActive };
}

// ---------- Fin d'abonnement (même calendrier que l'appli : semestres, heure de Douala UTC+1) ----------
const DECALAGE_MS = 60 * 60 * 1000;
function finDeMois(annee, moisIndex) {
  return Date.UTC(annee, moisIndex + 1, 0, 23, 59, 59, 999) - DECALAGE_MS;
}
function finDuSemestreActuel(ts) {
  const d = new Date(ts + DECALAGE_MS);
  const mois = d.getUTCMonth(), annee = d.getUTCFullYear();
  if (mois <= 1) return finDeMois(annee, 1);
  if (mois <= 6) return finDeMois(annee, 6);
  return finDeMois(annee + 1, 1);
}
function finDeLAnneeActuelle(ts) {
  return finDuSemestreActuel(finDuSemestreActuel(ts) + 24 * 60 * 60 * 1000);
}

// ---------- NotchPay ----------
async function notchGet(c, reference) {
  const resp = await fetch("https://api.notchpay.co/payments/" + encodeURIComponent(reference), {
    headers: { Authorization: c.notchSecret, Accept: "application/json" }
  });
  let data = null;
  try { data = await resp.json(); } catch { /* réponse non JSON */ }
  return { http: resp.status, data };
}

// ---------- Cœur : confirme un paiement (appelé par le webhook ET par la vérification manuelle) ----------
// Idempotent : même appelé 2 fois en parallèle (webhook + appli), l'abonnement n'est activé qu'une fois.
async function confirmerPaiement(c, ref, source) {
  const paiement = await db(c, "GET", `paiements/${ref}`);
  if (!paiement) return { ok: false, code: 404, message: "Paiement introuvable." };
  if (paiement.statut === "confirme") return { ok: true, code: 200, message: "Déjà confirmé.", deja: true };

  // 1) Statut RÉEL chez NotchPay (clé secrète). On interroge d'abord avec la référence NotchPay
  //    (trx.xxx) enregistrée à la création, sinon avec la nôtre.
  const refNotch = paiement.notchRef || ref;
  let { http, data } = await notchGet(c, refNotch);
  if (http === 404 && refNotch !== ref) ({ http, data } = await notchGet(c, ref));
  const tx = data && (data.transaction || data.payment);
  const statut = tx && tx.status;
  if (statut !== "complete") {
    return {
      ok: false, code: 200,
      message: "Paiement pas encore confirmé par NotchPay (statut : " + (statut || "inconnu") + ") [NotchPay HTTP " + http + (data && data.message ? " : " + data.message : "") + " ; référence testée : " + (paiement.notchRef ? "trx enregistrée" : "aucune trx enregistrée, essai avec " + ref) + "]."
    };
  }

  // 2) Le montant réellement payé doit couvrir le prix calculé par le serveur à la création.
  const paye = Number(tx.amount);
  if (!Number.isFinite(paye) || paye < Number(paiement.montant)) {
    await db(c, "PATCH", `paiements/${ref}`, { statut: "montant_invalide", montantPaye: Number.isFinite(paye) ? paye : null });
    return { ok: false, code: 200, message: "Montant payé (" + tx.amount + ") inférieur au prix attendu (" + paiement.montant + "). Contacte l'assistance." };
  }
  if (tx.currency && tx.currency !== "XAF") {
    return { ok: false, code: 200, message: "Devise inattendue : " + tx.currency };
  }

  // 3) "Réclame" le paiement de façon atomique (ETag) — un seul appel peut passer de "en_attente" à "confirme".
  const jeton = await obtenirAccessToken(c);
  const urlStatut = `${c.dbUrl}/paiements/${ref}/statut.json`;
  const lecture = await fetch(urlStatut, { headers: { Authorization: "Bearer " + jeton, "X-Firebase-ETag": "true" } });
  const etag = lecture.headers.get("etag");
  if ((await lecture.json()) === "confirme") return { ok: true, code: 200, message: "Déjà confirmé.", deja: true };
  const reclame = await fetch(urlStatut, {
    method: "PUT",
    headers: { Authorization: "Bearer " + jeton, "Content-Type": "application/json", "if-match": etag },
    body: JSON.stringify("confirme")
  });
  if (reclame.status === 412) return { ok: true, code: 200, message: "Déjà confirmé.", deja: true };
  if (!reclame.ok) throw new Error("Impossible de réserver le paiement (HTTP " + reclame.status + ").");

  // 4) Active l'abonnement. En cas d'échec, on remet le paiement "en_attente" pour pouvoir réessayer.
  try {
    const maintenant = Date.now();
    let expireLe = paiement.duree === "annee" ? finDeLAnneeActuelle(maintenant) : finDuSemestreActuel(maintenant);
    const actuel = await db(c, "GET", `users/${paiement.uid}/abonnement`);
    if (actuel && actuel.expireLe > maintenant && actuel.expireLe > expireLe) expireLe = actuel.expireLe; // ne jamais raccourcir un abonnement existant
    await db(c, "PUT", `users/${paiement.uid}/abonnement`, { tier: paiement.tier, duree: paiement.duree || "semestre", expireLe });
    await db(c, "PATCH", `paiements/${ref}`, { confirmeLe: maintenant, confirmePar: source, montantPaye: paye });
  } catch (e) {
    await db(c, "PUT", `paiements/${ref}/statut`, "en_attente").catch(() => {});
    throw e;
  }
  return { ok: true, code: 200, message: "Abonnement activé." };
}

// Identifiant du projet Firebase, déduit de l'email du compte de service (xxx@PROJET.iam.gserviceaccount.com).
function projetId(c) {
  const m = String(c.clientEmail || "").match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
  return process.env.FIREBASE_PROJECT_ID || (m && m[1]) || "";
}

module.exports = {
  projetId,
  PRIX, CORS_HEADERS, reponse, config, manquants, db, verifierIdToken, prixAttendu,
  finDuSemestreActuel, finDeLAnneeActuelle, notchGet, confirmerPaiement, obtenirAccessToken
};
