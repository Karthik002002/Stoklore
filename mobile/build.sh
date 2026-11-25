#!/bin/sh
# Builds build/stoklore.apk with the Android SDK's command-line tools only - no Gradle,
# no Android Studio. Needs: a JDK 17 (brew openjdk@17) and the SDK at $ANDROID_HOME.
set -eu
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
JAR="$SDK/platforms/android-36/android.jar"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
KS="$HOME/.android/debug.keystore"

rm -rf build && mkdir -p build/classes build/dex
[ -f "$KS" ] || { mkdir -p "$(dirname "$KS")"; keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
  -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000; }

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A assets -o build/unsigned.apk build/res.zip
javac --release 8 -classpath "$JAR" -d build/classes $(find src -name '*.java') 2>&1 | grep -v 'warning: \[options\]' || true
"$BT/d8" --release --min-api 26 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --out build/stoklore.apk build/aligned.apk
rm build/unsigned.apk build/aligned.apk build/aligned.apk.idsig 2>/dev/null || true
echo "built $(pwd)/build/stoklore.apk"
