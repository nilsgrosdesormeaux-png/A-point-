// Lecture d'un export de caisse côté Edge Functions : même code que le site
// (lecture-export.js, source unique), plus les fichiers Excel joints aux
// e-mails, convertis en tableau avant lecture.

import './lecture-export.js';
import { type LigneVente } from './commun.ts';

type Resultat = { lignes: LigneVente[]; erreur?: string };
var Lecture = (globalThis as any).LectureExport;

export var lireCsv: (texte: string) => string[][] = Lecture.lireCsv;
export var lireDate: (valeur: unknown) => string | null = Lecture.lireDate;
export var lignesDepuisTableau: (tableau: unknown[][], jourParDefaut: string) => Resultat = Lecture.lignesDepuisTableau;
export var lignesDepuisExport: (texte: string, jourParDefaut: string) => Resultat = Lecture.lignesDepuisExport;
