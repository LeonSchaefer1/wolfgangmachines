#!/usr/bin/env bash
# EMULATOR-ONLY workaround for running the game in an emulator WITHOUT hardware acceleration (no KVM).
#
# Under pure CPU emulation the system WebView of the API 34/35 images kills its renderer on every
# page: V8's start-up snapshot checksum self-check fails (SIGTRAP in CrRendererMain). This script
# replaces the one conditional jump of that check with NOPs in a copy of the emulator's WebView
# package and bind-mounts the copy over the original. Nothing in the app or the APK is changed.
#
#   scripts/emulator-webview-fix.sh <crash-pc-hex>
#
# <crash-pc-hex> is the "#00 pc" value of the renderer tombstone (adb logcat | grep '#00 pc'),
# e.g. 191356a for WebView 113.0.5672.136 (API 34) or 17971cc for WebView 124.0.6367.219 (API 35).
# Run it right after "adb devices" shows the emulator (ideally while it is still booting, before the
# WebView zygote starts); otherwise restart the framework afterwards: adb shell 'stop; start'.
# The bind mount is gone after a reboot; run the script again then (the patched copy is reused).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/android-env.sh"
PC="${1:?usage: emulator-webview-fix.sh <crash-pc-hex>}"
ADB=(adb -s "$EMU_SERIAL")
WORK="$(mktemp -d)"
REMOTE=/data/local/tmp/webview-patched.apk
SRC="$("${ADB[@]}" shell pm path com.android.webview | tr -d '\r' | sed 's/^package://')"
[[ -n "$SRC" ]] || { echo "com.android.webview not found" >&2; exit 1; }

if ! "${ADB[@]}" shell "su 0 test -f $REMOTE" 2>/dev/null; then
  "${ADB[@]}" pull "$SRC" "$WORK/webview.apk" >/dev/null
  python3 -I - "$WORK" "$PC" <<'PY'
import re, struct, subprocess, sys, zipfile
work, crash = sys.argv[1], int(sys.argv[2], 16)
apk = f'{work}/webview.apk'
z = zipfile.ZipFile(apk)
info = next(i for i in z.infolist() if i.filename == 'lib/x86_64/libwebviewchromium.so')
assert info.compress_type == 0, 'library is compressed inside the APK'
with open(apk, 'rb') as f:
    f.seek(info.header_offset); h = f.read(30)
n, m = struct.unpack('<HH', h[26:30]); data_off = info.header_offset + 30 + n + m
open(f'{work}/lib.so', 'wb').write(z.read(info))
dis = subprocess.run(['objdump', '-d', '--start-address', hex(crash - 0x400), '--stop-address', hex(crash + 8), f'{work}/lib.so'], capture_output=True, text=True).stdout
hit = None
for line in dis.splitlines():
    mm = re.match(r'\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*(j\w+)\s+([0-9a-f]+)', line)
    if mm and int(mm.group(4), 16) == crash - 1:
        hit = (int(mm.group(1), 16), bytes.fromhex(mm.group(2).replace(' ', '')))
assert hit, 'no conditional jump to the crash stub found - wrong pc?'
data = bytearray(open(apk, 'rb').read())
assert data[data_off + hit[0]:data_off + hit[0] + len(hit[1])] == hit[1]
data[data_off + hit[0]:data_off + hit[0] + len(hit[1])] = b'\x90' * len(hit[1])
open(f'{work}/webview-patched.apk', 'wb').write(data)
print(f'patched {len(hit[1])} bytes at {hex(hit[0])}')
PY
  "${ADB[@]}" push "$WORK/webview-patched.apk" "$REMOTE" >/dev/null
fi
"${ADB[@]}" shell "su 0 sh -c 'chmod 644 $REMOTE; chown root:root $REMOTE; chcon u:object_r:system_file:s0 $REMOTE; mount -o bind $REMOTE $SRC && echo bound patched WebView over $SRC'"
rm -rf "$WORK"
