// Edge Function : invitation d'un employe (etape 7 du cahier des charges).
//
// Appelee depuis personnel.html quand le patron clique "Inviter" ou
// "Renvoyer l'invitation". Cree (ou reutilise) un compte Supabase Auth pour
// l'employe et lui envoie l'e mail d'invitation standard (definition de mot
// de passe). Doit tourner avec la service role key : jamais exposee cote
// client, c'est pour ca que cette etape ne peut pas se faire directement
// depuis personnel.html avec la cle publique.
//
// Deploiement : supabase functions deploy inviter-employe
//
// Entree JSON attendue : { personnelId: number, email: string }
// Verifie que l'appelant est bien authentifie et qu'il est le commercant
// proprietaire de la ligne personnel visee (jamais un employe, jamais un
// commercant tiers) avant de creer quoi que ce soit.

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Methode non supportee' }), { status: 405 });
    }

    var corps = await req.json();
    var personnelId = corps.personnelId;
    var email = (corps.email || '').trim().toLowerCase();

    if (!personnelId || !email) {
      return new Response(JSON.stringify({ error: 'personnelId et email sont requis' }), { status: 400 });
    }

    var SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    var SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Client "appelant" : verifie qui a appele la fonction (le JWT de la
    // requete), jamais de privilege eleve ici.
    var authHeader = req.headers.get('Authorization') || '';
    var clientAppelant = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } }
    });
    var utilisateur = await clientAppelant.auth.getUser();
    if (utilisateur.error || !utilisateur.data.user) {
      return new Response(JSON.stringify({ error: 'Non authentifie' }), { status: 401 });
    }
    var commercantId = utilisateur.data.user.id;

    // Client admin (service role) : seul habilite a creer des comptes Auth
    // et a lire/ecrire personnel en dehors des policies RLS habituelles.
    var clientAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verifie que la ligne personnel appartient bien a l'appelant, avant de
    // creer ou modifier quoi que ce soit.
    var ligne = await clientAdmin.from('personnel').select('*').eq('id', personnelId).eq('commercant_id', commercantId).single();
    if (ligne.error || !ligne.data) {
      return new Response(JSON.stringify({ error: 'Employe introuvable pour ce commercant' }), { status: 404 });
    }

    var userIdExistant = ligne.data.user_id;

    if (!userIdExistant) {
      // Premiere invitation : cree le compte et envoie l'e mail en une
      // seule etape (inviteUserByEmail cree le compte s'il n'existe pas).
      var invitation = await clientAdmin.auth.admin.inviteUserByEmail(email, {
        data: { role: 'employe', personnel_id: personnelId }
      });
      if (invitation.error) {
        return new Response(JSON.stringify({ error: invitation.error.message }), { status: 400 });
      }
      userIdExistant = invitation.data.user.id;

      var maj = await clientAdmin.from('personnel').update({
        user_id: userIdExistant,
        statut_compte: 'invite'
      }).eq('id', personnelId);
      if (maj.error) {
        return new Response(JSON.stringify({ error: maj.error.message }), { status: 400 });
      }
    } else {
      // Renvoi : le compte existe deja, on renvoie simplement un lien
      // d'invitation (utile si le premier e mail s'est perdu).
      var relance = await clientAdmin.auth.admin.inviteUserByEmail(email);
      if (relance.error) {
        return new Response(JSON.stringify({ error: relance.error.message }), { status: 400 });
      }
      await clientAdmin.from('personnel').update({ statut_compte: 'invite' }).eq('id', personnelId);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (erreur) {
    return new Response(JSON.stringify({ error: String(erreur) }), { status: 500 });
  }
});
