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

rm -rf build && mkdir -p build/classes build/dex build/gen
[ -f "$KS" ] || { mkdir -p "$(dirname "$KS")"; keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
  -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000; }

"$BT/aapt2" compile --dir res -o build/res.zip
# --java writes R.java (resource ids, e.g. the notification icon)
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A assets --java build/gen -o build/unsigned.apk build/res.zip
# a compile error stops the build (javac's own [options] warning about --release 8 is dropped)
javac --release 8 -encoding UTF-8 -classpath "$JAR" -d build/classes $(find src build/gen -name '*.java') 2> build/javac.log \
  || { grep -v 'warning: \[options\]' build/javac.log; exit 1; }
grep -v 'warning: \[options\]' build/javac.log || true
"$BT/d8" --release --min-api 26 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --out build/stoklore.apk build/aligned.apk
rm build/unsigned.apk build/aligned.apk build/aligned.apk.idsig 2>/dev/null || true
echo "built $(pwd)/build/stoklore.apk"

# Every build also lands on a connected phone: /sdcard/Stoklore/stoklore-v<name>-<code>.apk, newest 5 kept.
# No phone (or no adb) -> skipped; the build itself never fails over it.
ADB="$SDK/platform-tools/adb"
if [ -x "$ADB" ] && [ "$("$ADB" get-state 2>/dev/null)" = "device" ]; then
  NAME=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml | head -1)
  CODE=$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' AndroidManifest.xml | head -1)
  DEST="/sdcard/Stoklore/stoklore-v$NAME-$CODE.apk"
  if "$ADB" shell mkdir -p /sdcard/Stoklore && "$ADB" push build/stoklore.apk "$DEST" >/dev/null 2>&1; then
    "$ADB" shell 'cd /sdcard/Stoklore && ls -t stoklore-*.apk | tail -n +6 | while read f; do rm -f "$f"; done'
    echo "copied to phone: $DEST (keeping the newest 5)"
    "$ADB" shell ls -t /sdcard/Stoklore | sed 's/^/  /'
  else
    echo "phone copy skipped: adb push failed"
  fi
fi
