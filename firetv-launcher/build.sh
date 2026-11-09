#!/usr/bin/env bash
# Compile l'APK sans Gradle (aapt2 + javac + d8 + apksigner). Usage : ANDROID_HOME=/chemin/sdk ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:?ANDROID_HOME doit pointer vers le SDK Android}"
BT="$SDK/build-tools/${BT_VER:-35.0.0}"; JAR="$SDK/platforms/android-34/android.jar"
VCODE="${VCODE:-1}"; VNAME="${VNAME:-1.0}"
rm -rf build && mkdir -p build/gen build/classes build/dex release
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A assets --java build/gen -o build/base.apk build/res.zip \
  --min-sdk-version 25 --target-sdk-version 28 --version-code "$VCODE" --version-name "$VNAME"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR:$BT/core-lambda-stubs.jar" -encoding UTF-8 -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 25 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
cp build/base.apk build/unsigned.apk && (cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks cinema.keystore --ks-pass pass:cinema-accueil --out release/Cinema.apk build/aligned.apk
echo "OK : release/Cinema.apk"
