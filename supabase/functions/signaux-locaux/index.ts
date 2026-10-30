// Edge Function : signaux locaux pour la prévision (plan v2, AMELIORATIONS.md).
//
// Renvoie, pour une position et une période, les jours d'événements locaux
// (OpenAgenda : marchés, fêtes, brocantes, concerts) et de matchs de
// l'équipe de France (football-data.org). Le moteur apprend ensuite leur
// effet sur l'historique de la boulangerie (contexte.js, moteur-prevision.js).
//
// Appel : supabase.functions.invoke('signaux-locaux', { body: { latitude,
// longitude, debut: 'AAAA-MM-JJ', fin: 'AAAA-MM-JJ' } }) par un utilisateur
// connecté (JWT vérifié). Réponse : { signaux: [{ date, type, libelle }] }.
//
// Secrets facultatifs : OPENAGENDA_KEY, FOOTBALL_DATA_KEY. Une clé absente ou
// une API en erreur = signal ignoré, jamais d'erreur renvoyée au navigateur.
// Les réponses sont gardées dans la table cache_signaux (une fenêtre passée
// ne change plus ; une fenêtre qui touche aujourd'hui est rafraîchie chaque
// jour), pour ménager les quotas gratuits.

import { createClient } from 'npm:@supabase/supabase-js@2';

type Signal = { date: string; type: 'evenement' | 'match'; libelle: string };

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

var FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
var FORMAT_HEURE_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

function jourParis(instant: string | Date): string {
  return FORMAT_JOUR_PARIS.format(new Date(instant));
}

