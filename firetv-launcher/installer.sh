#!/usr/bin/env bash
# Installe l'accueil « Cinéma » sur la Fire TV depuis le Mac (adb en Wi-Fi).
#   ./installer.sh                    installe / met à jour + active le bouton Accueil
#   ./installer.sh fond ~/image.jpg   envoie un fond d'écran perso (puis Thème > Fond perso)
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
    echo "3/4 Activation du bouton Accueil…"
    $A shell settings put secure enabled_accessibility_services "$SVC"
    $A shell settings put secure accessibility_enabled 1
    $A shell mkdir -p "/sdcard/Android/data/$PKG/files" >/dev/null 2>&1
    echo "4/4 Ouverture…"
    $A shell am start -n "$PKG/.MainActivity" >/dev/null
    echo "Terminé. Appuie sur Accueil pour vérifier."
    ;;
  fond)
    [ -f "${2:-}" ] || { echo "Usage : ./installer.sh fond /chemin/image.jpg"; exit 1; }
    ext="${2##*.}"; ext="$(echo "$ext" | tr 'A-Z' 'a-z')"
    $A shell "mkdir -p /sdcard/Android/data/$PKG/files && rm -f /sdcard/Android/data/$PKG/files/fond.*"
    $A push "$2" "/sdcard/Android/data/$PKG/files/fond.$ext" && \
      echo "Fond envoyé. Sur la TV : Réglages > Personnaliser > Thème > Fond perso."
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
