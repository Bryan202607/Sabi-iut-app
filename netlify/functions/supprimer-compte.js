// Suppression définitive d'un compte étudiant, réservée au propriétaire de Sabi.
// Efface : le compte de connexion (Firebase Authentication), le profil, la progression, les
// notifications, la messagerie d'assistance, les scores, le classement hebdomadaire, l'entrée de
// l'index des matricules et les demandes en attente de cet étudiant.
// Conservé volontairement : les traces de paiement (/paiements), exigées pour la comptabilité.
// Le propriétaire est identifié côté serveur par son jeton de connexion : l'appli ne décide de rien.
const S = require("./lib/sabi-paiement");

// Mêmes adresses que OWNER_EMAILS dans index.html. Peut être surchargé par la variable
// d'environnement OWNER_EMAILS (adresses séparées par des virgules).
const PROPRIETAIRES = (process.env.OWNER_EMAILS || "bryansikame2026@gmail.com,bryansikame2025@gmail.com")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// Nœuds Firebase organisés par uid : on efface directement /noeud/{uid}.
const NOEUDS_PAR_UID = ["users", "notifications", "support", "myscore"];
// Collections de demandes : chaque entrée contient un champ "uid" ; on supprime celles de l'étudiant.
const COLLECTIONS_DEMANDES = ["abonnementDemandes", "vipDemandes", "demandesAnnee", "demandesFiliere", "demandesMatricule"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: S.CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return S.reponse(405, { ok: false, message: "Méthode non autorisée." });

  const c = S.config();
  const absents = S.manquants(c, ["dbUrl", "clientEmail", "privateKey"]);
  if (absents.length) return S.reponse(500, { ok: false, message: "Configuration serveur incomplète : " + absents.join(", ") + "." });

  let corps;
  try { corps = JSON.parse(event.body || "{}"); } catch { return S.reponse(400, { ok: false, message: "Requête invalide." }); }
  const { idToken, uid } = corps;
  if (!uid || typeof uid !== "string" || !/^[\w-]{6,128}$/.test(uid)) return S.reponse(400, { ok: false, message: "Identifiant de compte invalide." });

  try {
    // 1) L'appelant doit être le propriétaire (jeton vérifié par Google, adresse comparée à la liste).
    const appelant = await S.verifierIdToken(c, idToken);
    if (!appelant || !PROPRIETAIRES.includes(String(appelant.email || "").toLowerCase())) {
      return S.reponse(403, { ok: false, message: "Réservé au propriétaire de Sabi." });
    }
    if (appelant.uid === uid) return S.reponse(400, { ok: false, message: "Tu ne peux pas supprimer ton propre compte propriétaire ici." });

    const jeton = await S.obtenirAccessToken(c);
    const pid = S.projetId(c);
    if (!pid) return S.reponse(500, { ok: false, message: "Identifiant de projet Firebase introuvable (FIREBASE_PROJECT_ID)." });

    // 2) Garde-fous : on ne supprime jamais un propriétaire ni un administrateur.
    const profil = await S.db(c, "GET", `users/${uid}`);
    if (profil && profil.admin) return S.reponse(400, { ok: false, message: "Retire d'abord le rôle admin de ce compte avant de le supprimer." });
    const consulte = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${pid}/accounts:lookup`, {
      method: "POST",
      headers: { Authorization: "Bearer " + jeton, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: [uid] })
    });
    const infos = consulte.ok ? await consulte.json() : null;
    const emailCible = infos && infos.users && infos.users[0] && String(infos.users[0].email || "").toLowerCase();
    if (emailCible && PROPRIETAIRES.includes(emailCible)) return S.reponse(400, { ok: false, message: "Un compte propriétaire ne peut pas être supprimé." });

    // 3) Données : d'abord la base (même si le compte de connexion n'existe plus, on nettoie tout).
    const matricule = profil && profil.matricule;
    for (const noeud of NOEUDS_PAR_UID) await S.db(c, "DELETE", `${noeud}/${uid}`);
    if (matricule) {
      // Même normalisation que l'appli (majuscules + caractères interdits). On ne libère le matricule
      // que s'il pointe bien vers ce compte : jamais celui d'un autre étudiant.
      const cle = String(matricule).trim().toUpperCase().replace(/[.#$/\[\]]/g, "_");
      if ((await S.db(c, "GET", `matriculeIndex/${cle}`)) === uid) await S.db(c, "DELETE", `matriculeIndex/${cle}`);
    }

    const semaines = await S.db(c, "GET", "classementHebdo?shallow=true");
    for (const semaine of Object.keys(semaines || {})) await S.db(c, "DELETE", `classementHebdo/${semaine}/${uid}`);

    for (const collection of COLLECTIONS_DEMANDES) {
      const entrees = await S.db(c, "GET", collection);
      for (const [id, valeur] of Object.entries(entrees || {})) {
        if (valeur && valeur.uid === uid) await S.db(c, "DELETE", `${collection}/${id}`);
      }
    }

    // 4) Compte de connexion (Firebase Authentication). "USER_NOT_FOUND" n'est pas une erreur ici.
    const suppr = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${pid}/accounts:delete`, {
      method: "POST",
      headers: { Authorization: "Bearer " + jeton, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uid })
    });
    if (!suppr.ok) {
      const detail = await suppr.text();
      if (!/USER_NOT_FOUND/.test(detail)) {
        return S.reponse(502, { ok: false, message: "Données effacées, mais le compte de connexion n'a pas pu être supprimé (HTTP " + suppr.status + "). Supprime-le dans Firebase > Authentication. " + detail.slice(0, 160) });
      }
    }

    // 5) Journal minimal : date et auteur, sans aucune donnée personnelle de l'étudiant.
    await S.db(c, "POST", "journalSuppressions", { uid, par: appelant.uid, le: Date.now() }).catch(() => {});
    return S.reponse(200, { ok: true, message: "Compte supprimé définitivement." });
  } catch (err) {
    return S.reponse(502, { ok: false, message: "Erreur serveur : " + (err && err.message) });
  }
};
