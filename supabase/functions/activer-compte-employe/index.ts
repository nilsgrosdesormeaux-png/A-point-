// Edge Function : marque le compte d'un employe comme actif une fois qu'il
// a choisi son mot de passe (etape 7 du cahier des charges).
//
// Appelee depuis reinitialiser-mot-de-passe.html juste apres
// auth.updateUser({ password }), uniquement si les metadonnees du compte
// indiquent role: 'employe' (poses par inviter-employe a la creation).
//
// Passe par une Edge Function (service role) plutot qu'un update direct
// depuis le client car aucune policy RLS n'autorise un employe a modifier
// statut_compte lui meme (volontaire : seul le commercant ou ce flux
// serveur peuvent changer ce statut).
//
// Deploiement : supabase functions deploy activer-compte-employe

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Methode non supportee' }), { status: 405 });
    }

    var SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    var SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    var authHeader = req.headers.get('Authorization') || '';
    var clientAppelant = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } }
    });
    var utilisateur = await clientAppelant.auth.getUser();
    if (utilisateur.error || !utilisateur.data.user) {
      return new Response(JSON.stringify({ error: 'Non authentifie' }), { status: 401 });
    }

    var metadonnees = utilisateur.data.user.user_metadata || {};
    if (metadonnees.role !== 'employe') {
      // Rien a faire pour un compte patron : reponse neutre, jamais une
      // erreur (ce flux est aussi appele depuis le meme formulaire pour un
      // patron qui reinitialise son propre mot de passe).
      return new Response(JSON.stringify({ ok: true, estEmploye: false }), { status: 200 });
    }

    var clientAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    var maj = await clientAdmin.from('personnel').update({ statut_compte: 'actif' }).eq('user_id', utilisateur.data.user.id);
    if (maj.error) {
      return new Response(JSON.stringify({ error: maj.error.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, estEmploye: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (erreur) {
    return new Response(JSON.stringify({ error: String(erreur) }), { status: 500 });
  }
});
