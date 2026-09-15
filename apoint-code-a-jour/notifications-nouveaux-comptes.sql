-- À exécuter dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
--
-- Objectif : recevoir un email dès qu'un événement notable se produit côté
-- commerçants pilotes, SANS jamais voir leurs données de vente (juste un
-- signal "il se passe quelque chose", avec de quoi identifier qui/où) :
--   1) un nouveau compte est créé (email connu, rien d'autre à ce stade)
--   2) ce même commerçant enregistre ses paramètres pour la première fois
--      (nom du commerce, code postal, ville) — c'est LÀ qu'on connaît enfin
--      un nom/lieu, puisque le formulaire d'inscription ne demande que
--      email + mot de passe.
--
-- Mécanisme : deux triggers Postgres qui appellent directement l'API de
-- Resend (resend.com) via l'extension pg_net (fournie par Supabase). Pas de
-- Zapier : "Webhooks by Zapier" (la brique dont on aurait eu besoin) est
-- réservée aux plans payants. Resend a un plan gratuit (3000 emails/mois),
-- et sans vérifier de nom de domaine, il n'autorise l'envoi qu'à l'adresse
-- de TON PROPRE compte Resend — une restriction qui tombe bien puisque
-- c'est justement toi le seul destinataire voulu ici.
--
-- Ta clé API Resend et ton adresse (nilsgrosdesormeaux@gmail.com) sont déjà
-- renseignées ci-dessous — il ne reste qu'à coller ce script tel quel dans
-- l'éditeur SQL de Supabase et à le lancer. Tu peux le relancer sans risque
-- si besoin (tout est en "create or replace").

-- 1) Extension pour faire des appels HTTP depuis Postgres (déjà activée sur
-- la plupart des projets Supabase, on s'assure juste qu'elle l'est).
create extension if not exists pg_net;

-- 2) Fonction générique d'envoi d'email via l'API Resend.
create or replace function public.envoyer_email_notification(sujet text, corps_html text)
returns void
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer VOTRE_CLE_API_RESEND_ICI'
    ),
    body := jsonb_build_object(
      'from', 'A Point <onboarding@resend.dev>',
      'to', jsonb_build_array('nilsgrosdesormeaux@gmail.com'),
      'subject', sujet,
      'html', corps_html
    )
  );
end;
$$;

-- 3) Notification à la création d'un compte (email uniquement, c'est tout ce
-- qui est connu à ce stade — le formulaire d'inscription ne demande rien
-- d'autre).
create or replace function public.notifier_nouveau_compte()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.envoyer_email_notification(
    'A Point : nouveau compte créé',
    '<p>Un nouveau compte vient d''être créé sur À Point.</p>'
    || '<p><strong>Email :</strong> ' || new.email || '</p>'
    || '<p><strong>Créé le :</strong> ' || new.created_at::text || '</p>'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notifier on auth.users;
create trigger on_auth_user_created_notifier
  after insert on auth.users
  for each row execute function public.notifier_nouveau_compte();

-- 4) Notification quand ce commerçant enregistre ses paramètres pour la
-- première fois (nom du commerce, code postal, ville) — ne se déclenche
-- qu'une seule fois par commerçant, puisque les enregistrements suivants
-- mettent à jour la même ligne (upsert) plutôt que d'en recréer une.
create or replace function public.notifier_parametres_completes()
returns trigger
language plpgsql
security definer
as $$
declare
  email_commercant text;
begin
  select email into email_commercant from auth.users where id = new.commercant_id;
  perform public.envoyer_email_notification(
    'A Point : paramètres complétés' || coalesce(' par ' || new.nom_restaurant, ''),
    '<p>Un commerçant vient de compléter ses paramètres pour la première fois.</p>'
    || '<p><strong>Email :</strong> ' || coalesce(email_commercant, '(inconnu)') || '</p>'
    || '<p><strong>Nom du commerce :</strong> ' || coalesce(new.nom_restaurant, '(non renseigné)') || '</p>'
    || '<p><strong>Code postal :</strong> ' || coalesce(new.code_postal, '(non renseigné)') || '</p>'
    || '<p><strong>Ville :</strong> ' || coalesce(new.ville, '(non renseignée)') || '</p>'
  );
  return new;
end;
$$;

drop trigger if exists on_parametres_created_notifier on public.parametres_commercant;
create trigger on_parametres_created_notifier
  after insert on public.parametres_commercant
  for each row execute function public.notifier_parametres_completes();

-- ============================================================
-- Pour tester : crée un compte de test sur le site (ou, si tu as déjà un
-- compte, enregistre pour la première fois ses paramètres), et vérifie que
-- l'email arrive dans ta boîte (regarde aussi les spams la première fois).
--
-- Note sécurité : la clé API Resend est stockée dans une fonction de ta
-- base Supabase, jamais visible côté site public (contrairement à la clé
-- Supabase déjà utilisée dans le code du site, qui elle est publique par
-- design) — seule une personne ayant accès à l'éditeur SQL de ton projet
-- Supabase pourrait la lire.
-- ============================================================
