// Edge Function : synchro nocturne des caisses vers `ventes`.
//
// Appelée par pg_cron toutes les 10 minutes la nuit (voir la fin de
// migration-connecteurs-caisse.sql), jamais par le navigateur. Chaque appel
// traite les connexions pas encore synchronisées aujourd'hui, en commençant
// par les plus anciennes, et s'arrête avant la limite de durée d'une Edge
// Function : l'appel suivant reprend où celui-ci s'est arrêté.
//
// Déploiement : supabase functions deploy synchro-caisse --no-verify-jwt
// (l'appel pg_cron s'authentifie par l'en-tête x-cle-synchro).
//
// Secrets : CLE_SYNCHRO_CAISSE, CLE_CHIFFREMENT_CAISSE, SUMUP_CLIENT_ID, SUMUP_CLIENT_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { debutJourParisUTC, jourParis } from '../_shared/caisse/commun.ts';
import { synchroniserConnexion } from '../_shared/caisse/synchroniser.ts';

var BUDGET_MS = 110000;

Deno.serve(async (req) => {
  var cleAttendue = Deno.env.get('CLE_SYNCHRO_CAISSE');
  if (!cleAttendue || req.headers.get('x-cle-synchro') !== cleAttendue) {
    return new Response(JSON.stringify({ error: 'Non autorise' }), { status: 401 });
  }
  var debutAppel = Date.now();
  var admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  var env = {
    cleChiffrement: Deno.env.get('CLE_CHIFFREMENT_CAISSE') || '',
    sumupClientId: Deno.env.get('SUMUP_CLIENT_ID') || '',
    sumupClientSecret: Deno.env.get('SUMUP_CLIENT_SECRET') || ''
  };

  var debutJournee = debutJourParisUTC(jourParis(new Date()));
  var aFaire = await admin.from('connexions_caisse').select('*')
    .eq('fournisseur', 'sumup')
    .or('derniere_synchro.is.null,derniere_synchro.lt.' + debutJournee)
    .order('derniere_synchro', { ascending: true, nullsFirst: true })
    .limit(200);
  if (aFaire.error) {
    return new Response(JSON.stringify({ error: aFaire.error.message }), { status: 500 });
  }

  var bilan = { traitees: 0, erreurs: 0, restantes: 0 };
  for (var i = 0; i < aFaire.data.length; i++) {
    if (Date.now() - debutAppel > BUDGET_MS) {
      bilan.restantes = aFaire.data.length - i;
      break;
    }
    var resultat = await synchroniserConnexion(admin, aFaire.data[i], env, fetch, undefined, debutAppel + BUDGET_MS);
    bilan.traitees++;
    if (!resultat.ok) {
      bilan.erreurs++;
      console.error('synchro-caisse', aFaire.data[i].commercant_id, resultat.erreur);
    }
  }
  return new Response(JSON.stringify(bilan), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
