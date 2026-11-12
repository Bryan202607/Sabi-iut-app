// Webhook NotchPay : NotchPay appelle CE serveur dès qu'un paiement change d'état — même si
// l'étudiant ferme la page, perd sa connexion ou ne revient jamais dans l'appli.
// URL à déclarer dans NotchPay (Réglages > Webhooks) :
//   https://sabi-iut-fv.netlify.app/.netlify/functions/webhook-notchpay   (événement : payment.complete)
//
// Sécurité : 1) signature HMAC-SHA256 vérifiée avec le "Hash Key" du webhook ; 2) le contenu du
// webhook ne sert que de déclencheur — le vrai statut et le montant sont relus chez NotchPay avec
// la clé secrète avant toute activation (voir confirmerPaiement).
const crypto = require("crypto");
const S = require("./lib/sabi-paiement");

function signatureValide(brut, recu, hash) {
  if (!recu) return false;
  const candidats = [brut];
  try { candidats.push(JSON.stringify(JSON.parse(brut))); } catch { /* corps non JSON */ }
  return candidats.some(txt => {
    const attendu = crypto.createHmac("sha256", hash).update(txt).digest("hex");
    const a = Buffer.from(attendu), b = Buffer.from(String(recu).trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Méthode non autorisée." };

  const c = S.config();
  const absents = S.manquants(c, ["notchSecret", "notchHash", "dbUrl", "clientEmail", "privateKey"]);
  if (absents.length) return { statusCode: 500, body: "Configuration serveur incomplète : " + absents.join(", ") };

  const brut = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const signature = event.headers["x-notch-signature"] || event.headers["X-Notch-Signature"];
  if (!signatureValide(brut, signature, c.notchHash)) return { statusCode: 401, body: "Signature invalide." };

  let evt;
  try { evt = JSON.parse(brut); } catch { return { statusCode: 400, body: "JSON invalide." }; }
  const type = String(evt.type || evt.event || "");
  if (!type.startsWith("payment")) return { statusCode: 200, body: "Événement ignoré." };

  const data = evt.data || {};
  const tx = data.transaction || data.payment || data;
  const candidats = [tx.merchant_reference, tx.trxref, data.merchant_reference, data.trxref, tx.reference, data.reference]
    .filter(x => typeof x === "string" && x);

  try {
    // Notre référence commence par "pay-" ; sinon on retrouve le paiement par sa référence NotchPay (trx.xxx).
    let ref = candidats.find(x => /^pay-[\w-]+$/.test(x));
    if (!ref) {
      for (const notchRef of candidats) {
        const trouve = await S.db(c, "GET", `paiements.json?orderBy="notchRef"&equalTo=${JSON.stringify(notchRef)}`.replace(/\.json$/, ""));
        const cle = trouve && Object.keys(trouve)[0];
        if (cle) { ref = cle; break; }
      }
    }
    if (!ref) return { statusCode: 200, body: "Paiement inconnu (ignoré)." };

    const r = await S.confirmerPaiement(c, ref, "webhook");
    return { statusCode: 200, body: r.message };
  } catch (err) {
    // 500 → NotchPay réessaiera plus tard (le traitement est idempotent).
    return { statusCode: 500, body: "Erreur : " + (err && err.message) };
  }
};
