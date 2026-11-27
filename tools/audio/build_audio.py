#!/usr/bin/env python3
"""Regenerates every audio asset of "Wolfgangs Tueftelwerkstatt".

    python3 tools/audio/build_audio.py            # everything
    python3 tools/audio/build_audio.py pop bell   # only the named assets

Fully procedural + deterministic (fixed RNG seeds, bit-exact ffmpeg flags).
Needs: python3 with numpy, scipy, soundfile (pip install numpy scipy soundfile)
and ffmpeg with libvorbis on the PATH.  Takes ~20 s, peak memory ~0.6 GB.
Output: game/public/audio/*.ogg (Vorbis, 44.1 kHz; SFX mono q4, music stereo q5).
Run tools/audio/analyze.py afterwards for the verification report.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))

import music  # noqa: E402
import sfx  # noqa: E402
from synth import SR, fade_io, hp, lin, loud_window, lufs_integrated, ns, peak_db, soft_limit, write_ogg  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "game" / "public" / "audio"

# Loudness roles.  "loud" = max K-weighted loudness in a 100 ms window (how
# loud a short one-shot is perceived); "peak" = ceiling in dBFS.  The gain is
# set by the loudness target and reduced if the peak ceiling would be exceeded.
UI = dict(loud=-21.0, peak=-5.0, fin=0.003, fout=0.03)
UI_CLICK = dict(loud=-23.5, peak=-5.0, fin=0.0012, fout=0.02)
IMPACT = dict(loud=-18.5, peak=-3.0, fin=0.0012, fout=0.03)
SMALL = dict(loud=-21.0, peak=-3.0, fin=0.0012, fout=0.02)
EVENT = dict(loud=-15.0, peak=-3.0, fin=0.003, fout=0.06)
CHIME = dict(loud=-17.0, peak=-3.0, fin=0.0015, fout=0.12)

ONESHOTS = {
    # ---- UI -------------------------------------------------------------
    "ui_tap": (sfx.ui_tap, UI_CLICK),
    "ui_pick": (sfx.ui_pick, dict(UI, fin=0.0015)),
    "ui_place": (sfx.ui_place, dict(UI, loud=-20.5, fin=0.0012)),
    "ui_rotate": (sfx.ui_rotate, UI_CLICK),
    "ui_return": (sfx.ui_return, dict(UI, fout=0.06, maxdur=0.3)),
    "ui_error": (sfx.ui_error, dict(UI, loud=-20.0, fin=0.003, fout=0.08, maxdur=0.32)),
    "ui_start": (sfx.ui_start, dict(UI, loud=-18.5, peak=-4.0, fin=0.0012, fout=0.06, maxdur=0.62)),
    "ui_stop": (sfx.ui_stop, dict(UI, loud=-19.0, peak=-4.0, fin=0.003, fout=0.06, maxdur=0.42)),
    "ui_hint": (sfx.ui_hint, dict(CHIME, loud=-19.0, peak=-5.0, fout=0.4, maxdur=0.8)),
    "ui_panel": (sfx.ui_panel, dict(UI, loud=-23.0, fin=0.005, fout=0.07, maxdur=0.3)),
    # ---- physics --------------------------------------------------------
    "wood_hit_1": (lambda: sfx.wood_hit(11, 392.0, "plank"), IMPACT),
    "wood_hit_2": (lambda: sfx.wood_hit(12, 226.0, "crate"), IMPACT),
    "wood_hit_3": (lambda: sfx.wood_hit(13, 655.0, "block"), IMPACT),
    "metal_hit_1": (lambda: sfx.metal_hit(21, 1), dict(IMPACT, loud=-19.5)),
    "metal_hit_2": (lambda: sfx.metal_hit(22, 2), dict(IMPACT, loud=-19.5)),
    "rubber_bounce_1": (lambda: sfx.rubber_bounce(31, 1), IMPACT),
    "rubber_bounce_2": (lambda: sfx.rubber_bounce(32, 2), IMPACT),
    "domino_1": (lambda: sfx.domino(41, 1900.0), SMALL),
    "domino_2": (lambda: sfx.domino(42, 2240.0), SMALL),
    "domino_3": (lambda: sfx.domino(43, 1660.0), SMALL),
    "boing": (sfx.boing, dict(IMPACT, loud=-17.0, fin=0.002)),
    "pop": (sfx.pop, dict(IMPACT, loud=-17.0)),
    "basket_land": (sfx.basket_land, dict(IMPACT, fout=0.05)),
    "seesaw": (sfx.seesaw, dict(IMPACT, fout=0.04)),
    # ---- devices ----------------------------------------------------------
    "button_click": (sfx.button_click, dict(IMPACT, loud=-20.0)),
    "lamp_on": (sfx.lamp_on, dict(CHIME, loud=-18.0, fin=0.0012, fout=0.15, maxdur=0.75)),
    "fuse": (sfx.fuse, dict(EVENT, loud=-20.0, fin=0.004, fout=0.12, maxdur=1.25)),
    "rocket_launch": (sfx.rocket_launch, dict(EVENT, loud=-15.0, fin=0.004, fout=0.3, maxdur=1.85)),
    "firework": (sfx.firework, dict(EVENT, loud=-14.5, fin=0.003, fout=0.4, maxdur=2.05)),
    "bell": (sfx.bell, dict(CHIME, loud=-15.0, fout=0.5)),
    # ---- rewards (mono chimes) ----------------------------------------------
    "star": (sfx.star, dict(CHIME, fout=0.4, maxdur=0.9)),
    "unlock": (sfx.unlock, dict(CHIME, fout=0.5, maxdur=1.15)),
    "confetti": (sfx.confetti, dict(EVENT, loud=-17.0, fout=0.12)),
}
LOOPS = {  # name: (fn, integrated LUFS target)
    "fan_loop": (sfx.fan_loop, -25.0),
    "conveyor_loop": (sfx.conveyor_loop, -24.0),
}
STEREO = {  # already mastered in music.py
    "win_fanfare": (music.win_fanfare, False),
    "game_complete": (music.game_complete, False),
    "music_workshop": (music.music_workshop, True),
    "music_menu": (music.music_menu, True),
}


def finalize_oneshot(x, loud, peak, fin, fout, max_squash=4.0, maxdur=None):
    x = hp(np.asarray(x, dtype=float), 35.0, 2)  # remove DC / subsonics
    pk = np.max(np.abs(x))
    # trim leading silence completely (latency!) and the inaudible tail
    first = int(np.argmax(np.abs(x) > pk * lin(-50.0)))
    last = len(x) - int(np.argmax(np.abs(x[::-1]) > pk * lin(-54.0)))
    x = x[max(0, first - 2) : min(len(x), last + ns(0.01))]
    if maxdur is not None:
        x = x[: ns(maxdur)]
    x = fade_io(x, fin, fout)
    # Reach the loudness target; if the peak ceiling is in the way, round off
    # the first transient with a memoryless soft limiter (at most `max_squash`
    # dB of crest reduction - tames sudden peaks, inaudible as distortion).
    ceiling = lin(peak)
    for _ in range(4):
        g = loud - loud_window(x, 0.1)
        over = peak_db(x) + g - peak
        if over > max_squash:
            g -= over - max_squash
        x = x * lin(g)
        if over > 0.05:
            x = soft_limit(x, ceiling, 0.4)
    return x * min(1.0, ceiling / np.max(np.abs(x)))


def encode_clean_start(path, y, quality):
    """Encode -> decode -> verify.  A lossy codec smears a transient that sits
    on the very first samples ("pre-echo"), so the decoded file would not
    start at zero.  We prepend the shortest lead-in (0 .. 2 ms of digital
    silence) for which the *decoded* first sample is below -45 dBFS."""
    best = None
    for pad_ms in (0.0, 0.5, 1.0, 1.5, 2.0):
        z = np.concatenate([np.zeros((ns(pad_ms / 1000.0),) + y.shape[1:]), y])
        write_ogg(path, z, quality)
        d, _ = sf.read(path)
        first = float(np.max(np.abs(d[0])))
        if best is None or first < best[0]:
            best = (first, pad_ms)
        if first <= lin(-45.0):
            return pad_ms
    z = np.concatenate([np.zeros((ns(best[1] / 1000.0),) + y.shape[1:]), y])
    write_ogg(path, z, quality)
    return best[1]


def finalize_loop(x, target):
    x = x - np.mean(x)
    return x * lin(target - lufs_integrated(x, circular=True))


def main(argv):
    only = set(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    t_all = time.time()

    def want(name):
        return not only or name in only

    for name, (fn, spec) in ONESHOTS.items():
        if want(name):
            y = finalize_oneshot(fn(), **spec)
            pad = encode_clean_start(OUT / f"{name}.ogg", y, 4)
            print(f"{name:18s} {len(y) / SR + pad / 1000:6.3f} s  peak {peak_db(y):6.2f} dBFS  L100 {loud_window(y):6.2f}"
                  f"  lead-in {pad:.1f} ms")
    for name, (fn, target) in LOOPS.items():
        if want(name):
            y = finalize_loop(fn(), target)
            write_ogg(OUT / f"{name}.ogg", y, 4)
            print(f"{name:18s} {len(y) / SR:6.3f} s  peak {peak_db(y):6.2f} dBFS  LUFS {lufs_integrated(y, True):6.2f}  (loop)")
    for name, (fn, loop) in STEREO.items():
        if want(name):
            t0 = time.time()
            y = fn()
            if loop:
                write_ogg(OUT / f"{name}.ogg", y, 5)
            else:
                encode_clean_start(OUT / f"{name}.ogg", y, 5)
            print(f"{name:18s} {len(y) / SR:6.3f} s  peak {peak_db(y):6.2f} dBFS  LUFS {lufs_integrated(y, loop):6.2f}"
                  f"  ({'loop' if loop else 'one-shot'}, rendered in {time.time() - t0:.1f} s)")
    print(f"done in {time.time() - t_all:.1f} s -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
