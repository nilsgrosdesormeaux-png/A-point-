// Edge Function : repli pour les caisses sans API (Bimedia, Crisalid,
// Toporder, Tactill…). La caisse envoie chaque jour son export CSV des
// ventes à l'adresse personnelle du commerçant (ADRESSE_IMPORT avec
// +<jeton>, voir connecter-caisse) ; le service d'e-mail entrant
// (Postmark Inbound) transmet l'e-mail ici en JSON.
//
// Format attendu : webhook Postmark Inbound, ou le relais Gmail gratuit
// (relais-gmail.gs, même format JSON)
//   { MailboxHash: '<jeton>', TextBody?: '...', Attachments: [{ Name, ContentType, Content (base64) }] }
// MailboxHash est la partie après le « + » de l'adresse.
//
// Boîte universelle : CSV et Excel sont importés tout de suite. Photo, PDF ou
// texte du message (caisses sans export propre) sont lus par l'IA
// (_shared/caisse/lire-rapport.ts, secret ANTHROPIC_API_KEY) et rangés
// « à confirmer » (rapports_a_confirmer) : rien n'entre dans les ventes avant
// que le boulanger ait vérifié et confirmé sur sa page Ma caisse.
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
import { journaliser } from '../_shared/caisse/synchroniser.ts';
import { decoderOctets, lignesDepuisExport, lignesDepuisFeuilles } from '../_shared/caisse/export-csv.ts';
import { type Contenu, MAX_FICHIERS, TAILLE_MAX_BASE64, empreinte, lireRapport, typeLisible } from '../_shared/caisse/lire-rapport.ts';
import { debutJourParisUTC } from '../_shared/caisse/commun.ts';
import * as XLSX from 'npm:xlsx@0.18.5';

function octetsBase64(base64: string): Uint8Array {
  var bin = atob(base64);
  var octets = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return octets;
}

// Excel (.xlsx, .xls) : toutes les feuilles, la première qui contient des ventes est lue.
function feuillesExcel(base64: string): unknown[][][] {
  var classeur = XLSX.read(octetsBase64(base64), { type: 'array' });
  return classeur.SheetNames.map(function (nom: string) {
    return XLSX.utils.sheet_to_json(classeur.Sheets[nom], { header: 1, raw: true }) as unknown[][];
  });
}

// UTF-8, Windows-1252 ou UTF-16 : voir lecture-export.js.
function decoderPieceJointe(base64: string): string {
  return decoderOctets(octetsBase64(base64));
}

// Export envoyé le matin : ventes de la veille. L'après-midi ou le soir
// (export de clôture) : ventes du jour. Ne sert que si le fichier n'a pas
// de colonne date.
function jourParDefaut(maintenant: Date): string {
  var heureParis = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(maintenant));
  var jour = jourParis(maintenant);
  return heureParis < 12 ? ajouterJours(jour, -1) : jour;
}

// Plafond de lectures d'IA par commerçant et par jour (avec lire-ticket).
var PLAFOND_LECTURES_PAR_JOUR = 10;

// Lit photos, PDF et texte avec l'IA et range le résultat « à confirmer ».
async function lireEtRanger(admin: any, commercantId: string, contenus: Contenu[], detail: string): Promise<{ lignes: number; erreur?: string }> {
  var cle = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!cle) return { lignes: 0, erreur: 'Photo ou PDF reçu, mais la lecture automatique n\'est pas encore ouverte : envoie plutôt l\'export en CSV ou Excel' };
  var aujourdhui = jourParis(new Date());
  var deja = await admin.from('lectures_ticket').select('id', { count: 'exact' }).eq('commercant_id', commercantId).gte('cree_le', debutJourParisUTC(aujourdhui));
  if ((deja.count || (deja.data || []).length) >= PLAFOND_LECTURES_PAR_JOUR) {
    return { lignes: 0, erreur: 'Limite de ' + PLAFOND_LECTURES_PAR_JOUR + ' lectures de photo par jour atteinte' };
  }
  try {
    var rapport = await lireRapport(fetch, cle, contenus, aujourdhui);
    await admin.from('lectures_ticket').insert({
      commercant_id: commercantId, nb_photos: contenus.filter(function (c) { return c.type === 'fichier'; }).length || 1,
      jetons_entree: rapport.usage.entree, jetons_sortie: rapport.usage.sortie, cout_estime_usd: rapport.usage.cout_usd,
      date_rapport: rapport.jour, empreinte: await empreinte(contenus)
    });
    if (!rapport.lisible) return { lignes: 0, erreur: 'Document illisible : ' + rapport.remarques };
    var ins = await admin.from('rapports_a_confirmer').insert({
      commercant_id: commercantId, source: 'email', jour: rapport.jour, lignes: rapport.lignes,
      remarques: rapport.remarques || null, detail: detail.slice(0, 200) || null
    });
    if (ins.error) return { lignes: 0, erreur: 'Rapport lu mais non rangé (' + ins.error.message + ')' };
    return { lignes: rapport.lignes.length };
  } catch (e) {
    return { lignes: 0, erreur: String((e as Error).message || e) };
  }
}

