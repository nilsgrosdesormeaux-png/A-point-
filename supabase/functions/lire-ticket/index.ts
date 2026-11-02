// Edge Function : lecture d'une photo (ou PDF) du rapport de caisse.
//
// Appelée depuis caisse.html (connecteur-caisse.js) par un commerçant connecté :
//   POST { fichiers: [{ media_type: 'image/jpeg', data: '<base64>' }], texte?: '...' }
//   -> { jour, lignes: [{ nom_produit, quantite }], lisible, remarques, deja_lu, lectures_restantes }
// N'écrit JAMAIS dans `ventes` : le résultat est montré au boulanger, qui le
// corrige puis le confirme (fonction SQL enregistrer_ventes_photo).
// Chaque lecture est tracée dans lectures_ticket (coût estimé) ; plafond de
// lectures par commerçant et par jour.
//
// Déploiement : supabase functions deploy lire-ticket --no-verify-jwt
// (le JWT est vérifié ici, à la main, comme connecter-caisse).
// Secret : ANTHROPIC_API_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { debutJourParisUTC, jourParis } from '../_shared/caisse/commun.ts';
import { type Contenu, MAX_FICHIERS, TAILLE_MAX_BASE64, empreinte, lireRapport, typeLisible } from '../_shared/caisse/lire-rapport.ts';

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
var PLAFOND_LECTURES_PAR_JOUR = 10;

function reponse(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), { status: status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    if (req.method !== 'POST') return reponse({ error: 'Methode non supportee' }, 405);
    var SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    var clientAppelant = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }
    });
    var utilisateur = await clientAppelant.auth.getUser();
    if (utilisateur.error || !utilisateur.data.user) return reponse({ error: 'Non authentifie' }, 401);
    var commercantId = utilisateur.data.user.id;

    var cle = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!cle) return reponse({ error: 'La lecture de photo ouvre très bientôt.' }, 503);

    var corps = await req.json().catch(function () { return {}; });
    var contenus: Contenu[] = [];
    var fichiers = Array.isArray(corps.fichiers) ? corps.fichiers : [];
    if (fichiers.length > MAX_FICHIERS) return reponse({ error: 'Quatre photos au plus à la fois' }, 400);
    for (var i = 0; i < fichiers.length; i++) {
      var type = typeLisible(fichiers[i] && fichiers[i].media_type, '');
      var data = String(fichiers[i] && fichiers[i].data || '');
      if (!type) return reponse({ error: 'Format non lu : envoie une photo (JPEG, PNG) ou un PDF' }, 400);
      if (!data || data.length > TAILLE_MAX_BASE64) return reponse({ error: 'Photo trop lourde (5 Mo au plus)' }, 400);
      contenus.push({ type: 'fichier', media_type: type, data: data });
    }
    if (typeof corps.texte === 'string' && corps.texte.trim()) contenus.push({ type: 'texte', texte: corps.texte.trim() });
    if (!contenus.length) return reponse({ error: 'Rien à lire' }, 400);

    var admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    var maintenant = new Date();
    var aujourdhui = jourParis(maintenant);
    var deja = await admin.from('lectures_ticket').select('id, empreinte', { count: 'exact' })
      .eq('commercant_id', commercantId).gte('cree_le', debutJourParisUTC(aujourdhui));
    var nbAujourdhui = deja.count || (deja.data || []).length;
    if (nbAujourdhui >= PLAFOND_LECTURES_PAR_JOUR) {
      return reponse({ error: 'Tu as atteint la limite de ' + PLAFOND_LECTURES_PAR_JOUR + ' lectures de photo par jour. Réessaie demain, ou dépose le fichier d\'export.' }, 429);
    }

    var sceau = await empreinte(contenus);
    var dejaLu = (deja.data || []).some(function (l: any) { return l.empreinte === sceau; });
    var rapport = await lireRapport(fetch, cle, contenus, aujourdhui);
    await admin.from('lectures_ticket').insert({
      commercant_id: commercantId, nb_photos: fichiers.length || 1,
      jetons_entree: rapport.usage.entree, jetons_sortie: rapport.usage.sortie,
      cout_estime_usd: rapport.usage.cout_usd, date_rapport: rapport.jour, empreinte: sceau
    });
    return reponse({
      jour: rapport.jour, lignes: rapport.lignes, lisible: rapport.lisible, remarques: rapport.remarques,
      deja_lu: dejaLu, lectures_restantes: Math.max(0, PLAFOND_LECTURES_PAR_JOUR - nbAujourdhui - 1)
    });
  } catch (erreur) {
    return reponse({ error: String((erreur as Error).message || erreur) }, 500);
  }
});