function ajouterJours(iso: string, n: number): string {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function estDate(x: unknown): x is string {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

// Lit le cache, sinon appelle la source et enregistre. Une erreur de source
// renvoie [] sans rien mettre en cache (on réessaiera au prochain appel).
async function avecCache(admin: any, cle: string, fenetreFin: string, source: () => Promise<Signal[]>): Promise<Signal[]> {
  var aujourdhui = jourParis(new Date());
  var lu = await admin.from('cache_signaux').select('donnees, maj').eq('cle', cle).maybeSingle();
  if (lu.data) {
    var fige = fenetreFin < aujourdhui;
    var frais = Date.now() - new Date(lu.data.maj).getTime() < 20 * 3600 * 1000;
    if (fige || frais) return lu.data.donnees as Signal[];
  }
  try {
    var signaux = await source();
    await admin.from('cache_signaux').upsert({ cle: cle, donnees: signaux, maj: new Date().toISOString() });
    return signaux;
  } catch (_e) {
    return lu.data ? (lu.data.donnees as Signal[]) : [];
  }
}

// ---------- OpenAgenda : événements dans un rayon d'environ 3 km ----------
async function evenementsOpenAgenda(cle: string, lat: number, lng: number, debut: string, fin: string): Promise<Signal[]> {
  var d = 0.03;
  var params = new URLSearchParams({
    key: cle,
    size: '300',
    monolingual: 'fr',
    'geo[northEast][lat]': String(lat + d), 'geo[northEast][lng]': String(lng + d),
    'geo[southWest][lat]': String(lat - d), 'geo[southWest][lng]': String(lng - d),
    'timings[gte]': debut + 'T00:00:00+01:00',
    'timings[lte]': fin + 'T23:59:59+01:00'
  });
  var res = await fetch('https://api.openagenda.com/v2/events?' + params.toString());
  if (!res.ok) throw new Error('OpenAgenda ' + res.status);
  var json = await res.json();
  var parJour: Record<string, string> = {};
  (json.events || []).forEach(function (ev: any) {
    var titre = (ev.title && (ev.title.fr || Object.values(ev.title)[0])) || 'Événement local';
    (ev.timings || []).forEach(function (t: any) {
      var jour = jourParis(t.begin);
      if (jour < debut || jour > fin) return;
      if (!parJour[jour]) parJour[jour] = String(titre).slice(0, 60);
    });
  });
  return Object.keys(parJour).map(function (jour) { return { date: jour, type: 'evenement' as const, libelle: parJour[jour] }; });
}

// ---------- football-data.org : matchs de l'équipe de France ----------
// L'offre gratuite limite chaque requête à 10 jours : on découpe la période.
async function matchsFrance(cle: string, debut: string, fin: string): Promise<Signal[]> {
  var res = await fetch('https://api.football-data.org/v4/matches?dateFrom=' + debut + '&dateTo=' + fin, {
    headers: { 'X-Auth-Token': cle }
  });
  if (!res.ok) throw new Error('football-data ' + res.status);
  var json = await res.json();
  return (json.matches || []).filter(function (m: any) {
    return (m.homeTeam && m.homeTeam.name === 'France') || (m.awayTeam && m.awayTeam.name === 'France');
  }).map(function (m: any) {
    var adversaire = m.homeTeam.name === 'France' ? m.awayTeam.name : m.homeTeam.name;
    return { date: jourParis(m.utcDate), type: 'match' as const, libelle: 'France – ' + adversaire + ' (' + FORMAT_HEURE_PARIS.format(new Date(m.utcDate)) + ')' };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  var repondre = function (signaux: Signal[]) {
    return new Response(JSON.stringify({ signaux: signaux }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  };
  try {
    var corps = await req.json().catch(function () { return {}; });
    var lat = Number(corps.latitude), lng = Number(corps.longitude);
    var aujourdhui = jourParis(new Date());
    var fin = estDate(corps.fin) ? corps.fin : ajouterJours(aujourdhui, 8);
    var debut = estDate(corps.debut) ? corps.debut : ajouterJours(aujourdhui, -365);
    // Un an d'historique suffit pour apprendre un effet ; au-delà, on coupe.
    if (debut < ajouterJours(aujourdhui, -365)) debut = ajouterJours(aujourdhui, -365);
    if (!isFinite(lat) || !isFinite(lng) || debut > fin) return repondre([]);

    var admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    var cleAgenda = Deno.env.get('OPENAGENDA_KEY') || '';
    var cleFoot = Deno.env.get('FOOTBALL_DATA_KEY') || '';
    var signaux: Signal[] = [];

    if (cleAgenda) {
      // Fenêtres de 30 jours alignées sur le calendrier, position arrondie
      // (~1 km) : les mêmes clés de cache d'un jour à l'autre.
      var la = lat.toFixed(2), lo = lng.toFixed(2);
      var departAgenda = ajouterJours(debut, -((new Date(debut + 'T12:00:00Z').getTime() / 86400000) % 30 | 0));
      for (var d = departAgenda; d <= fin; d = ajouterJours(d, 30)) {
        var f = ajouterJours(d, 29) < fin ? ajouterJours(d, 29) : fin;
        signaux = signaux.concat(await avecCache(admin, 'agenda:' + la + ',' + lo + ':' + d, f, function () {
          return evenementsOpenAgenda(cleAgenda, Number(la), Number(lo), d, f);
        }));
      }
    }
    if (cleFoot) {
      // Fenêtres de 10 jours alignées sur le calendrier, communes à tous ;
      // 120 jours d'historique au plus (quota gratuit : 10 requêtes par minute).
      var debutFoot = debut < ajouterJours(aujourdhui, -120) ? ajouterJours(aujourdhui, -120) : debut;
      var depart = ajouterJours(debutFoot, -((new Date(debutFoot + 'T12:00:00Z').getTime() / 86400000) % 10 | 0));
      for (var m = depart; m <= fin; m = ajouterJours(m, 10)) {
        var mf = ajouterJours(m, 9);
        signaux = signaux.concat(await avecCache(admin, 'foot:' + m, mf, function () {
          return matchsFrance(cleFoot, m, mf);
        }));
      }
    }
    return repondre(signaux.filter(function (s) { return s.date >= debut && s.date <= fin; }));
  } catch (_e) {
    return repondre([]);
  }
});
