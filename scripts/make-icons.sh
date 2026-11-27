#!/usr/bin/env bash
# Generates all Android launcher icons from ONE square source PNG (ideally 1024x1024).
#
#   scripts/make-icons.sh [SOURCE.png] [--bg '#RRGGBB'|auto] [--scale PERCENT]
#
#   SOURCE.png   default: scripts/icon-source.png; if that does not exist a
#                placeholder icon (gear with a "W") is generated.
#   --bg         solid background colour of the adaptive icon.
#                auto (default): colour of the source's top-left pixel if it is
#                opaque, otherwise a warm paper tone (#F3E7CF).
#   --scale      size of the artwork inside the 108dp adaptive foreground layer,
#                in percent. Launchers only show the inner ~67% (72dp) of that
#                layer and may clip it to a circle (safe zone = 61%).
#                Default: 67 for opaque artwork (whole picture stays visible,
#                only the corners get rounded), 61 for artwork with transparency.
#                Use 100 for full-bleed artwork whose outer third may be cropped.
#
# Output (android/app/src/main/res/):
#   mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png   108/162/216/324/432 px (adaptive foreground)
#   mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png               48/72/96/144/192 px  (legacy, rounded square)
#   mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_round.png         48/72/96/144/192 px  (legacy, circle)
#   mipmap-anydpi-v26/ic_launcher.xml, ic_launcher_round.xml  (adaptive icon definition)
#   values/ic_launcher_background.xml                         (background colour)
# Also writes android/app/src/main/ic_launcher-playstore.png (512 px preview, not packaged).
#
# Needs ImageMagick (convert or magick).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
RES="$ROOT/android/app/src/main/res"

if command -v magick >/dev/null 2>&1; then IM=(magick); elif command -v convert >/dev/null 2>&1; then IM=(convert); else
  echo "ImageMagick not found (apt-get install imagemagick)" >&2; exit 1
fi

SRC="" BG="auto" SCALE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bg)    BG="$2"; shift 2 ;;
    --scale) SCALE="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)       SRC="$1"; shift ;;
  esac
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -z "$SRC" && -f "$HERE/icon-source.png" ]]; then
  SRC="$HERE/icon-source.png"
fi
if [[ -z "$SRC" ]]; then
  echo ">> no source given and scripts/icon-source.png missing -> generating placeholder icon"
  SRC="$TMP/placeholder.png"
  # A simple gear with a "W": 12 teeth around a ring.
  teeth=()
  for i in $(seq 0 11); do
    teeth+=( \( -size 1024x1024 xc:none -fill '#E8A33D' -draw 'roundrectangle 452,40 572,240 24,24' \
                -distort SRT "512,512 $((i * 30))" \) -composite )
  done
  "${IM[@]}" -size 1024x1024 xc:none "${teeth[@]}" \
    -fill '#E8A33D' -draw 'circle 512,512 512,130' \
    -fill '#2E3B36' -draw 'circle 512,512 512,235' \
    -fill '#F3E7CF' -font DejaVu-Sans-Bold -pointsize 400 -gravity center -annotate +0+10 'W' \
    "$SRC" 2>/dev/null || \
  "${IM[@]}" -size 1024x1024 xc:none "${teeth[@]}" \
    -fill '#E8A33D' -draw 'circle 512,512 512,130' \
    -fill '#2E3B36' -draw 'circle 512,512 512,235' \
    "$SRC"
  [[ "$BG" == "auto" ]] && BG="#2E3B36"
fi
[[ -f "$SRC" ]] || { echo "source image not found: $SRC" >&2; exit 1; }

# Normalise the source: square canvas, sRGB, with alpha channel.
"${IM[@]}" "$SRC" -alpha on -background none -gravity center \
  -resize 1024x1024 -extent 1024x1024 "PNG32:$TMP/src.png"

corner_alpha="$("${IM[@]}" "$TMP/src.png" -format '%[fx:int(255*p{0,0}.a)]' info:)"
if [[ "$BG" == "auto" ]]; then
  if [[ "$corner_alpha" -ge 250 ]]; then
    BG="$("${IM[@]}" "$TMP/src.png" -format '#%[hex:p{0,0}]' info: | cut -c1-7)"
  else
    BG="#F3E7CF"
  fi
fi
if [[ -z "$SCALE" ]]; then
  if [[ "$corner_alpha" -ge 250 ]]; then SCALE=67; else SCALE=61; fi
fi
echo ">> source: $SRC   background: $BG   artwork scale: ${SCALE}%"

declare -A DENS=( [mdpi]=1 [hdpi]=1.5 [xhdpi]=2 [xxhdpi]=3 [xxxhdpi]=4 )

# Master images at xxxhdpi (432 px = 108dp)
M=432
inner=$(( M * SCALE / 100 ))
"${IM[@]}" -size ${M}x${M} xc:none \( "$TMP/src.png" -resize ${inner}x${inner} \) \
  -gravity center -composite "PNG32:$TMP/fg.png"
# Flattened icon as launchers show it: background + foreground, inner 72dp of 108dp.
V=$(( M * 72 / 108 ))
"${IM[@]}" -size ${M}x${M} "xc:$BG" "$TMP/fg.png" -gravity center -composite \
  -gravity center -crop ${V}x${V}+0+0 +repage "PNG32:$TMP/flat.png"
# Masks (rounded square for legacy, circle for round)
r=$(( V * 22 / 100 ))
"${IM[@]}" -size ${V}x${V} xc:none -fill white -draw "roundrectangle 0,0 $((V-1)),$((V-1)) $r,$r" "$TMP/mask_sq.png"
"${IM[@]}" -size ${V}x${V} xc:none -fill white -draw "circle $((V/2)),$((V/2)) $((V/2)),1" "$TMP/mask_round.png"
"${IM[@]}" "$TMP/flat.png" "$TMP/mask_sq.png" -alpha set -compose DstIn -composite "PNG32:$TMP/legacy.png"
"${IM[@]}" "$TMP/flat.png" "$TMP/mask_round.png" -alpha set -compose DstIn -composite "PNG32:$TMP/legacy_round.png"

for d in "${!DENS[@]}"; do
  f="${DENS[$d]}"
  fgpx="$(awk "BEGIN{printf \"%d\", 108*$f}")"
  lpx="$(awk "BEGIN{printf \"%d\", 48*$f}")"
  dir="$RES/mipmap-$d"
  mkdir -p "$dir"
  "${IM[@]}" "$TMP/fg.png" -resize ${fgpx}x${fgpx} -strip "PNG32:$dir/ic_launcher_foreground.png"
  "${IM[@]}" "$TMP/legacy.png" -resize ${lpx}x${lpx} -strip "PNG32:$dir/ic_launcher.png"
  "${IM[@]}" "$TMP/legacy_round.png" -resize ${lpx}x${lpx} -strip "PNG32:$dir/ic_launcher_round.png"
  echo "   mipmap-$d: foreground ${fgpx}px, legacy ${lpx}px"
done

mkdir -p "$RES/mipmap-anydpi-v26" "$RES/values"
for name in ic_launcher ic_launcher_round; do
cat > "$RES/mipmap-anydpi-v26/$name.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<!-- generated by scripts/make-icons.sh -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
EOF
done
cat > "$RES/values/ic_launcher_background.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<!-- generated by scripts/make-icons.sh -->
<resources>
    <color name="ic_launcher_background">$BG</color>
</resources>
EOF

"${IM[@]}" "$TMP/legacy.png" -resize 512x512 -strip "PNG32:$ROOT/android/app/src/main/ic_launcher-playstore.png"
echo ">> done. Preview: android/app/src/main/ic_launcher-playstore.png"
