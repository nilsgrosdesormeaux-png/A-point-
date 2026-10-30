// Chiffrement AES-GCM des jetons caisse avant stockage en base : une fuite
// de la table connexions_caisse_secrets seule ne donne pas accès aux
// comptes caisse. La clé (CLE_CHIFFREMENT_CAISSE, 32 octets en base64) ne
// vit que dans les secrets des Edge Functions.

function base64VersOctets(b64: string): Uint8Array<ArrayBuffer> {
  var bin = atob(b64);
  var octets = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return octets;
}

function octetsVersBase64(octets: Uint8Array): string {
  var bin = '';
  for (var i = 0; i < octets.length; i++) bin += String.fromCharCode(octets[i]);
  return btoa(bin);
}

function importerCle(cleBase64: string): Promise<CryptoKey> {
  var brute = base64VersOctets(cleBase64);
  if (brute.length !== 32) throw new Error('CLE_CHIFFREMENT_CAISSE doit faire 32 octets (openssl rand -base64 32)');
  return crypto.subtle.importKey('raw', brute, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Format stocké : "v1:<iv base64>:<chiffré base64>".
export async function chiffrer(texte: string, cleBase64: string): Promise<string> {
  var cle = await importerCle(cleBase64);
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cle, new TextEncoder().encode(texte));
  return 'v1:' + octetsVersBase64(iv) + ':' + octetsVersBase64(new Uint8Array(chiffre));
}

export async function dechiffrer(stocke: string, cleBase64: string): Promise<string> {
  var morceaux = stocke.split(':');
  if (morceaux.length !== 3 || morceaux[0] !== 'v1') throw new Error('Jeton caisse illisible');
  var cle = await importerCle(cleBase64);
  var clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64VersOctets(morceaux[1]) }, cle, base64VersOctets(morceaux[2]));
  return new TextDecoder().decode(clair);
}
