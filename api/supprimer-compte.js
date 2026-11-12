const { envelopper } = require("./_adapter");
const fonction = require("../netlify/functions/supprimer-compte.js");
module.exports = envelopper(fonction.handler);
module.exports.config = { api: { bodyParser: false } };
