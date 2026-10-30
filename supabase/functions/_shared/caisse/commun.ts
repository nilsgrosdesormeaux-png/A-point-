// Code commun aux connecteurs caisse : normalisation des noms, dates en
// heure de Paris, agrégation par (jour, produit). Sans dépendance Deno ni
// npm, pour être testé tel quel sous Node (tests/caisse.test.mjs).

export type LigneVente = { nom_produit: string; quantite: number; date_vente: string };

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
