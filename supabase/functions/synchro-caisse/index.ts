// Edge Function : synchro en continu des caisses branchées vers `ventes`.
//
// Appelée par pg_cron chaque minute (migration-connecteurs-caisse-v2.sql),
// jamais par le navigateur. Chaque appel réserve les caisses en retard
// (prendre_connexions_caisse : historique de 12 mois en cours d'import, ou
// journée d'hier pas encore lue), les avance jour par jour et s'arrête avant
// la limite de durée d'une Edge Function. Deux appels qui se chevauchent ne
// prennent jamais la même caisse. Sans retard, l'appel ne fait qu'une requête.
//
// Déploiement : supabase functions deploy synchro-caisse --no-verify-jwt
// (l'appel pg_cron s'authentifie par l'en-tête x-cle-synchro, comparé au
// secret Vault « cle_synchro_caisse » par la fonction SQL verifier_cle_synchro :
// la clé ne quitte jamais la base).
//
// Secrets : CLE_CHIFFREMENT_CAISSE, <CAISSE>_CLIENT_ID et <CAISSE>_CLIENT_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ajouterJours, jourParis } from '../_shared/caisse/commun.ts';
import { synchroniserConnexion } from '../_shared/caisse/synchroniser.ts';

var BUDGET_MS = 110000;

Deno.serve(async (req) => {
  var debutAppel = Date.now();
  var admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  var verif = await admin.rpc('verifier_cle_synchro', { p_cle: req.headers.get('x-cle-synchro') || '' });
  if (verif.error || verif.data !== true) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401 });
  }
  var env = {
    cleChiffrement: Deno.env.get('CLE_CHIFFREMENT_CAISSE') || '',
    lireEnv: function (cle: string) { return Deno.env.get(cle); }
  };
  var hier = ajouterJours(jourParis(new Date()), -1);

  var bilan = { traitees: 0, erreurs: 0, lignes: 0 };
  while (Date.now() - debutAppel < BUDGET_MS) {
    var lot = await admin.rpc('prendre_connexions_caisse', { p_hier: hier, p_limite: 3 });
    if (lot.error) return new Response(JSON.stringify({ error: lot.error.message }), { status: 500 });
    if (!lot.data || lot.data.length === 0) break;
    // Les caisses d'un lot avancent en parallèle, chacune jusqu'au budget.
    var resultats = await Promise.all(lot.data.map(function (connexion: any) {
      return synchroniserConnexion(admin, connexion, env, fetch, undefined, debutAppel + BUDGET_MS);
    }));
    resultats.forEach(function (r: any, i: number) {
      bilan.traitees++;
      bilan.lignes += r.lignes || 0;
      if (!r.ok) {
        bilan.erreurs++;
        console.error('synchro-caisse', lot.data[i].fournisseur, lot.data[i].commercant_id, r.erreur);
      }
    });
  }
  return new Response(JSON.stringify(bilan), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
