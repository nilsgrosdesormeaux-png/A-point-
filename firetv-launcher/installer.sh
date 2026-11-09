#!/usr/bin/env bash
# Installe l'accueil « Cinéma » sur la Fire TV depuis le Mac (adb en Wi-Fi).
#   ./installer.sh                    installe / met à jour + active le bouton Accueil
#   ./installer.sh fond img1.jpg ...  ajoute tes images (thème « Mes images ») ; glisse-les dans le terminal
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
    echo "Sur la TV : Réglages > Personnaliser > Thème > Mes images."
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
    echo "Derniers événements :"; $A logcat -d -s CinemaGuard | tail -15
    ;;
  amazon-off)
    echo "Désactivation de l'accueil Amazon (retour : ./installer.sh amazon-on)…"
    $A shell pm disable-user --user 0 com.amazon.tv.launcher
    ;;
  amazon-on)
    $A shell pm enable com.amazon.tv.launcher
    ;;
  retour)
    $A shell pm enable com.amazon.tv.launcher >/dev/null 2>&1
    $A shell settings delete secure enabled_accessibility_services
    $A uninstall "$PKG"
    echo "Accueil Amazon d'origine rétabli."
    ;;
  *) sed -n '2,8p' "$0" ;;
esac
