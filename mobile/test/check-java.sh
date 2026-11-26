#!/bin/sh
# Desktop check of the background job's maths (Portfolio.java): javac + java from JDK 17, no Android.
set -eu
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
out="$(mktemp -d)"
"$JAVA_HOME/bin/javac" -encoding UTF-8 -d "$out" src/com/stoklore/app/Portfolio.java test/PortfolioCheck.java
"$JAVA_HOME/bin/java" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$out" com.stoklore.app.PortfolioCheck
rm -rf "$out"
