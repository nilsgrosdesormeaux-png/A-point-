// Relais gratuit « export de caisse par e-mail » : une boîte Gmail ordinaire
// remplace Postmark Inbound. Aucun nom de domaine, aucun compte payant.
//
// Principe : chaque boulangerie reçoit l'adresse <boite>+<jeton>@gmail.com
// (connecter-caisse, secret ADRESSE_IMPORT = <boite>@gmail.com). Gmail livre
// tout dans la même boîte. Ce script Google Apps Script tourne toutes les
// 10 minutes, lit les e-mails non lus avec pièce jointe, retrouve le jeton
// dans l'adresse de destination et transmet les pièces jointes à l'Edge
// Function import-export-caisse, au même format JSON que Postmark
// ({ MailboxHash, Attachments: [{ Name, ContentType, Content (base64) }] }) :
// la fonction n'a pas à changer.
//
// Mise en service (10 minutes, voir supabase/functions/README-caisse.md) :
//  1. Créer une adresse Gmail dédiée (ex. apoint.ventes@gmail.com).
//  2. Connecté avec elle : script.google.com > Nouveau projet > coller ce fichier.
//  3. Paramètres du projet > Propriétés du script : URL_IMPORT =
//     https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/import-export-caisse?cle=<CLE_IMPORT_EMAIL>
//  4. Exécuter une fois « installer » et accepter les autorisations Gmail.
//  5. Secret Supabase ADRESSE_IMPORT = apoint.ventes@gmail.com.
//
// Quotas Apps Script gratuits (compte Gmail) : largement assez pour
// plusieurs centaines de boulangeries (un appel par e-mail reçu).

var JETON = /\+([a-f0-9]{16})@/i;
var EXTENSIONS = /\.(csv|txt|tsv|xlsx|xlsm|xls|ods)$/i;

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
  // Les exports quotidiens d'une même caisse ont souvent le même objet :
  // Gmail les range dans un seul fil. On travaille donc message par message
  // (lu / non lu), jamais par fil.
  var fils = GmailApp.search('is:unread has:attachment newer_than:14d', 0, 100);
  fils.forEach(function (fil) {
    fil.getMessages().forEach(function (m) {
      if (!m.isUnread()) return;
      var jeton = jetonDuMessage(m);
      if (!jeton) { m.markRead(); return; } // pas une adresse d'import
      var pieces = m.getAttachments({ includeInlineImages: false }).filter(function (pj) {
        return EXTENSIONS.test(pj.getName() || '') || /csv|excel|spreadsheet|text\/plain/i.test(pj.getContentType() || '');
      }).map(function (pj) {
        return { Name: pj.getName(), ContentType: pj.getContentType(), Content: Utilities.base64Encode(pj.getBytes()) };
      });
      var rep = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ MailboxHash: jeton, Attachments: pieces })
      });
      // 2xx : traité (même un fichier illisible est signalé au commerçant
      // sur sa page Ma caisse). Sinon on laisse non lu : nouvel essai au passage suivant.
      if (rep.getResponseCode() >= 200 && rep.getResponseCode() < 300) m.markRead();
      else console.error('import-export-caisse ' + rep.getResponseCode() + ' ' + rep.getContentText().slice(0, 200));
    });
  });
}