Deno.serve(async (req) => {
  var cleAttendue = Deno.env.get('CLE_IMPORT_EMAIL');
  if (!cleAttendue || new URL(req.url).searchParams.get('cle') !== cleAttendue) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401 });
  }
  var admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  var email = await req.json().catch(function () { return {}; });
  // Partie après le « + » : « caisse-<jeton> » (adresses depuis la v4) ou « <jeton ».
  var jeton = String(email.MailboxHash || '').trim().toLowerCase().replace(/^caisse-/, '');
  if (!jeton) return new Response(JSON.stringify({ ignore: 'adresse sans jeton' }), { status: 200 });

  var cx = await admin.from('connexions_caisse').select('*').eq('fournisseur', 'export_email').eq('jeton_import', jeton).maybeSingle();
  if (!cx.data) return new Response(JSON.stringify({ ignore: 'jeton inconnu' }), { status: 200 });

  var lignes: any[] = [];
  var erreurs: string[] = [];
  var aLire: Contenu[] = [];
  (email.Attachments || []).forEach(function (pj: any) {
    if (!pj.Content) return;
    var estExcel = /\.(xlsx?|xlsm|ods)$/i.test(pj.Name || '') || /spreadsheet|excel/i.test(pj.ContentType || '');
    var estCsv = /\.(csv|txt|tsv)$/i.test(pj.Name || '') || /csv|text\/plain/i.test(pj.ContentType || '');
    if (!estCsv && !estExcel) {
      // Photo ou PDF : lecture par l'IA, à confirmer.
      var type = typeLisible(pj.ContentType, pj.Name);
      if (type && String(pj.Content).length <= TAILLE_MAX_BASE64 && aLire.length < MAX_FICHIERS) {
        aLire.push({ type: 'fichier', media_type: type, data: String(pj.Content) });
      }
      return;
    }
    var lu;
    try {
      lu = estExcel
        ? lignesDepuisFeuilles(feuillesExcel(pj.Content), jourParDefaut(new Date()))
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
  var aConfirmer = 0;
  // Rien d'importable en tableau : photo, PDF ou texte du message, lus par l'IA.
  var texteMessage = String(email.TextBody || '').trim();
  if (agregees.length === 0 && erreurs.length === 0 && (aLire.length > 0 || texteMessage.length >= 30)) {
    if (texteMessage.length >= 30) aLire.push({ type: 'texte', texte: texteMessage });
    var resumeLecture = await lireEtRanger(admin, cx.data.commercant_id, aLire, (email.Attachments || []).map(function (pj: any) { return pj.Name; }).filter(Boolean).join(', '));
    if (resumeLecture.erreur) erreurs.push(resumeLecture.erreur);
    aConfirmer = resumeLecture.lignes;
  }
  if (agregees.length > 0) {
    var rpc = await admin.rpc('enregistrer_ventes_caisse', { p_commercant: cx.data.commercant_id, p_lignes: agregees, p_source: 'export_email' });
    if (rpc.error) erreurs.push(rpc.error.message);
    maj.nb_lignes_derniere_synchro = rpc.data || 0;
    maj.derniere_date_synchronisee = agregees.map(function (l) { return l.date_vente; }).sort().pop();
  } else if (erreurs.length === 0 && aConfirmer === 0) {
    erreurs.push('Aucun fichier de ventes (CSV, Excel, PDF ou photo) dans l\'e-mail reçu');
  }
  maj.statut = erreurs.length ? 'erreur' : 'active';
  maj.derniere_erreur = erreurs.length ? erreurs.join(' ; ').slice(0, 500) : null;
  await admin.from('connexions_caisse').update(maj).eq('commercant_id', cx.data.commercant_id).eq('fournisseur', 'export_email');
  var jours = agregees.map(function (l) { return l.date_vente; }).sort();
  await journaliser(admin, {
    commercant_id: cx.data.commercant_id, source: 'email', fournisseur: 'export_email',
    nb_ventes: Number(maj.nb_lignes_derniere_synchro) || 0, du: jours[0] || null, au: jours[jours.length - 1] || null,
    erreur: maj.derniere_erreur || null,
    detail: aConfirmer > 0
      ? ('À confirmer sur ta page Ma caisse : ' + aConfirmer + ' articles lus')
      : ((email.Attachments || []).map(function (pj: any) { return pj.Name; }).filter(Boolean).join(', ').slice(0, 200) || null)
  });

  return new Response(JSON.stringify({ lignes: agregees.length, a_confirmer: aConfirmer, erreurs: erreurs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
