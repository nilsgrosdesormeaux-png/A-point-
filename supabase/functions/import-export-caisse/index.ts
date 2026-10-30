// Edge Function : repli pour les caisses sans API (Bimedia, Crisalid,
// Toporder, Tactill…). La caisse envoie chaque jour son export CSV des
// ventes à l'adresse personnelle du commerçant (ADRESSE_IMPORT avec
// +<jeton>, voir connecter-caisse) ; le service d'e-mail entrant
// (Postmark Inbound) transmet l'e-mail ici en JSON.
//
// Format attendu : webhook Postmark Inbound
//   { MailboxHash: '<jeton>', Attachments: [{ Name, ContentType, Content (base64) }] }
// MailboxHash est la partie après le « + » de l'adresse.
//
// Déploiement : supabase functions deploy import-export-caisse --no-verify-jwt
// URL du webhook à donner à Postmark :
//   https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/import-export-caisse?cle=<CLE_IMPORT_EMAIL>
//
// Répond toujours 200 une fois authentifié (même sans pièce jointe
// lisible), sinon Postmark renverrait l'e-mail en boucle ; l'erreur est
// visible dans Paramètres (connexions_caisse.derniere_erreur).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { agregerLignes, ajouterJours, jourParis } from '../_shared/caisse/commun.ts';
import { lignesDepuisExport, lignesDepuisTableau } from '../_shared/caisse/export-csv.ts';
import * as XLSX from 'npm:xlsx@0.18.5';

function octetsBase64(base64: string): Uint8Array {
  var bin = atob(base64);
  var octets = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return octets;
}

// Excel (.xlsx, .xls) : première feuille, lue comme un tableau.
function tableauExcel(base64: string): unknown[][] {
  var classeur = XLSX.read(octetsBase64(base64), { type: 'array' });
  return XLSX.utils.sheet_to_json(classeur.Sheets[classeur.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
}

function decoderPieceJointe(base64: string): string {
  var octets = octetsBase64(base64);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch (_e) {
    // Beaucoup de caisses françaises exportent encore en Windows-1252.
    return new TextDecoder('windows-1252').decode(octets);
  }
}

// Export envoyé le matin : ventes de la veille. L'après-midi ou le soir
// (export de clôture) : ventes du jour. Ne sert que si le fichier n'a pas
// de colonne date.
function jourParDefaut(maintenant: Date): string {
  var heureParis = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(maintenant));
  var jour = jourParis(maintenant);
  return heureParis < 12 ? ajouterJours(jour, -1) : jour;
}

Deno.serve(async (req) => {
  var cleAttendue = Deno.env.get('CLE_IMPORT_EMAIL');
  if (!cleAttendue || new URL(req.url).searchParams.get('cle') !== cleAttendue) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401 });
  }
  var admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  var email = await req.json().catch(function () { return {}; });
  var jeton = String(email.MailboxHash || '').trim();
  if (!jeton) return new Response(JSON.stringify({ ignore: 'adresse sans jeton' }), { status: 200 });

  var cx = await admin.from('connexions_caisse').select('*').eq('fournisseur', 'export_email').eq('jeton_import', jeton).maybeSingle();
  if (!cx.data) return new Response(JSON.stringify({ ignore: 'jeton inconnu' }), { status: 200 });

  var lignes: any[] = [];
  var erreurs: string[] = [];
  (email.Attachments || []).forEach(function (pj: any) {
    if (!pj.Content) return;
    var estExcel = /\.xlsx?$/i.test(pj.Name || '') || /spreadsheet|excel/i.test(pj.ContentType || '');
    var estCsv = /\.(csv|txt)$/i.test(pj.Name || '') || /csv|text\/plain/i.test(pj.ContentType || '');
    if (!estCsv && !estExcel) return;
    var lu;
    try {
      lu = estExcel
        ? lignesDepuisTableau(tableauExcel(pj.Content), jourParDefaut(new Date()))
        : lignesDepuisExport(decoderPieceJointe(pj.Content), jourParDefaut(new Date()));
    } catch (e) {
      erreurs.push(pj.Name + ' : fichier illisible');
      return;
    }
    if (lu.erreur) erreurs.push(pj.Name + ' : ' + lu.erreur);
    lignes = lignes.concat(lu.lignes);
  });

  var maj: Record<string, unknown> = { derniere_synchro: new Date().toISOString() };
  var agregees = agregerLignes(lignes);
  if (agregees.length > 0) {
    var rpc = await admin.rpc('enregistrer_ventes_caisse', { p_commercant: cx.data.commercant_id, p_lignes: agregees, p_source: 'export_email' });
    if (rpc.error) erreurs.push(rpc.error.message);
    maj.nb_lignes_derniere_synchro = rpc.data || 0;
    maj.derniere_date_synchronisee = agregees.map(function (l) { return l.date_vente; }).sort().pop();
  } else if (erreurs.length === 0) {
    erreurs.push('Aucun fichier de ventes (CSV ou Excel) dans l\'e-mail reçu');
  }
  maj.statut = erreurs.length ? 'erreur' : 'active';
  maj.derniere_erreur = erreurs.length ? erreurs.join(' ; ').slice(0, 500) : null;
  await admin.from('connexions_caisse').update(maj).eq('commercant_id', cx.data.commercant_id).eq('fournisseur', 'export_email');

  return new Response(JSON.stringify({ lignes: agregees.length, erreurs: erreurs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
