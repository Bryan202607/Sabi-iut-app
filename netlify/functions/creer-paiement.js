// Crée un paiement NotchPay pour un pack Sabi Pro / Pro+.
// L'appli envoie UNIQUEMENT { idToken, tier, duree } : le prix est calculé ici (tarif + promo lue
// dans Firebase), jamais fourni par le client — impossible de payer 1 FCFA un abonnement à 2000.
const S = require("./lib/sabi-paiement");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: S.CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return S.reponse(405, { ok: false, message: "Méthode non autorisée." });

  const c = S.config();
  const absents = S.manquants(c, ["notchSecret", "dbUrl", "clientEmail", "privateKey"]);
  if (absents.length) return S.reponse(500, { ok: false, message: "Configuration serveur incomplète : " + absents.join(", ") + "." });

  let corps;
  try { corps = JSON.parse(event.body || "{}"); } catch { return S.reponse(400, { ok: false, message: "Requête invalide." }); }
  const { idToken, tier, duree } = corps;
  if (!S.PRIX[tier] || !S.PRIX[tier][duree]) return S.reponse(400, { ok: false, message: "Pack inconnu." });

  try {
    const user = await S.verifierIdToken(c, idToken);
    if (!user) return S.reponse(401, { ok: false, message: "Session expirée : reconnecte-toi puis réessaie." });

    const promo = await S.db(c, "GET", `promotions/${tier}/${duree}`);
    const { effectif } = S.prixAttendu(tier, duree, promo);

    const ref = "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await S.db(c, "PUT", `paiements/${ref}`, {
      uid: user.uid, tier, duree, montant: effectif, statut: "en_attente", timestamp: Date.now()
    });

    const resp = await fetch("https://api.notchpay.co/payments", {
      method: "POST",
      headers: { Authorization: c.notchSecret, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        amount: effectif,
        currency: "XAF",
        email: user.email || undefined,
        reference: ref,
        description: "Sabi " + (tier === "proplus" ? "Pro+" : "Pro") + " — " + (duree === "annee" ? "annuel" : "semestre"),
        callback: c.siteUrl + "/?paiement=retour&ref=" + ref
      })
    });
    let data = null;
    try { data = await resp.json(); } catch { /* non JSON */ }

    if (!resp.ok || !data || !data.authorization_url) {
      await S.db(c, "PATCH", `paiements/${ref}`, { statut: "echec_creation" });
      return S.reponse(502, { ok: false, message: "NotchPay a refusé la création du paiement" + (data && data.message ? " : " + data.message : " (HTTP " + resp.status + ")") + "." });
    }

    // Référence NotchPay (trx.xxx) : dans la réponse, sinon extraite de l'adresse de paiement.
    let notchRef = data.transaction && data.transaction.reference;
    if (!notchRef) {
      const m = String(data.authorization_url).match(/\/(trx[._][\w.-]+)/i);
      if (m) notchRef = m[1];
    }
    if (notchRef) await S.db(c, "PATCH", `paiements/${ref}`, { notchRef });
    return S.reponse(200, { ok: true, reference: ref, authorization_url: data.authorization_url, montant: effectif });
  } catch (err) {
    return S.reponse(502, { ok: false, message: "Erreur serveur : " + (err && err.message) });
  }
};
