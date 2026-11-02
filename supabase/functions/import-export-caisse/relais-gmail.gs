// Relais gratuit « export de caisse par e-mail » : la boîte Gmail existante
// du fondateur (apointapp.contact@gmail.com) remplace Postmark Inbound.
// Aucun nom de domaine, aucun compte payant, aucun filtre Gmail à créer.
//
// Principe : chaque boulangerie reçoit l'adresse
// apointapp.contact+caisse-<jeton>@gmail.com (connecter-caisse, secret
// ADRESSE_IMPORT = apointapp.contact@gmail.com). Gmail livre ces adresses
// « + » dans la boîte habituelle. Ce script Google Apps Script relève la boîte
// toutes les 30 minutes, de 12 h à 23 h (heure de Paris) puis à 4 h : la
// journée de vente est finie, ou presque. Il ne regarde QUE les e-mails
// adressés à « +caisse-… » (le courrier ordinaire n'est jamais touché, ni
// marqué lu), transmet leurs pièces jointes (tableau CSV/Excel, PDF, photo)
// et le texte du message à l'Edge Function import-export-caisse au format
// Postmark ({ MailboxHash, TextBody?, Attachments: [{ Name, ContentType,
// Content (base64) }] }), puis les range sous l'étiquette « A Point ventes »,
// lus et archivés. Les tableaux sont importés tout de suite ; photos, PDF et
// texte sont lus par l'IA puis proposés au boulanger « à confirmer ».
//
// Mise en service : docs/vente/guide-comptes-caisse.md (moins de 10 minutes).
// Quotas Apps Script gratuits : largement assez pour plusieurs centaines de
// boulangeries (un appel par e-mail reçu).

var JETON = /\+caisse-([a-f0-9]{16})@/i;
var EXTENSIONS = /\.(csv|txt|tsv|xlsx|xlsm|xls|ods|pdf|jpe?g|png|webp|gif)$/i;
var TYPES = /csv|excel|spreadsheet|text\/plain|pdf|image\/(jpeg|jpg|png|webp|gif)/i;
// Les petites images (logos, signatures) ne sont jamais des rapports ; les
// fichiers de plus de 5 Mo dépassent ce que l'Edge Function accepte.
var TAILLE_MIN_IMAGE = 30000;
var TAILLE_MAX = 5000000;
// Relevé : toutes les 30 minutes, mais seulement de 12 h à 23 h et à 4 h.
var HEURES_RELEVE = [4, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
var ETIQUETTE = 'A Point ventes';
// E-mails non lus des 3 derniers jours (avec ou sans pièce jointe : un
// rapport peut être collé dans le texte) ; le tri « +caisse- » se fait dans
// le script (la recherche Gmail ne sait pas filtrer sur une partie d'adresse
// de façon fiable).
var RECHERCHE = 'is:unread newer_than:3d';

function installer() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'relayer' || t.getHandlerFunction() === 'relayerPlanifie') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('relayerPlanifie').timeBased().everyMinutes(30).create();
  relayer();
}

// Appelée par le déclencheur : ne travaille qu'aux heures de relevé.
// Pour relever tout de suite, lancer « relayer » à la main.
function relayerPlanifie() {
  var heure = Number(Utilities.formatDate(new Date(), 'Europe/Paris', 'H'));
  if (HEURES_RELEVE.indexOf(heure) === -1) return;
  relayer();
}

function jetonDuMessage(m) {
  var entetes = ['Delivered-To', 'X-Original-To', 'To', 'Cc'];
  for (var i = 0; i < entetes.length; i++) {
    var valeur = entetes[i] === 'To' ? m.getTo() : (entetes[i] === 'Cc' ? m.getCc() : m.getHeader(entetes[i]));
    var trouve = JETON.exec(valeur || '');
    if (trouve) return trouve[1].toLowerCase();
  }
  return '';
}

function relayer() {
  var url = PropertiesService.getScriptProperties().getProperty('URL_IMPORT');
  if (!url) throw new Error('Propriété du script URL_IMPORT manquante');
  var etiquette = GmailApp.getUserLabelByName(ETIQUETTE) || GmailApp.createLabel(ETIQUETTE);
  // Les exports quotidiens d'une même caisse ont souvent le même objet :
  // Gmail les range dans un seul fil. On travaille donc message par message
  // (lu / non lu), jamais par fil.
  GmailApp.search(RECHERCHE, 0, 300).forEach(function (fil) {
    var tousTraites = true;
    var aCaisse = false;
    fil.getMessages().forEach(function (m) {
      var jeton = jetonDuMessage(m);
      if (!jeton) { tousTraites = false; return; } // courrier ordinaire : on n'y touche pas
      aCaisse = true;
      if (!m.isUnread()) return;
      var pieces = m.getAttachments({ includeInlineImages: true }).filter(function (pj) {
        var octets = pj.getBytes();
        var image = /^image\//i.test(pj.getContentType() || '');
        if (octets.length > TAILLE_MAX || (image && octets.length < TAILLE_MIN_IMAGE)) return false;
        return EXTENSIONS.test(pj.getName() || '') || TYPES.test(pj.getContentType() || '');
      }).map(function (pj) {
        return { Name: pj.getName(), ContentType: pj.getContentType(), Content: Utilities.base64Encode(pj.getBytes()) };
      });
      var corps = { MailboxHash: 'caisse-' + jeton, Attachments: pieces };
      var texte = typeof m.getPlainBody === 'function' ? String(m.getPlainBody() || '').trim() : '';
      if (texte) corps.TextBody = texte.slice(0, 8000);
      var rep = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify(corps)
      });
      // 2xx : traité (même un fichier illisible est signalé au boulanger sur
      // sa page Ma caisse). Sinon on laisse non lu : nouvel essai au prochain relevé.
      if (rep.getResponseCode() >= 200 && rep.getResponseCode() < 300) m.markRead();
      else { tousTraites = false; console.error('import-export-caisse ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200)); }
    });
    if (!aCaisse) return;
    fil.addLabel(etiquette);
    if (tousTraites) fil.moveToArchive();
  });
}
