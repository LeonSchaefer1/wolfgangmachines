#!/usr/bin/env bash
# Installs the Android SDK pieces needed to build the APK and to run the
# headless emulator. Idempotent: re-running only installs what is missing.
#
#   scripts/setup-android-sdk.sh              # build tools + emulator + system image
#   scripts/setup-android-sdk.sh --build-only # only what is needed for build-apk.sh
#
# Target directory: $ANDROID_SDK_ROOT (default /opt/android-sdk)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=android-env.sh
source "$HERE/android-env.sh"

BUILD_ONLY=0
[[ "${1:-}" == "--build-only" ]] && BUILD_ONLY=1

SDK="$ANDROID_SDK_ROOT"
mkdir -p "$SDK"

# --- 1. cmdline-tools (bootstrap from zip) -----------------------------------
if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
  echo ">> installing cmdline-tools ($ANDROID_CMDLINE_TOOLS_ZIP)"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fSL --retry 3 -o "$tmp/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/$ANDROID_CMDLINE_TOOLS_ZIP"
  unzip -q "$tmp/cmdline-tools.zip" -d "$tmp"
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
else
  echo ">> cmdline-tools already present"
fi

SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"

# --- 2. licenses --------------------------------------------------------------
echo ">> accepting licenses"
set +o pipefail
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
set -o pipefail

# --- 3. packages --------------------------------------------------------------
pkgs=(
  "platform-tools"
  "platforms;$ANDROID_PLATFORM"
  "build-tools;$ANDROID_BUILD_TOOLS"
)
if [[ $BUILD_ONLY -eq 0 ]]; then
  pkgs+=("emulator" "$EMU_SYSTEM_IMAGE")
fi

missing=()
for p in "${pkgs[@]}"; do
  dir="$SDK/${p//;//}"
  if [[ -f "$dir/package.xml" ]]; then
    echo ">> ok       $p"
  else
    echo ">> missing  $p"
    missing+=("$p")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo ">> installing: ${missing[*]}"
  set +o pipefail
  yes | "$SDKMANAGER" --sdk_root="$SDK" "${missing[@]}" 2>&1 \
    | tr '\r' '\n' | grep -v -E '^\[[= ]*\]|^Picked up |^[[:space:]]*$' || true
  set -o pipefail
  for p in "${missing[@]}"; do
    [[ -f "$SDK/${p//;//}/package.xml" ]] || { echo "!! failed to install $p" >&2; exit 1; }
  done
fi

echo
echo "SDK ready in $SDK"
"$SDKMANAGER" --sdk_root="$SDK" --list_installed 2>/dev/null | sed -n '/Path/,$p'
