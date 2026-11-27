# Shared environment for the Android scripts. Source this file, do not execute it.
#   source "$(dirname "$0")/android-env.sh"
#
# Everything can be overridden from the outside (env vars).

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-/opt/android-avd}"
export ANDROID_EMULATOR_HOME="${ANDROID_EMULATOR_HOME:-/opt/android-avd/.android}"

# Versions used by the project / scripts
export ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-35}"
export ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-35.0.0}"
export ANDROID_CMDLINE_TOOLS_ZIP="${ANDROID_CMDLINE_TOOLS_ZIP:-commandlinetools-linux-13114758_latest.zip}"

# Emulator system image + AVD
# aosp_atd (slim "automated test device" image, no Google services) boots in
# ~6 min under pure software emulation; google_apis needs ~16 min and then
# drowns in background work. Both ship WebView 113.
export EMU_SYSTEM_IMAGE="${EMU_SYSTEM_IMAGE:-system-images;android-34;aosp_atd;x86_64}"
export EMU_AVD_NAME="${EMU_AVD_NAME:-wolfgang}"
export EMU_PORT="${EMU_PORT:-5554}"
export EMU_SERIAL="${EMU_SERIAL:-emulator-$EMU_PORT}"

export APP_ID="de.wolfgang.tueftelwerkstatt"
export APP_ACTIVITY="de.wolfgang.tueftelwerkstatt/.MainActivity"

export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS:$PATH"
