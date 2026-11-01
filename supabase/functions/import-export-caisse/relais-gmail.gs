// Relais gratuit « export de caisse par e-mail » : la boîte Gmail existante
// du fondateur (apointapp.contact@gmail.com) remplace Postmark Inbound.
// Aucun nom de domaine, aucun compte payant, aucun filtre Gmail à créer.
//
// Principe : chaque boulangerie reçoit l'adresse
// apointapp.contact+caisse-<jeton>@gmail.com (connecter-caisse, secret
// ADRESSE_IMPORT = apointapp.contact@gmail.com). Gmail livre ces adresses
// « + » dans la boîte habituelle. Ce script Google Apps Script tourne toutes
// les 10 minutes, ne regarde QUE les e-mails adressés à « +caisse-… » (le
// courrier ordinaire n'est jamais touché, ni marqué lu), transmet leurs
// pièces jointes à l'Edge Function import-export-caisse au format Postmark
// ({ MailboxHash, Attachments: [{ Name, ContentType, Content (base64) }] }),
// puis les range sous l'étiquette « A Point ventes », lus et archivés.
//
// Mise en service : docs/vente/guide-comptes-caisse.md (moins de 10 minutes).
// Quotas Apps Script gratuits : largement assez pour plusieurs centaines de
// boulangeries (un appel par e-mail reçu).

var JETON = /\+caisse-([a-f0-9]{16})@/i;
var EXTENSIONS = /\.(csv|txt|tsv|xlsx|xlsm|xls|ods)$/i;
var ETIQUETTE = 'A Point ventes';
// E-mails non lus avec pièce jointe des 3 derniers jours ; le tri
// « +caisse- » se fait dans le script (la recherche Gmail ne sait pas
// filtrer sur une partie d'adresse de façon fiable).
var RECHERCHE = 'is:unread has:attachment newer_than:3d';

function installer() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'relayer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('relayer').timeBased().everyMinutes(10).create();
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
      var pieces = m.getAttachments({ includeInlineImages: false }).filter(function (pj) {
        return EXTENSIONS.test(pj.getName() || '') || /csv|excel|spreadsheet|text\/plain/i.test(pj.getContentType() || '');
      }).map(function (pj) {
        return { Name: pj.getName(), ContentType: pj.getContentType(), Content: Utilities.base64Encode(pj.getBytes()) };
      });
      var rep = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ MailboxHash: 'caisse-' + jeton, Attachments: pieces })
      });
      // 2xx : traité (même un fichier illisible est signalé au boulanger sur
      // sa page Ma caisse). Sinon on laisse non lu : nouvel essai dans 10 minutes.
      if (rep.getResponseCode() >= 200 && rep.getResponseCode() < 300) m.markRead();
      else { tousTraites = false; console.error('import-export-caisse ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200)); }
    });
    if (!aCaisse) return;
    fil.addLabel(etiquette);
    if (tousTraites) fil.moveToArchive();
  });
}
