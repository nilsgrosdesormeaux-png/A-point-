-- À exécuter dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
--
-- Objectif : un formulaire de contact accessible aux commerçants connectés
-- (page aide.html), qui écrit dans une table Supabase ET déclenche un email
-- vers une boîte dédiée, apointapp.contact@gmail.com — séparée de la boîte
-- perso qui reçoit déjà les notifications de nouveaux comptes.
--
-- Compte Resend séparé pour cette boîte : sans domaine vérifié, Resend
-- n'autorise l'envoi qu'à l'adresse propre du compte Resend utilisé. La clé
-- vient donc d'un compte Resend inscrit avec apointapp.contact@gmail.com
-- (distinct de celui utilisé pour les notifications de compte, qui reste sur
-- l'adresse perso).
--
-- NOTE : cette migration a déjà été appliquée directement à la base via le
-- connecteur Supabase (table, fonctions et trigger déjà en place, exécution
-- des fonctions déjà restreinte aux appels internes). Ce fichier reste comme
-- trace/documentation ; la vraie clé API n'est plus recopiée ici pour éviter
-- qu'elle finisse en clair dans l'historique Git si le dépôt est public.

-- 1) Table des messages envoyés via le formulaire de contact.
create table if not exists public.messages_contact (
  id uuid primary key default gen_random_uuid(),
  commercant_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  sujet text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.messages_contact enable row level security;

drop policy if exists "commercant peut envoyer un message" on public.messages_contact;
create policy "commercant peut envoyer un message"
  on public.messages_contact for insert
  with check (auth.uid() = commercant_id);

drop policy if exists "commercant peut voir ses propres messages" on public.messages_contact;
create policy "commercant peut voir ses propres messages"
  on public.messages_contact for select
  using (auth.uid() = commercant_id);

-- 2) Fonction d'envoi d'email dédiée à cette boîte de contact (clé Resend et
-- destinataire distincts de la fonction envoyer_email_notification déjà en
-- place pour les notifications de compte).
create or replace function public.envoyer_email_contact(sujet text, corps_html text)
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
      'to', jsonb_build_array('apointapp.contact@gmail.com'),
      'subject', sujet,
      'html', corps_html
    )
  );
end;
$$;

-- 3) Notification à chaque nouveau message : on rejoint parametres_commercant
-- pour donner un peu de contexte (nom du commerce, ville) en plus de l'email,
-- sans jamais toucher aux données de vente du commerçant.
create or replace function public.notifier_nouveau_message_contact()
returns trigger
language plpgsql
security definer
as $$
declare
  nom_commerce text;
  ville_commerce text;
begin
  select nom_restaurant, ville into nom_commerce, ville_commerce
  from public.parametres_commercant
  where commercant_id = new.commercant_id;

  perform public.envoyer_email_contact(
    'A Point - Nouveau message : ' || new.sujet,
    '<p><strong>De :</strong> ' || new.email || '</p>'
    || '<p><strong>Commerce :</strong> ' || coalesce(nom_commerce, '(non renseigné)')
    || coalesce(' - ' || ville_commerce, '') || '</p>'
    || '<p><strong>Sujet :</strong> ' || new.sujet || '</p>'
    || '<p><strong>Message :</strong></p><p>' || replace(new.message, chr(10), '<br>') || '</p>'
    || '<p style="color:#888; font-size:12px;">Envoyé le ' || new.created_at::text || '</p>'
  );
  return new;
end;
$$;

drop trigger if exists on_message_contact_created on public.messages_contact;
create trigger on_message_contact_created
  after insert on public.messages_contact
  for each row execute function public.notifier_nouveau_message_contact();

-- ============================================================
-- Pour tester : connecte-toi sur le site, va sur la page Aide, envoie un
-- message via le formulaire de contact, et vérifie qu'il arrive bien dans
-- apointapp.contact@gmail.com (regarde aussi les spams la première fois).
--
-- Note sécurité : comme pour la fonction existante, cette clé API Resend
-- n'est stockée que dans la base Supabase (jamais exposée côté site public).
-- Elle est cependant présente en clair dans CE fichier SQL si tu le commites
-- sur GitHub avec un dépôt public — vaut mieux l'exécuter dans Supabase puis
-- éviter de repousser ce fichier tel quel, ou le retirer du dépôt après coup.
-- ============================================================
