#!/bin/sh
# Publishes the MAIN version (AndroidManifest.xml) as a GitHub release: tag mobile-v<versionName>, the APK attached,
# notes from CHANGELOG.md's section for that version. Only when you run this - builds alone never release.
# Needs: mobile/ committed and pushed (the release points at that commit), the gh CLI logged in as
# Karthik002002, and the same debug keystore as earlier releases (a different key can't update the app).
set -eu
cd "$(dirname "$0")"
REPO=Karthik002002/Stoklore
NAME=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml | head -1)
TAG="mobile-v$NAME"
export GH_TOKEN="$(gh auth token --user Karthik002002)"

[ -z "$(git status --porcelain -- .)" ] || { echo "mobile/ has uncommitted changes - commit them first"; exit 1; }
HEAD=$(git rev-parse HEAD)
REMOTE=$(git ls-remote "https://github.com/$REPO.git" refs/heads/main | cut -f1)
git merge-base --is-ancestor "$HEAD" "$REMOTE" 2>/dev/null || { echo "HEAD $HEAD isn't on GitHub's main yet - push first"; exit 1; }
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then echo "$TAG is already released - bump versionName"; exit 1; fi
grep -q "^## $NAME\$" CHANGELOG.md || { echo "CHANGELOG.md has no '## $NAME' section"; exit 1; }

RELEASE=1 ./build.sh # the main version itself (local builds are <main>-dev.<n> and never released)
APK="build/stoklore-v$NAME.apk"
cp build/stoklore.apk "$APK"
NOTES=$(mktemp)
awk -v v="## $NAME" '$0 == v {on = 1; next} on && /^## / {exit} on' CHANGELOG.md > "$NOTES"
printf '\n---\n**Install:** download `stoklore-v%s.apk` on your phone and open it (allow "install unknown apps"). It installs over an earlier Stoklore and keeps your data.\n\nSHA-256: `%s`\n' \
  "$NAME" "$(shasum -a 256 "$APK" | cut -d' ' -f1)" >> "$NOTES"
gh release create "$TAG" "$APK" --repo "$REPO" --target "$HEAD" --title "Stoklore Android $NAME" --notes-file "$NOTES"
rm -f "$NOTES"
echo "released $TAG: https://github.com/$REPO/releases/tag/$TAG"
