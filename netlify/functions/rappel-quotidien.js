// Rappel quotidien automatique (type "notification WhatsApp") — envoyé à tous les
// utilisateurs ayant un token FCM enregistré. Se déclenche seul chaque jour grâce à la
// planification déclarée dans netlify.toml (voir en bas de ce fichier), sans action manuelle.
//
// Réutilise exactement le même mécanisme d'authentification et d'envoi que
// envoyer-notification.js (mêmes variables d'environnement, déjà en place sur Netlify) :
// FIREBASE_DB_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const crypto = require("crypto");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
  if (!resp.ok) { try { console.warn("Échec envoi FCM (token invalide ?) :", await resp.text()); } catch {} }
  return resp.ok;
}

// Rotation quotidienne, basée sur le jour de l'année (cycle beaucoup plus long qu'un simple
// jour du mois, pour éviter de répéter le même message deux mois de suite). Le même principe
// que ASTUCES_DU_JOUR / messagesMatin déjà utilisés côté client.
const RAPPELS_QUOTIDIENS = [
  { titre: "C'est l'heure de réviser 📚", corps: "Un petit quart d'heure maintenant, et ta soirée sera plus légère." },
  { titre: "Sabi te fait signe 👋", corps: "Une session courte vaut mieux qu'aucune. Ouvre l'app et choisis une matière." },
  { titre: "Petit rappel du jour", corps: "As tu vérifié les nouvelles épreuves publiées cette semaine ?" },
  { titre: "Objectif du jour 🎯", corps: "Choisis une matière et donne lui 25 minutes pleinement concentrées." },
  { titre: "Ne perds pas ta série 🔥", corps: "Une astuce ou une réponse utile aujourd'hui, et tu gardes ta place au classement." },
  { titre: "Coach Réussite t'attend 🎓", corps: "Besoin d'un plan de révision clair pour aujourd'hui ? Il est juste là." },
  { titre: "Astuce du jour 💡", corps: "Relire ses notes de la veille au réveil double la mémorisation à long terme." },
  { titre: "Ta moyenne t'attend 📊", corps: "Vérifie où tu en es avec le Simulateur de moyenne." },
  { titre: "La communauté avance 🚀", corps: "De nouvelles astuces et épreuves sont sûrement tombées depuis ta dernière visite." },
  { titre: "Deux minutes suffisent ⏱️", corps: "Relance une petite session de révision, même courte, ça compte vraiment." },
  { titre: "Pense à tes camarades 🤝", corps: "Une astuce que tu partages aujourd'hui peut sauver la semaine de quelqu'un d'autre." },
  { titre: "Sabi n'oublie jamais 🌙", corps: "Une révision le soir, même brève, ancre mieux les connaissances de la journée." }
];

function messageDuJour() {
  const debutAnnee = new Date(new Date().getFullYear(), 0, 1);
  const jourDeLAnnee = Math.floor((Date.now() - debutAnnee.getTime()) / 86400000);
  return RAPPELS_QUOTIDIENS[jourDeLAnnee % RAPPELS_QUOTIDIENS.length];
}

exports.handler = async () => {
  const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!FIREBASE_DB_URL || !FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.error("Configuration serveur incomplète (identifiants Firebase manquants).");
    return { statusCode: 500, body: "" };
  }

  const { titre, corps } = messageDuJour();

  try {
    const accessToken = await obtenirAccessToken(FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY);

    const resp = await fetch(`${FIREBASE_DB_URL}/users.json?shallow=false&access_token=${accessToken}`);
    const users = (await resp.json()) || {};
    const uids = Object.keys(users);
    const tokens = uids.map(uid => users[uid] && users[uid].fcmToken).filter(Boolean);

    if (uids.length === 0) {
      return { statusCode: 200, body: "" };
    }

    // Pastille en app pour tout le monde, avec ou sans push actif (même logique que
    // envoyer-notification.js), pour que le rappel reste visible même sans notification système.
    const maintenant = Date.now();
    await Promise.all(uids.map(uid =>
      fetch(`${FIREBASE_DB_URL}/notifications/${uid}.json?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titre, corps, lu: false, date: maintenant })
      }).catch(() => {})
    ));

    const resultats = await Promise.all(tokens.map(t => envoyerAUnToken(FIREBASE_PROJECT_ID, accessToken, t, titre, corps)));
    console.log("Rappel quotidien envoyé :", resultats.filter(Boolean).length, "/", tokens.length);
    return { statusCode: 200, body: "" };
  } catch (e) {
    console.error("Erreur rappel quotidien :", e.message || e);
    return { statusCode: 500, body: "" };
  }
};
