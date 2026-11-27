#!/usr/bin/env python3
"""Analytical verification of the encoded assets (we cannot listen, so we measure).

    python3 tools/audio/analyze.py [--spectrograms DIR]

For every game/public/audio/*.ogg (decoded again from the OGG file):
  duration, channels, peak dBFS, RMS, loudness (BS.1770 integrated LUFS and
  max 100 ms K-weighted window), spectral centroid, share of energy in
  200 Hz-4 kHz / above 6 kHz, DC offset, first/last sample level, onset
  latency, clipping.
For loops (*_loop, music_*): seam checks at the wrap point (sample step,
  second difference and high-frequency "click" energy compared with the rest
  of the file), plus a silence-gap scan for the music.
Exit code 1 if any hard check fails.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth import SR, db, k_weight, loud_window, lufs_integrated, peak_db, spectral_centroid  # noqa: E402

AUDIO = Path(__file__).resolve().parents[2] / "game" / "public" / "audio"

EXPECTED = """ui_tap ui_pick ui_place ui_rotate ui_return ui_error ui_start ui_stop ui_hint ui_panel
wood_hit_1 wood_hit_2 wood_hit_3 metal_hit_1 metal_hit_2 rubber_bounce_1 rubber_bounce_2
domino_1 domino_2 domino_3 boing pop basket_land seesaw button_click lamp_on fan_loop conveyor_loop
fuse rocket_launch firework bell win_fanfare star unlock confetti game_complete music_workshop music_menu""".split()
STEREO = {"win_fanfare", "game_complete", "music_workshop", "music_menu"}
LOOPS = {"fan_loop", "conveyor_loop", "music_workshop", "music_menu"}
IMPACTS = {"ui_tap", "ui_place", "ui_rotate", "wood_hit_1", "wood_hit_2", "wood_hit_3", "metal_hit_1", "metal_hit_2",
           "rubber_bounce_1", "rubber_bounce_2", "domino_1", "domino_2", "domino_3", "boing", "pop", "basket_land",
           "seesaw", "button_click", "bell", "ui_start", "lamp_on"}


def band_share(x, lo, hi):
    m = x.mean(axis=1)
    f, p = signal.welch(m, SR, nperseg=min(4096, max(256, len(m))))
    return float(np.sum(p[(f >= lo) & (f < hi)]) / max(np.sum(p), 1e-30))


def onset_ms(x):
    a = np.max(np.abs(x), axis=1)
    return 1000.0 * int(np.argmax(a >= 0.1 * a.max())) / SR


def seam_report(x):
    """Is the wrap point (last sample -> first sample) an ordinary point?"""
    n = len(x)
    step = float(np.max(np.abs(x[0] - x[-1])))
    d1 = np.max(np.abs(np.diff(x, axis=0)), axis=1)
    loc = np.concatenate([d1[-2048:], d1[:2048]])
    ext = np.concatenate([x[-3:], x[:3]], axis=0)
    d2_seam = float(np.max(np.abs(np.diff(ext, 2, axis=0))))
    d2 = np.max(np.abs(np.diff(x, 2, axis=0)), axis=1)
    # high-frequency click detector: energy above 7 kHz in 64-sample windows
    tile = np.concatenate([x[-8192:], x, x[:8192]], axis=0).mean(axis=1)
    hf = signal.sosfilt(signal.butter(4, 7000.0, "high", fs=SR, output="sos"), tile) ** 2
    w = 64
    e = np.convolve(hf, np.ones(w), mode="valid")[::16]
    centers = np.arange(len(e)) * 16 + w // 2
    seam_pos = (8192, 8192 + n)  # both copies of the wrap point inside the tile
    seam_e = max(float(np.max(e[np.abs(centers - p) <= w])) for p in seam_pos)
    body = e[(centers > 8192 + 4 * w) & (centers < 8192 + n - 4 * w)]
    return dict(step=step, d1_med=float(np.median(d1)), d1_p999=float(np.percentile(d1, 99.9)), d1_max=float(d1.max()),
                d1_local_max=float(loc.max()), d2_seam=d2_seam, d2_p999=float(np.percentile(d2, 99.9)),
                hf_seam_pct=float(np.mean(body <= seam_e) * 100.0),
                hf_seam_db=10 * np.log10(seam_e + 1e-20), hf_p99_db=10 * np.log10(np.percentile(body, 99) + 1e-20),
                hf_max_db=10 * np.log10(body.max() + 1e-20))


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    tail = r[r.rfind("Summary:") :]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    lra = re.search(r"LRA:\s+(-?[\d.]+) LU", tail)
    tp = re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail)
    return (float(i.group(1)) if i else None, float(lra.group(1)) if lra else None, float(tp.group(1)) if tp else None)


def spectrogram(path, out, extra=()):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *extra, "-i", str(path), "-lavfi",
           "aformat=channel_layouts=mono,showspectrumpic=s=1500x560:legend=1:scale=log:fscale=log:start=60:stop=12000:drange=80",
           str(out)]
    subprocess.run(cmd, check=True)


def melody_check():
    """Is the written tune really the most prominent thing in its register?

    For every melody note of the score we look at the decoded audio right
    after the note's onset and ask which semitone between A4 and E6 carries
    the most energy.  It should be the written pitch."""
    import music as M
    from synth import midi_hz
    good = True
    print("\nMELODY CHECK (strongest semitone in A4..E6 within 150 ms after each written melody onset)")
    jobs = [("music_workshop", [M.W_MEL_A, M.W_MEL_A2, M.W_MEL_B, M.W_MEL_A3], 4, 8, 0.075),
            ("music_menu", [M.M_MEL[0:8], M.M_MEL[8:16], M.M_MEL[16:24]], 3, 8, 0.0)]
    for name, sections, meter, bars_per, swing in jobs:
        p = AUDIO / f"{name}.ogg"
        if not p.exists():
            continue
        x, _ = sf.read(p, always_2d=True)
        x = x.mean(axis=1)
        nbars = len(sections) * bars_per
        beat_s = len(x) / SR / (nbars * meter)
        hits, total, per_sec = 0, 0, []
        semis = np.arange(69, 89)
        for si, sec in enumerate(sections):
            h = t = 0
            for k, line in enumerate(sec):
                for b, dur, m in M.parse(line):
                    beat = (si * bars_per + k) * meter + b
                    f = beat - np.floor(beat)
                    f = f * (0.5 + swing) / 0.5 if f <= 0.5 else (0.5 + swing) + (f - 0.5) * (0.5 - swing) / 0.5
                    t0 = (np.floor(beat) + f) * beat_s + 0.03
                    seg = x[int((t0 + 0.02) * SR) : int((t0 + 0.02 + min(0.15, dur * beat_s * 0.8)) * SR)]
                    if len(seg) < 1024:
                        continue
                    tt_ = np.arange(len(seg)) / SR
                    win = np.hanning(len(seg))
                    e = [abs(np.sum(seg * win * np.exp(-2j * np.pi * midi_hz(s) * tt_))) for s in semis]
                    t += 1
                    h += int(semis[int(np.argmax(e))] == m)
            per_sec.append(f"{h}/{t}")
            hits += h
            total += t
        print(f"  {name:15s} {hits}/{total} melody notes are the strongest pitch in their register (per section: {', '.join(per_sec)})")
        good &= hits >= 0.9 * total
    return good


def decoder_cross_check():
    """Decode every file a second time with ffmpeg's own Vorbis decoder (the
    one Chrome uses for decodeAudioData) and compare with libsndfile/libvorbis:
    same number of samples (matters for gapless loops) and same waveform."""
    bad = []
    for name in EXPECTED:
        p = AUDIO / f"{name}.ogg"
        if not p.exists():
            continue
        a, _ = sf.read(p, always_2d=True, dtype="float32")
        raw = subprocess.run(["ffmpeg", "-v", "error", "-c:a", "vorbis", "-i", str(p), "-f", "f32le", "-"],
                             capture_output=True).stdout
        b = np.frombuffer(raw, dtype=np.float32).reshape(-1, a.shape[1])
        m = min(len(a), len(b))
        if len(a) != len(b) or float(np.max(np.abs(a[:m] - b[:m]))) > 1e-4:
            bad.append(f"{name} (libsndfile {len(a)} / ffmpeg {len(b)} samples)")
    print("\nDECODER CROSS-CHECK (libsndfile vs ffmpeg native vorbis decoder): "
          + ("identical sample counts and waveforms for all files" if not bad else "MISMATCH: " + ", ".join(bad)))
    return not bad


def main(argv):
    spec_dir = None
    if "--spectrograms" in argv:
        spec_dir = Path(argv[argv.index("--spectrograms") + 1])
        spec_dir.mkdir(parents=True, exist_ok=True)
    ok = True
    rows = []
    missing = [n for n in EXPECTED if not (AUDIO / f"{n}.ogg").exists()]
    extra = sorted(p.stem for p in AUDIO.glob("*") if p.stem not in EXPECTED or p.suffix != ".ogg")
    if missing or extra:
        ok = False
        print("MISSING:", missing, "UNEXPECTED:", extra)
    print(f"{'file':17s} ch   dur s  peak dB  rms dB   LUFS   L100  centr Hz 200-4k  >6k   DC      first   last  onset ms  notes")
    for name in EXPECTED:
        p = AUDIO / f"{name}.ogg"
        if not p.exists():
            continue
        x, sr = sf.read(p, always_2d=True)
        info = sf.info(p)
        notes = []
        if sr != SR or info.format != "OGG" or info.subtype != "VORBIS":
            notes.append(f"FORMAT {info.format}/{info.subtype}/{sr}")
            ok = False
        if x.shape[1] != (2 if name in STEREO else 1):
            notes.append("CHANNELS")
            ok = False
        loop = name in LOOPS
        pk = peak_db(x)
        rms = db(np.sqrt(np.mean(x**2)))
        lufs = lufs_integrated(x, circular=loop)
        l100 = loud_window(x, 0.1)
        dc = float(np.max(np.abs(x.mean(axis=0))))
        first, last = db(np.max(np.abs(x[0]))), db(np.max(np.abs(x[-1])))
        on = onset_ms(x)
        if pk > -1.0:
            notes.append("PEAK>-1dBFS")
            ok = False
        if dc > 0.03 * 10 ** (rms / 20.0):  # DC component above 3 % of the RMS level
            notes.append("DC")
            ok = False
        if not loop:
            if first > -44.5 or last > -55.0:
                notes.append("EDGE-NOT-SILENT")
                ok = False
            if name in IMPACTS and on > 3.0:
                notes.append("LATE-ONSET")
                ok = False
        rows.append((name, x.shape[1], len(x) / SR, pk, rms, lufs, l100, spectral_centroid(x)))
        print(f"{name:17s} {x.shape[1]}  {len(x) / SR:7.3f}  {pk:6.2f}  {rms:6.2f}  {lufs:6.2f} {l100:6.2f}  {spectral_centroid(x):7.0f}  "
              f"{band_share(x, 200, 4000) * 100:4.0f}%  {band_share(x, 6000, 22050) * 100:4.1f}%  {dc:.1e}  {first:6.1f} {last:6.1f}  {on:6.2f}   {' '.join(notes)}")
        if spec_dir is not None:
            spectrogram(p, spec_dir / f"{name}.png")
            if name.startswith("music_"):
                spectrogram(p, spec_dir / f"{name}_first14s.png", ("-t", "14"))
                spectrogram(p, spec_dir / f"{name}_wrap.png", ("-stream_loop", "1", "-ss", str(len(x) / SR - 7), "-t", "14"))

    print("\nLOOP SEAM CHECKS (decoded OGG; wrap = last sample -> first sample)")
    for name in sorted(LOOPS):
        p = AUDIO / f"{name}.ogg"
        if not p.exists():
            continue
        x, _ = sf.read(p, always_2d=True)
        s = seam_report(x)
        good_step = s["step"] <= s["d1_local_max"] and s["step"] <= s["d1_p999"]
        good_d2 = s["d2_seam"] <= s["d2_p999"] * 1.5
        good_hf = s["hf_seam_db"] <= s["hf_max_db"]
        verdict = "OK" if (good_step and good_d2 and good_hf) else "FAIL"
        ok &= verdict == "OK"
        print(f"  {name:16s} {verdict}: wrap step {s['step']:.5f} | neighbour steps: median {s['d1_med']:.5f}, p99.9 {s['d1_p999']:.5f}, "
              f"max {s['d1_max']:.5f}, max within 46 ms of wrap {s['d1_local_max']:.5f}")
        print(f"  {'':16s} 2nd difference at wrap {s['d2_seam']:.5f} (file p99.9 {s['d2_p999']:.5f}) | >7 kHz click energy at wrap "
              f"{s['hf_seam_db']:.1f} dB = percentile {s['hf_seam_pct']:.1f} of all windows (p99 {s['hf_p99_db']:.1f} dB, max {s['hf_max_db']:.1f} dB)")
        # level continuity across the wrap: 50 ms RMS just before vs just after
        a, b = db(np.sqrt(np.mean(x[-2205:] ** 2))), db(np.sqrt(np.mean(x[:2205] ** 2)))
        print(f"  {'':16s} RMS last 50 ms {a:.1f} dB / first 50 ms {b:.1f} dB")

    print("\nMUSIC / FANFARES (ffmpeg ebur128 cross-check + gap scan)")
    for name in ("music_workshop", "music_menu", "win_fanfare", "game_complete"):
        p = AUDIO / f"{name}.ogg"
        if not p.exists():
            continue
        x, _ = sf.read(p, always_2d=True)
        i, lra, tp = ebur128(p)
        y = k_weight(x)
        blk = int(0.4 * SR)
        z = np.array([np.sum(np.mean(y[j : j + blk] ** 2, axis=0)) for j in range(0, len(y) - blk, blk // 4)])
        st = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
        mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
        corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1])
        print(f"  {name:15s} ebur128 I {i} LUFS, LRA {lra} LU, true peak {tp} dBFS | 400 ms loudness min {st.min():.1f} / median "
              f"{np.median(st):.1f} / max {st.max():.1f} LUFS | L/R correlation {corr:.2f}, side/mid {db(np.std(side) / np.std(mid)):.1f} dB")
        if name.startswith("music_") and st.min() < -40.0:
            print("     WARNING: (near-)silent gap")
            ok = False

    ok &= melody_check()
    ok &= decoder_cross_check()

    total = sum(f.stat().st_size for f in AUDIO.glob("*.ogg"))
    print(f"\n{len(list(AUDIO.glob('*.ogg')))} files, total {total / 1024:.0f} KiB ({total / 1e6:.2f} MB)")
    for f in sorted(AUDIO.glob("*.ogg"), key=lambda f: -f.stat().st_size)[:6]:
        print(f"   {f.name:20s} {f.stat().st_size / 1024:7.0f} KiB")
    print("ALL HARD CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
