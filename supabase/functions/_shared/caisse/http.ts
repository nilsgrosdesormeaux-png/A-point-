// Appels HTTP communs aux connecteurs : réessai sur 429 (trop de
// requêtes) et erreurs 5xx passagères, 401/403 signalés à part pour
// rafraîchir le jeton ou demander de reconnecter la caisse.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type Jetons = { access_token: string; refresh_token: string | null; expire_a: string | null };

export class ErreurAutorisation extends Error {}

export function attendre(ms: number) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

export async function appelJson(fetchFn: FetchFn, nom: string, url: string, init?: RequestInit): Promise<any> {
  for (var essai = 0; essai < 5; essai++) {
    var rep = await fetchFn(url, init);
    if (rep.status === 429 || rep.status >= 500) {
      var pause = Number(rep.headers.get('retry-after')) * 1000 || 1000 * Math.pow(2, essai);
      await attendre(Math.min(pause, 15000));
      continue;
    }
    if (rep.status === 401 || rep.status === 403) throw new ErreurAutorisation(nom + ' : accès refusé (' + rep.status + ')');
    if (!rep.ok) throw new Error(nom + ' : erreur ' + rep.status);
    return rep.json();
  }
  throw new Error(nom + ' : service indisponible ou trop de requêtes, nouvel essai plus tard');
}

// Demande de jetons OAuth (formulaire ou JSON selon la caisse).
export async function demanderJetons(fetchFn: FetchFn, nom: string, url: string, params: Record<string, string>, enJson?: boolean): Promise<Jetons> {
  var rep = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': enJson ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: enJson ? JSON.stringify(params) : new URLSearchParams(params).toString()
  });
  var corps = await rep.json().catch(function () { return {}; });
  if (!rep.ok || !corps.access_token) {
    throw new ErreurAutorisation(nom + ' a refusé l\'autorisation (' + rep.status + ' ' + (corps.error || corps.message || '') + ')');
  }
  var expire = corps.expires_in
    ? new Date(Date.now() + corps.expires_in * 1000).toISOString()
    : (corps.expires_at || null);
  return { access_token: corps.access_token, refresh_token: corps.refresh_token || null, expire_a: expire };
}
