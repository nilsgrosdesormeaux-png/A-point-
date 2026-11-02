// Code commun aux connecteurs caisse : normalisation des noms, dates en
// heure de Paris, agrégation par (jour, produit). Sans dépendance Deno ni
// npm, pour être testé tel quel sous Node (tests/caisse.test.mjs).

// heure : 0 à 23, heure de Paris du ticket (ventes de h:00 à h:59), quand
// la caisse la donne. Sert à ventes_horaires (alerte rupture).
export type LigneVente = { nom_produit: string; quantite: number; date_vente: string; heure?: number };
export type LigneHoraire = { nom_produit: string; heure: number; quantite: number };

// Même règle que cleNormaliseeProduit (import.html) et que la fonction SQL
// normaliser_nom_produit (migration-connecteurs-caisse.sql).
export function normaliserNomProduit(nom: unknown): string {
  var propre = (nom === null || nom === undefined ? '' : String(nom))
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (propre.length > 3 && /[sx]$/.test(propre)) {
    propre = propre.slice(0, -1);
  }
  return propre;
}

// Un ticket de 23 h 30 UTC appartient au lendemain à Paris : on range
// toujours les ventes au jour de la boulangerie, pas au jour UTC.
var FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function jourParis(instant: string | number | Date): string {
  return FORMAT_JOUR_PARIS.format(new Date(instant));
}

var FORMAT_HEURE_PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false });

export function heureParis(instant: string | number | Date): number {
  return Number(FORMAT_HEURE_PARIS.format(new Date(instant))) % 24;
}

// Jour et heure de Paris d'un horodatage de ticket. Un horodatage sans
// fuseau (« 2026-10-29 07:15:00 ») est déjà l'heure locale du magasin.
export function jourEtHeure(horodatage: string): { jour: string; heure: number } | null {
  var v = String(horodatage || '').trim();
  if (!v) return null;
  var local = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):\d{2}(:\d{2}(\.\d+)?)?$/);
  if (local) return { jour: local[1], heure: Number(local[2]) };
  var t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (isNaN(t)) return null;
  return { jour: jourParis(t), heure: heureParis(t) };
}

// Début (inclus) d'un jour de Paris, en instant UTC ISO. Sert à borner les
// requêtes aux API caisse, qui travaillent en UTC.
export function debutJourParisUTC(jour: string): string {
  var midiUTC = new Date(jour + 'T12:00:00Z');
  var heureParisAMidi = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hour12: false
  }).format(midiUTC));
  var decalageHeures = heureParisAMidi - 12;
  return new Date(Date.parse(jour + 'T00:00:00Z') - decalageHeures * 3600000).toISOString();
}

export function ajouterJours(jour: string, n: number): string {
  var d = new Date(jour + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Regroupe les lignes par (jour, nom normalisé) en additionnant les
// quantités. Garde le premier nom rencontré comme libellé.
export function agregerLignes(lignes: LigneVente[]): LigneVente[] {
  var parCle: Record<string, LigneVente> = {};
  var ordre: string[] = [];
  lignes.forEach(function (l) {
    var cleNom = normaliserNomProduit(l.nom_produit);
    if (!cleNom || !l.date_vente) return;
    var quantite = Number(l.quantite);
    if (!isFinite(quantite)) return;
    var cle = l.date_vente + '|' + cleNom;
    if (!parCle[cle]) {
      parCle[cle] = { nom_produit: String(l.nom_produit).trim(), quantite: 0, date_vente: l.date_vente };
      ordre.push(cle);
    }
    parCle[cle].quantite += quantite;
  });
  return ordre.map(function (cle) { return parCle[cle]; });
}

// Lignes d'un jour -> ventes par (heure, nom normalisé), sans les lignes
// dont la caisse ne donne pas l'heure.
export function agregerHoraires(lignes: LigneVente[], jour: string): LigneHoraire[] {
  var parCle: Record<string, LigneHoraire> = {};
  var ordre: string[] = [];
  lignes.forEach(function (l) {
    if (l.date_vente !== jour || typeof l.heure !== 'number' || !(l.heure >= 0 && l.heure <= 23)) return;
    var cleNom = normaliserNomProduit(l.nom_produit);
    var q = Number(l.quantite);
    if (!cleNom || !isFinite(q)) return;
    var cle = l.heure + '|' + cleNom;
    if (!parCle[cle]) { parCle[cle] = { nom_produit: String(l.nom_produit).trim(), heure: l.heure, quantite: 0 }; ordre.push(cle); }
    parCle[cle].quantite += q;
  });
  return ordre.map(function (c) { return parCle[c]; });
}
