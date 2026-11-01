// Messages d'erreur en français de boulanger : jamais le texte anglais brut
// du serveur (« Invalid login credentials »…). Convention : IIFE, ES5.
(function () {
  var REGLES = [
    [/invalid login credentials|invalid credentials/i, 'Email ou mot de passe incorrect.'],
    [/email not confirmed/i, 'Ton adresse email n\'est pas encore confirmée : clique sur le lien reçu par email, puis reviens te connecter.'],
    [/already registered|already been registered|already exists/i, 'Un compte existe déjà avec cette adresse : connecte-toi, ou utilise « Mot de passe oublié ».'],
    [/password should|weak password|password is too/i, 'Mot de passe trop simple : 8 caractères au moins, avec des lettres et des chiffres.'],
    [/same password|different from the old/i, 'Choisis un mot de passe différent de l\'ancien.'],
    [/rate limit|too many|security purposes|over_email_send_rate/i, 'Trop de tentatives d\'affilée : attends une minute puis réessaie.'],
    [/invalid email|validate email|email address .* invalid/i, 'Cette adresse email n\'est pas valide.'],
    [/expired|invalid.*(token|link)|otp/i, 'Ce lien a expiré : redemande un email depuis la page de connexion.'],
    [/failed to fetch|network|load failed|timeout/i, 'Pas de connexion à internet pour l\'instant : réessaie dans un instant.']
  ];
  window.messageErreur = function (erreur) {
    var texte = (erreur && (erreur.message || erreur.error_description || erreur.msg)) || String(erreur || '');
    for (var i = 0; i < REGLES.length; i++) if (REGLES[i][0].test(texte)) return REGLES[i][1];
    return 'Ça n\'a pas marché. Réessaie dans un instant ; si ça continue, écris-nous depuis l\'Aide.';
  };
})();
