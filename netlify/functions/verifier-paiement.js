// Vérification À LA DEMANDE d'un paiement (bouton « Vérifier », retour dans l'appli).
// Sert de filet de sécurité : le chemin principal est le webhook (webhook-notchpay.js).
// L'appelant doit être connecté ET propriétaire du paiement (jeton Firebase vérifié côté serveur).
const S = require("./lib/sabi-paiement");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: S.CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return S.reponse(405, { ok: false, message: "Méthode non autorisée." });

  const c = S.config();
  const absents = S.manquants(c, ["notchSecret", "dbUrl", "clientEmail", "privateKey"]);
  if (absents.length) return S.reponse(500, { ok: false, message: "Configuration serveur incomplète : " + absents.join(", ") + "." });

  let corps;
  try { corps = JSON.parse(event.body || "{}"); } catch { return S.reponse(400, { ok: false, message: "Requête invalide." }); }
  const { idToken, reference } = corps;
  if (!reference || typeof reference !== "string" || !/^[\w-]+$/.test(reference)) {
    return S.reponse(400, { ok: false, message: "Référence de paiement manquante ou invalide." });
  }

  try {
    const user = await S.verifierIdToken(c, idToken);
    if (!user) return S.reponse(401, { ok: false, message: "Session expirée : reconnecte-toi puis réessaie." });

    const paiement = await S.db(c, "GET", `paiements/${reference}`);
    if (!paiement) return S.reponse(404, { ok: false, message: "Paiement introuvable." });
    if (paiement.uid !== user.uid) return S.reponse(403, { ok: false, message: "Ce paiement n'est pas le tien." });

    const r = await S.confirmerPaiement(c, reference, "verification");
    return S.reponse(r.code, { ok: r.ok, message: r.message });
  } catch (err) {
    return S.reponse(502, { ok: false, message: "Erreur de vérification : " + (err && err.message) });
  }
};
