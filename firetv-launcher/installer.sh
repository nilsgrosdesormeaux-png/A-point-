#!/usr/bin/env bash
# Installe l'accueil « Cinéma » sur la Fire TV depuis le Mac (adb en Wi-Fi).
#   ./installer.sh                    installe / met à jour + active le bouton Accueil
#   ./installer.sh fond img.jpg vid.mp4 …  ajoute images (« Mes images ») et vidéos (« Mes vidéos ») ; glisse-les dans le terminal
#   ./installer.sh son snowfall musique.mp3   musique d'un thème (snowfall, barca, console, neon…)
#   ./installer.sh fonds-vider        supprime tes images
#   ./installer.sh etat               vérifie que tout est en place
#   ./installer.sh amazon-off         (option) désactive l'accueil Amazon
#   ./installer.sh amazon-on          réactive l'accueil Amazon
#   ./installer.sh retour             tout annuler : retour à l'accueil Amazon d'origine
set -uo pipefail
cd "$(dirname "$0")"
IP="${FIRETV_IP:-10.192.26.3}"
PKG="fr.cinema.accueil"
SVC="$PKG/$PKG.HomeGuardService"
A="adb -s $IP:5555"

adb connect "$IP:5555" >/dev/null
if ! $A get-state 2>/dev/null | grep -q device; then
  echo "Fire TV introuvable sur $IP. Vérifie l'IP (Paramètres > Ma Fire TV > À propos > Réseau)"
  echo "et lance : FIRETV_IP=x.x.x.x ./installer.sh"; exit 1
fi

case "${1:-installer}" in
  installer)
    echo "1/4 Installation de Cinéma…"
    $A install -r release/Cinema.apk || exit 1
    echo "2/4 Retrait de Launcher Manager Mini et Projectivy (ils se battraient avec Cinéma)…"
    $A uninstall com.wolf.minilm >/dev/null 2>&1
    $A uninstall com.spocky.projengmenu >/dev/null 2>&1
    echo "3/4 Activation du bouton Accueil et du gardien…"
    $A shell pm grant "$PKG" android.permission.WRITE_SECURE_SETTINGS
    $A shell settings put secure enabled_accessibility_services "$SVC"
    $A shell settings put secure accessibility_enabled 1
    $A shell dumpsys deviceidle whitelist +"$PKG" >/dev/null 2>&1
    $A shell cmd appops set "$PKG" RUN_IN_BACKGROUND allow >/dev/null 2>&1
    $A shell mkdir -p "/sdcard/Android/data/$PKG/files" >/dev/null 2>&1
    echo "4/4 Ouverture…"
    $A shell am start -n "$PKG/.MainActivity" >/dev/null
    echo "Terminé. Appuie sur Accueil pour vérifier."
    ;;
  fond)
    shift
    [ $# -gt 0 ] || { echo "Usage : ./installer.sh fond image1.jpg image2.png …  (glisse les images dans le terminal)"; exit 1; }
    D="/sdcard/Android/data/$PKG/files/fonds"
    $A shell mkdir -p "$D"
    for f in "$@"; do
      [ -f "$f" ] || { echo "Introuvable : $f"; continue; }
      $A push "$f" "$D/" >/dev/null && echo "Envoyée : $(basename "$f")"
    done
    echo "Sur la TV : Réglages > Personnaliser > Thème > Mes images (photos) ou Mes vidéos (vidéos)."
    ;;
  son)
    T="${2:-}"; F="${3:-}"
    [ -n "$T" ] && [ -f "$F" ] || { echo "Usage : ./installer.sh son snowfall /chemin/musique.mp3  (glisse le fichier)"; exit 1; }
    ext="${F##*.}"; ext="$(echo "$ext" | tr 'A-Z' 'a-z')"
    D="/sdcard/Android/data/$PKG/files/fonds"
    $A shell mkdir -p "$D"
    $A shell "rm -f $D/son-$T.*"
    $A push "$F" "$D/son-$T.$ext" >/dev/null && echo "Musique du thème $T installée. Elle jouera sur l'accueil (réglable dans Personnaliser)."
    ;;
  fonds-vider)
    $A shell rm -rf "/sdcard/Android/data/$PKG/files/fonds" "/sdcard/Android/data/$PKG/files/fond."*
    echo "Images supprimées."
    ;;
  etat)
    echo "Version : $($A shell dumpsys package $PKG | grep -m1 versionName)"
    echo "Service Accueil listé : $($A shell settings get secure enabled_accessibility_services)"
    echo "Permission auto-réparation : $($A shell dumpsys package $PKG | grep -c 'WRITE_SECURE_SETTINGS: granted=true')"
    echo "Processus :"; $A shell ps -A | grep "$PKG" || echo "  aucun"
    echo "Accueil Amazon désactivé : $($A shell pm list packages -d | grep -E 'launcher|homestarter' | tr '\n' ' ')"
    echo "Accueil par défaut : $($A shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1)"
    echo "Derniers événements :"; $A logcat -d -s CinemaGuard | tail -25
    ;;
  amazon-off|verrou)
    echo "Verrou : Cinéma devient le seul accueil (retour : ./installer.sh amazon-on)…"
    for P in com.amazon.tv.launcher com.amazon.firehomestarter; do
      if $A shell pm list packages | grep -q "package:$P\$"; then
        R=$($A shell pm disable-user --user 0 "$P" 2>&1)
        echo "  $P → $R"
      fi
    done
    $A shell cmd package set-home-activity "$PKG/.MainActivity" >/dev/null 2>&1 \
      || $A shell pm set-home-activity "$PKG/.MainActivity" >/dev/null 2>&1
    echo "Vérification :"
    $A shell pm list packages -d | grep -E "launcher|homestarter" | sed 's/^/  désactivé : /' \
      || echo "  ATTENTION : Fire OS a refusé de désactiver l'accueil Amazon."
    echo "  accueil par défaut : $($A shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1)"
    ;;
  amazon-on)
    $A shell pm enable com.amazon.tv.launcher
    $A shell pm enable com.amazon.firehomestarter >/dev/null 2>&1
    ;;
  retour)
    $A shell pm enable com.amazon.tv.launcher >/dev/null 2>&1
    $A shell pm enable com.amazon.firehomestarter >/dev/null 2>&1
    $A shell settings delete secure enabled_accessibility_services
    $A uninstall "$PKG"
    echo "Accueil Amazon d'origine rétabli."
    ;;
  *) sed -n '2,8p' "$0" ;;
esac
