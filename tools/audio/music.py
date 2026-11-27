"""Music + fanfares for "Wolfgangs Tueftelwerkstatt" (all stereo).

Everything is written as note data (chords, melody, bass, percussion) in
F major, rendered with the instruments from instruments.py, humanised
(velocity + timing jitter, light swing) and mixed through a synthetic
convolution reverb.

Loops are rendered *circularly*: every note and the complete reverb tail are
wrapped modulo the loop length, so the end of the file flows into its start
with no discontinuity (the wrap point is just another point in the music).
"""
from __future__ import annotations

import numpy as np
from scipy import signal

import instruments as I
from synth import SR, hp, lin, loud_window, lufs_integrated, make_ir, nn, ns, peak_db, soft_limit, softclip

# --------------------------------------------------------------------------
# mixer
# --------------------------------------------------------------------------

_TONES: dict = {}


def tone(fn, *args):
    """Instrument note, loudness-normalised (K-weighted, 100 ms) to -20 dB so
    that mixer gains mean the same thing for every instrument and pitch."""
    key = (fn.__name__, args)
    if key not in _TONES:
        y = getattr(fn, "__wrapped__", fn)(*args)  # bypass the lru_cache: one copy is enough
        _TONES[key] = (y * lin(-20.0 - loud_window(y, 0.1))).astype(np.float32)
    return _TONES[key]


def free_tones():
    """Drop the rendered-note cache (keeps the build's memory footprint small)."""
    _TONES.clear()


class Mix:
    def __init__(self, n, loop):
        self.n = int(n)
        self.loop = loop
        self.offset = 0.03 if loop else 0.0  # keeps every note attack clear of the wrap point
        self.dry = np.zeros((self.n, 2))
        self.send = np.zeros((self.n, 2))

    def _put(self, buf, i, st):
        n, L = self.n, len(st)
        if self.loop:
            i %= n
            pos = 0
            while pos < L:
                k = min(n - i, L - pos)
                buf[i : i + k] += st[pos : pos + k]
                pos += k
                i = 0
        else:
            i = max(i, 0)
            k = min(L, n - i)
            if k > 0:
                buf[i : i + k] += st[:k]

    def add(self, t, sig, gain_db=0.0, pan=0.0, send=0.2, vel=1.0):
        g = lin(gain_db) * vel
        th = (pan + 1.0) * np.pi / 4.0
        st = np.stack([sig * (g * np.cos(th) * np.sqrt(2.0)), sig * (g * np.sin(th) * np.sqrt(2.0))], axis=1)
        i = int(round((t + self.offset) * SR))
        self._put(self.dry, i, st)
        if send > 0:
            self._put(self.send, i, st * send)

    def render(self, ir, wet=1.0):
        s, wet_gain = self.send, wet
        inl = 0.72 * s[:, 0] + 0.28 * s[:, 1]
        inr = 0.28 * s[:, 0] + 0.72 * s[:, 1]
        wet = np.stack([signal.fftconvolve(inl, ir[:, 0]), signal.fftconvolve(inr, ir[:, 1])], axis=1)
        del inl, inr
        self.send = None
        if self.loop:  # fold the reverb tail back onto the loop start
            pad = (-len(wet)) % self.n
            wet = np.pad(wet, ((0, pad), (0, 0))).reshape(-1, self.n, 2).sum(axis=0)
        else:
            wet = wet[: self.n]
        return self.dry + wet_gain * wet


def master(x, loop, target_lufs, ceiling_db=-2.0, drive=1.0, lowcut=45.0):
    """High-pass, glue saturation, loudness normalise, soft-limit.

    All stages are either memoryless or run with a wrapped-around run-in so
    the result stays periodic."""
    if loop:
        pre = min(len(x), 4 * SR)  # run-in from the loop's own end -> filter state is periodic
        y = hp(np.concatenate([x[-pre:], x], axis=0), lowcut, 2)[pre:]
    else:
        y = hp(x, lowcut, 2)
    y = y / (np.max(np.abs(y)) + 1e-12)
    y = softclip(y * drive, 1.0) if drive > 0 else y
    for _ in range(3):
        y = y * lin(target_lufs - lufs_integrated(y, circular=loop))
        y = soft_limit(y, lin(ceiling_db), 0.7)
    return y


MUSIC_IR = make_ir(np.random.default_rng(7001), t60=1.3, predelay=0.02, channels=2, er_count=10,
                   er_span=0.055, hf_ratio=0.5, lf_ratio=1.0, lowcut=220.0, highcut=6000.0)

# --------------------------------------------------------------------------
# score helpers
# --------------------------------------------------------------------------

CH = {
    "F": ["A3", "C4", "F4"], "Dm7": ["A3", "C4", "D4"], "Dm": ["A3", "D4", "F4"], "Gm7": ["Bb3", "D4", "F4"],
    "C7": ["Bb3", "C4", "E4"], "D7": ["A3", "C4", "F#4"], "A7": ["G3", "C#4", "E4"], "Bb": ["Bb3", "D4", "F4"],
    "Bdim7": ["Ab3", "B3", "D4"], "F/C": ["A3", "C4", "F4"], "G7": ["B3", "D4", "F4"], "C": ["G3", "C4", "E4"],
    "C7sus": ["Bb3", "C4", "F4"], "F7": ["A3", "C4", "Eb4"], "Bbm6": ["Bb3", "Db4", "G4"], "F/A": ["A3", "C4", "F4"],
}
ARP = {  # low broken-chord figures (marimba accompaniment in the bridge)
    "Bb": ["Bb3", "D4", "F4", "Bb4"], "Bdim7": ["B3", "D4", "F4", "Ab4"], "F/C": ["C4", "F4", "A4", "C5"],
    "D7": ["D4", "F#4", "A4", "C5"], "Gm7": ["G3", "Bb3", "D4", "F4"], "G7": ["G3", "B3", "D4", "F4"],
    "C": ["G3", "C4", "E4", "G4"], "C7": ["G3", "Bb3", "C4", "E4"], "C7sus": ["G3", "Bb3", "C4", "F4"],
}


def parse(line):
    """'C5:1 F5:.5 r:1' -> [(beat, dur, midi)]"""
    out, b = [], 0.0
    for tok in line.split():
        name, d = tok.split(":")
        d = float(d)
        if name != "r":
            out.append((b, d, nn(name)))
        b += d
    return out


class Human:
    """Timing: swing for off-beat eighths + small gaussian jitter; velocity jitter."""

    def __init__(self, seed, beat_s, swing=0.0):
        self.rng = np.random.default_rng(seed)
        self.beat = beat_s
        self.swing = swing

    def time(self, beat, jitter=0.006, lag=0.0):
        whole = np.floor(beat)
        f = beat - whole
        s = self.swing
        f = f * (0.5 + s) / 0.5 if f <= 0.5 else (0.5 + s) + (f - 0.5) * (0.5 - s) / 0.5
        return (whole + f) * self.beat + lag + self.rng.normal(0.0, jitter)

    def vel(self, v, jitter=0.05):
        return float(np.clip(v * (1.0 + self.rng.normal(0.0, jitter)), 0.05, 1.0))


def vgain(v):
    """velocity -> amplitude (in addition to the timbre change)."""
    return v**1.25


# --------------------------------------------------------------------------
# main loop: "In der Werkstatt"  -  F major, 4/4, 104 BPM, AA'BA, 32 bars
# --------------------------------------------------------------------------

W_BPM = 104.0
W_BARS = 32

W_CHORDS = [  # per bar: [(beat, chord)]
    [(0, "F")], [(0, "Dm7")], [(0, "Gm7")], [(0, "C7")], [(0, "F")], [(0, "D7")], [(0, "Gm7"), (2, "C7")], [(0, "F"), (3, "C7")],
    [(0, "F")], [(0, "Dm7")], [(0, "Gm7")], [(0, "C7")], [(0, "F")], [(0, "A7")], [(0, "Bb"), (2, "C7")], [(0, "F")],
    [(0, "Bb")], [(0, "Bdim7")], [(0, "F/C")], [(0, "D7")], [(0, "Gm7")], [(0, "G7")], [(0, "C")], [(0, "C7sus"), (2, "C7")],
    [(0, "F")], [(0, "Dm7")], [(0, "Gm7")], [(0, "C7")], [(0, "F")], [(0, "A7")], [(0, "Bb"), (2, "C7")], [(0, "F"), (3, "C7")],
]

W_MEL_A = [
    "C5:1 F5:1 A5:1 G5:.5 F5:.5",
    "D5:1.5 F5:.5 D5:2",
    "Bb4:1 D5:1 G5:1 F5:.5 D5:.5",
    "E5:1.5 G5:.5 C5:2",
    "C5:1 F5:1 A5:1 C6:.5 A5:.5",
    "F#5:1.5 A5:.5 D5:1 F#5:.5 A5:.5",
    "Bb5:1 G5:1 E5:1 G5:.5 E5:.5",
    "F5:2 r:1 A4:.5 Bb4:.5",
]
W_MEL_A2 = W_MEL_A[:5] + [
    "A5:1.5 G5:.5 E5:1 C#5:.5 E5:.5",
    "D5:1 F5:1 E5:1 G5:.5 E5:.5",
    "F5:2 r:1 A4:.5 C5:.5",
]
W_MEL_A3 = W_MEL_A2[:7] + ["F5:2 r:1 A4:.5 Bb4:.5"]
W_MEL_B = [
    "D5:2 F5:1 Bb5:1",
    "Ab5:2 F5:1 D5:1",
    "A5:1.5 F5:.5 C5:2",
    "D5:1 F#5:1 A5:1 C6:1",
    "Bb5:1.5 A5:.5 G5:2",
    "B4:1 D5:1 F5:1 A5:1",
    "G5:2 E5:1 C5:1",
    "F5:2 E5:1 A4:.5 Bb4:.5",
]
# glockenspiel "answers" in the gaps of the tune: {bar index within section: line}
W_GLOCK = {1: "r:2.5 A6:.5 F6:1", 3: "r:2.5 E6:.5 G6:1", 7: "r:1 C6:.5 F6:.5 A6:1 r:1"}
W_GLOCK_LAST = {1: "r:2.5 A6:.5 F6:1", 3: "r:2.5 E6:.5 G6:1", 7: "r:1 F6:.5 C6:.5 A5:1 r:1"}

W_BASS_A = [
    "F2:2 C3:2", "D3:2 A2:2", "G2:2 D3:2", "C3:2 G2:1 E2:1", "F2:2 C3:2", "D3:2 A2:1 F#2:1", "G2:2 C3:2", "F2:2 A2:1 C3:1",
]
W_BASS_A2 = W_BASS_A[:5] + ["A2:2 E3:1 A2:1", "Bb2:2 C3:2", "F2:2 C3:1 A2:1"]
W_BASS_B = ["Bb2:2 D3:2", "B2:2 D3:2", "C3:2 A2:2", "D3:2 F#2:2", "G2:2 D3:2", "G2:2 B2:2", "C3:2 G2:2", "C3:2 G2:1 E2:1"]
W_BASS_A3 = W_BASS_A2[:7] + ["F2:2 A2:1 C3:1"]


def chord_at(bar_chords, beat):
    name = bar_chords[0][1]
    for b, c in bar_chords:
        if beat >= b:
            name = c
    return name


def music_workshop():
    beats = W_BARS * 4
    n = int(round(beats * 60.0 / W_BPM * SR))
    beat_s = n / SR / beats
    mx = Mix(n, loop=True)
    hu = Human(4242, beat_s, swing=0.075)

    def dyn(bar):
        """Section level + phrase arch -> the dynamics 'breathe'."""
        sec = bar // 8
        base = (0.80, 0.93, 0.76, 1.0)[sec]
        arch = (0.95, 0.97, 1.0, 0.98, 1.02, 1.06, 1.08, 0.94)[bar % 8]
        if bar == 31:
            arch = 0.86  # relax into the repeat
        return base * arch

    sections = [(W_MEL_A, W_BASS_A), (W_MEL_A2, W_BASS_A2), (W_MEL_B, W_BASS_B), (W_MEL_A3, W_BASS_A3)]
    for bar in range(W_BARS):
        sec, k = bar // 8, bar % 8
        b0 = bar * 4.0
        d = dyn(bar)
        mel, bas = sections[sec]

        # ---- melody ------------------------------------------------------
        for i, (b, dur, m) in enumerate(parse(mel[k])):
            accent = 1.06 if b == 0 else (0.94 if (b % 1) else 1.0)
            if sec != 2:  # marimba carries the tune
                v = hu.vel(0.74 * d * accent)
                mx.add(hu.time(b0 + b, 0.006), tone(I.marimba, m, I.vlayer(v), (bar + i) % 2), 0.0, -0.12, 0.22, vgain(v))
                if sec == 3:  # last time: celesta sparkle an octave above
                    v2 = hu.vel(0.5 * d * accent)
                    mx.add(hu.time(b0 + b, 0.007, 0.004), tone(I.celesta, m + 12, I.vlayer(v2), 0), -9.5, 0.3, 0.3, vgain(v2))
                elif sec == 1 and dur >= 1.0:  # A': pizzicato doubles the longer notes, octave lower
                    v2 = hu.vel(0.5 * d)
                    mx.add(hu.time(b0 + b, 0.008, 0.003), tone(I.pizz, m - 12, I.vlayer(v2), i % 2), -11.0, -0.4, 0.25, vgain(v2))
            else:  # bridge: celesta sings, music box doubles softly
                v = hu.vel(0.72 * d * accent)
                mx.add(hu.time(b0 + b, 0.007), tone(I.celesta, m, I.vlayer(v), 0), -0.5, 0.14, 0.32, vgain(v))
                v2 = hu.vel(0.5 * d)
                mx.add(hu.time(b0 + b, 0.008, 0.005), tone(I.musicbox, m + 12, I.vlayer(v2), 0), -13.0, 0.32, 0.35, vgain(v2))

        # ---- glockenspiel answers -----------------------------------------
        if sec in (1, 3):
            gl = (W_GLOCK if sec == 1 else W_GLOCK_LAST).get(k)
            if gl:
                for b, dur, m in parse(gl):
                    v = hu.vel(0.55 * d)
                    mx.add(hu.time(b0 + b, 0.006), tone(I.glock, m, I.vlayer(v), 0), -9.0, 0.38, 0.36, vgain(v))

        # ---- bass -----------------------------------------------------------
        for b, dur, m in parse(bas[k]):
            v = hu.vel((0.72 if b == 0 else 0.62) * d)
            ms = int(round(dur * 0.82 * beat_s * 1000 / 20.0) * 20)
            mx.add(hu.time(b0 + b, 0.005, 0.006), tone(I.bass, m, I.vlayer(v), ms, 0), -4.0, 0.0, 0.07, vgain(v))

        # ---- pizzicato off-beat chords ---------------------------------------
        for b in (1.0, 3.0):
            if sec == 2 and b == 1.0:
                continue  # thinner bridge
            name = chord_at(W_CHORDS[bar], b)
            base_v = (0.5 if b == 1.0 else 0.56) * d * (0.85 if sec == 2 else 1.0)
            for j, nm in enumerate(CH[name]):
                v = hu.vel(base_v, 0.07)
                mx.add(hu.time(b0 + b, 0.004, 0.004 * j), tone(I.pizz, nn(nm), I.vlayer(v), (bar + j) % 2),
                       -7.5, -0.38 + 0.08 * j, 0.26, vgain(v))
        if sec == 3 and k in (0, 2, 4):  # last A: a little pizzicato pick-up on "4-and"
            name = chord_at(W_CHORDS[bar], 3.5)
            v = hu.vel(0.42 * d)
            mx.add(hu.time(b0 + 3.5, 0.005), tone(I.pizz, nn(CH[name][2]) + 12, I.vlayer(v), 0), -10.0, -0.3, 0.26, vgain(v))

        # ---- bridge: marimba broken chords + warm pad -----------------------
        if sec == 2:
            for (cb, cname) in W_CHORDS[bar]:
                span = (4.0 - cb) if len(W_CHORDS[bar]) == 1 else 2.0
                arp = ARP[cname]
                pat = [(0, 0), (1, 1), (2, 2), (2.5, 3), (3, 1)] if span == 4.0 else [(0, 0), (1, 2), (1.5, 3)]
                for pb, idx in pat:
                    v = hu.vel(0.42 * d, 0.08)
                    mx.add(hu.time(b0 + cb + pb, 0.007), tone(I.marimba, nn(arp[idx]), I.vlayer(v), idx % 2),
                           -8.5, -0.3, 0.25, vgain(v))

        # ---- warm pad glue (barely there in the A sections, fuller in the bridge)
        chs = W_CHORDS[bar]
        for ci, (cb, cname) in enumerate(chs):
            span = (chs[ci + 1][0] if ci + 1 < len(chs) else 4.0) - cb
            ms = int(round(span * beat_s * 1000 / 50.0) * 50)
            for j, nm in enumerate(CH[cname]):
                mx.add((b0 + cb) * beat_s, tone(I.pad, nn(nm), ms, j), -16.5 if sec == 2 else -22.0,
                       (-0.45, 0.45, 0.0)[j], 0.22, 0.8 * d)

        # ---- clockwork percussion ---------------------------------------------
        quiet = sec == 2
        for b in (0.0, 1.0, 2.0, 3.0):
            kind = "hi" if b in (0.0, 2.0) else "lo"
            if quiet and kind == "hi":
                continue
            v = hu.vel((0.6 if kind == "hi" else 0.5) * d * (0.8 if quiet else 1.0), 0.06)
            mx.add(hu.time(b0 + b, 0.003), tone(I.woodblock, kind, I.vlayer(v), int(b) % 2 + 2 * (bar % 2)),
                   -14.0, 0.24 if kind == "hi" else -0.2, 0.2, vgain(v))
        if sec in (1, 3) or (sec == 0 and k >= 4) or sec == 2:
            for b in (0.5, 1.5, 2.5, 3.5):  # swung off-beat shaker
                v = hu.vel((0.45 if b in (1.5, 3.5) else 0.36) * d, 0.1)
                mx.add(hu.time(b0 + b, 0.005), tone(I.shaker, I.vlayer(v), int(b * 2) % 4), -19.0, 0.45, 0.15, vgain(v))
        if not quiet:
            for b in (1.0, 3.0):
                v = hu.vel(0.5 * d, 0.08)
                mx.add(hu.time(b0 + b, 0.005), tone(I.brush, I.vlayer(v), int(b) % 2), -17.5, -0.42, 0.2, vgain(v))
        v = hu.vel(0.6 * d)
        mx.add(hu.time(b0, 0.003), tone(I.thump, I.vlayer(v), 0), -11.0, 0.0, 0.05, vgain(v))
        if not quiet:
            v = hu.vel(0.42 * d)
            mx.add(hu.time(b0 + 2.0, 0.003), tone(I.thump, I.vlayer(v), 0), -13.0, 0.0, 0.05, vgain(v))
        # little ratchet "wind-up" fills leading into the next section
        fill = {7: [3.0, 3.25, 3.5, 3.75], 15: [2.5, 2.75, 3.0, 3.25, 3.5, 3.75], 23: [3.0, 3.5, 3.75], 31: [3.5, 3.75]}.get(bar)
        if fill:
            for j, b in enumerate(fill):
                v = 0.35 + 0.4 * (j + 1) / len(fill)
                mx.add((b0 + b) * beat_s + hu.rng.normal(0, 0.003), tone(I.ratchet_click, I.vlayer(v), j % 4),
                       -16.0, 0.3, 0.2, vgain(v))

    free_tones()
    return master(mx.render(MUSIC_IR, 1.5), True, -18.0, ceiling_db=-3.0, drive=0.8)


# --------------------------------------------------------------------------
# menu: "Spieluhr-Walzer"  -  same theme as a lullaby waltz, 3/4, 90 BPM, 24 bars
# --------------------------------------------------------------------------

M_BPM = 90.0
M_CHORDS = ["F", "F", "Dm", "Dm", "Gm7", "C7", "F", "C7",
            "F", "F", "Dm", "D7", "Gm7", "C7", "F", "F7",
            "Bb", "Bbm6", "F/A", "D7", "Gm7", "C7", "F", "C7"]
M_BASS = ["F2", "C3", "D3", "A2", "G2", "C3", "F2", "C3",
          "F2", "C3", "D3", "D3", "G2", "C3", "F2", "A2",
          "Bb2", "Bb2", "A2", "D3", "G2", "C3", "F2", "C3"]
M_MEL = [
    "C5:1 F5:1 A5:1", "G5:2 F5:1", "D5:1 F5:1 A5:1", "F5:2 D5:1", "Bb4:1 D5:1 G5:1", "E5:2 G5:1", "F5:3", "r:1 G5:1 E5:1",
    "C5:1 F5:1 A5:1", "C6:2 A5:1", "D5:1 F5:1 A5:1", "A5:2 F#5:1", "Bb5:2 G5:1", "G5:2 E5:1", "F5:3", "r:1 A5:1 C6:1",
    "D6:2 Bb5:1", "Db6:2 Bb5:1", "C6:2 A5:1", "C6:1 A5:1 F#5:1", "G5:2 A5:1", "Bb5:1 G5:1 E5:1", "F5:3", "r:1 E5:1 D5:1",
]
M_COUNTER = {  # soft celesta counter-line in the second and third phrase (half-bar guide tones)
    8: "A4:3", 9: "A4:2 C5:1", 10: "F4:3", 11: "F#4:3", 12: "G4:2 Bb4:1", 13: "Bb4:3", 14: "A4:2 C5:1", 15: "Eb5:3",
    16: "F5:3", 17: "F5:2 G5:1", 18: "F5:3", 19: "F#5:3", 20: "D5:3", 21: "C5:2 Bb4:1", 22: "A4:3",
}


def music_menu():
    bars = len(M_CHORDS)
    beats = bars * 3
    n = int(round(beats * 60.0 / M_BPM * SR))
    beat_s = n / SR / beats
    mx = Mix(n, loop=True)
    hu = Human(777, beat_s, swing=0.0)
    for bar in range(bars):
        sec, k = bar // 8, bar % 8
        b0 = bar * 3.0
        d = (0.86, 0.95, 1.0)[sec] * (0.96, 1.0, 1.0, 0.98, 1.03, 1.05, 0.98, 0.9)[k]
        ch = M_CHORDS[bar]
        # melody: music box (+ a quiet octave shimmer from the second phrase on)
        for i, (b, dur, m) in enumerate(parse(M_MEL[bar])):
            rub = 0.012 * np.sin(np.pi * (b / 3.0))  # tiny rubato inside the bar
            v = hu.vel(0.7 * d * (1.05 if b == 0 else 0.95))
            t = hu.time(b0 + b, 0.008, rub)
            mx.add(t, tone(I.musicbox, m, I.vlayer(v), i % 2), 0.0, 0.08, 0.34, vgain(v))
            if sec >= 1:
                v2 = hu.vel(0.45 * d)
                mx.add(t + 0.006, tone(I.musicbox, m + 12, I.vlayer(v2), 0), -13.0, 0.3, 0.4, vgain(v2))
        # counter line
        if bar in M_COUNTER:
            for b, dur, m in parse(M_COUNTER[bar]):
                v = hu.vel(0.45 * d)
                mx.add(hu.time(b0 + b, 0.009, 0.004), tone(I.celesta, m, I.vlayer(v), 0), -9.0, -0.3, 0.36, vgain(v))
        # waltz accompaniment: bass on 1, celesta dyads on 2 and 3
        v = hu.vel(0.62 * d)
        mx.add(hu.time(b0, 0.006, 0.008), tone(I.bass, nn(M_BASS[bar]), I.vlayer(v), 1300, 0), -5.0, 0.0, 0.1, vgain(v))
        notes = CH[ch]
        for b, pick in ((1.0, (1, 2)), (2.0, (0, 2))):
            for j in pick:
                v = hu.vel((0.40 if b == 1.0 else 0.36) * d, 0.07)
                mx.add(hu.time(b0 + b, 0.007, 0.005 * j), tone(I.celesta, nn(notes[j]), I.vlayer(v), 0),
                       -9.5, -0.22 + 0.1 * j, 0.32, vgain(v))
        # warm pad, one chord per bar (+ root an octave above the bass)
        ms = int(round(3.0 * beat_s * 1000 / 50.0) * 50)
        padnotes = [nn(x) for x in notes] + [nn(M_BASS[bar]) + 12]
        for j, m in enumerate(padnotes):
            mx.add(b0 * beat_s, tone(I.pad, m, ms, j), -17.0, (-0.4, 0.4, 0.12, -0.12)[j], 0.22, 0.85 * d)
        # a very quiet clock: tick ... tock on beat 1 of alternating bars
        v = hu.vel(0.35 * d)
        mx.add(hu.time(b0, 0.003), tone(I.woodblock, "hi" if bar % 2 == 0 else "lo", I.vlayer(v), bar % 2),
               -22.0, 0.3 if bar % 2 == 0 else -0.3, 0.3, vgain(v))
    free_tones()
    return master(mx.render(MUSIC_IR, 1.0), True, -18.5, ceiling_db=-3.0, drive=0.6)


# --------------------------------------------------------------------------
# fanfares (one-shots, stereo) - built on the head of the tune: C F A (C')
# --------------------------------------------------------------------------


def _stab(mx, t, chord, vel, wide=False):
    notes = [nn(x) for x in CH[chord]]
    if wide:
        notes = [notes[0] - 12] + notes + [notes[0] + 12]
    for j, m in enumerate(notes):
        mx.add(t + 0.004 * j, tone(I.pizz, m, I.vlayer(vel), j % 2), -6.5, -0.4 + 0.1 * j, 0.3, vgain(vel))
        mx.add(t + 0.003 * j, tone(I.marimba, m, I.vlayer(vel), j % 2), -9.0, 0.25 - 0.08 * j, 0.25, vgain(vel))


def _brass(mx, t, m, dur_s, vel, gain=-1.5, pan=0.05):
    ms = int(round(dur_s * 1000 / 10.0) * 10)
    mx.add(t, tone(I.brass, m, I.vlayer(vel), ms, 0), gain, pan, 0.3, vgain(vel))


def win_fanfare():
    bs = 60.0 / 132.0
    mx = Mix(ns(4.0), loop=False)
    rng = np.random.default_rng(55)
    mel = [(0.0, 0.45, "C5", 0.75), (0.5, 0.45, "F5", 0.8), (1.0, 0.45, "A5", 0.85), (1.5, 0.95, "C6", 0.9),
           (2.5, 0.45, "D6", 0.85), (3.0, 0.45, "E6", 0.9), (3.5, 2.6, "F6", 1.0)]
    for b, dur, nm, v in mel:
        t = b * bs + rng.normal(0, 0.003)
        _brass(mx, t, nn(nm), dur * bs, v)
        mx.add(t, tone(I.marimba, nn(nm), I.vlayer(v), 0), -4.0, -0.2, 0.25, vgain(v))
        mx.add(t, tone(I.glock, nn(nm), I.vlayer(v * 0.7), 0), -11.0, 0.4, 0.35, vgain(v))
    # harmony voices on the last chord
    _brass(mx, 3.5 * bs, nn("C6"), 2.6 * bs, 0.8, -5.0, -0.25)
    _brass(mx, 3.5 * bs, nn("A5"), 2.6 * bs, 0.8, -5.0, 0.3)
    for b, chd, bassn, v, wide in ((0.0, "F", "F2", 0.75, False), (1.5, "F", "A2", 0.8, False), (2.5, "Bb", "Bb2", 0.8, False),
                                   (3.0, "C7", "C3", 0.85, False), (3.5, "F", "F2", 1.0, True)):
        t = b * bs
        _stab(mx, t, chd, v, wide)
        mx.add(t, tone(I.bass, nn(bassn), I.vlayer(v), 700 if wide else 300, 0), -1.5, 0.0, 0.08, vgain(v))
    for b, kind, v in ((0.0, "hi", 0.6), (0.5, "lo", 0.5), (1.0, "hi", 0.6), (2.5, "lo", 0.6), (3.0, "hi", 0.7)):
        mx.add(b * bs, tone(I.woodblock, kind, I.vlayer(v), 0), -11.0, 0.25, 0.25, vgain(v))
    mx.add(3.0 * bs, tone(I.timp, nn("C3"), 3, 0), -8.0, -0.1, 0.25, 0.6)
    mx.add(3.5 * bs, tone(I.timp, nn("F2"), 4, 0), -5.0, 0.0, 0.25, 0.9)
    # sparkle run over the final chord
    for i, nm in enumerate(("F6", "A6", "C7", "A6", "F6", "C7")):
        v = 0.75 - 0.07 * i
        mx.add((3.5 + 0.25 * (i + 1)) * bs, tone(I.glock, nn(nm), I.vlayer(v), i % 2), -9.0, 0.45 - 0.15 * (i % 3), 0.4, vgain(v))
    for j, nm in enumerate(("F3", "A3", "C4", "F4")):
        mx.add(3.5 * bs, tone(I.pad, nn(nm), 1100, j), -14.0, (-0.5, 0.5, -0.2, 0.2)[j], 0.4, 0.9)
    y = master(mx.render(MUSIC_IR), False, -15.0, ceiling_db=-2.5, drive=0.9)
    n = len(y)
    fo = ns(0.9)
    y[-fo:] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(fo) / fo))[:, None]
    return y


def game_complete():
    bs = 0.5  # 120 BPM
    mx = Mix(ns(8.8), loop=False)
    rng = np.random.default_rng(56)
    mel = [  # (beat, dur, note, vel)
        (0, .45, "C5", .75), (.5, .45, "F5", .78), (1, .45, "A5", .82), (1.5, .22, "G5", .75), (1.75, .22, "F5", .75), (2, 1.8, "C6", .9),
        (4, .45, "D5", .78), (4.5, .45, "F5", .8), (5, .45, "Bb5", .85), (5.5, .22, "A5", .78), (5.75, .22, "G5", .78), (6, 1.35, "D6", .92),
        (7.5, .45, "C6", .85),
        (8, .95, "Bb5", .88), (9, .45, "G5", .82), (9.5, .45, "A5", .85), (10, .45, "C6", .9), (10.5, .45, "D6", .93), (11, .95, "E6", .97),
        (12, 1.4, "F6", 1.0), (13.5, .4, "E6", .9), (14, 3.0, "F6", 1.0),
    ]
    for b, dur, nm, v in mel:
        t = b * bs + rng.normal(0, 0.003)
        _brass(mx, t, nn(nm), dur * bs, v)
        mx.add(t, tone(I.marimba, nn(nm), I.vlayer(v), 0), -4.5, -0.2, 0.25, vgain(v))
    harm = [(2, 1.8, ("A5", "F5")), (6, 1.35, ("Bb5", "F5")), (11, .95, ("C6", "Bb5")), (12, 1.4, ("C6", "A5")),
            (13.5, .4, ("C6", "Bb5")), (14, 3.0, ("C6", "A5"))]
    for b, dur, names in harm:
        for j, nm in enumerate(names):
            _brass(mx, b * bs + 0.004, nn(nm), dur * bs, 0.8, -5.5, (-0.3, 0.35)[j])
    stabs = [(0, "F", "F2", .8, False), (2, "F", "C3", .8, False), (4, "Bb", "Bb2", .82, False), (6, "Bb", "F2", .85, False),
             (8, "Gm7", "G2", .85, False), (9, "Gm7", "D3", .75, False), (10, "C7", "C3", .9, False), (11, "C7", "E2", .9, False),
             (12, "F", "F2", 1.0, True), (13.5, "C7", "C3", .85, False), (14, "F", "F2", 1.0, True)]
    for b, chd, bassn, v, wide in stabs:
        _stab(mx, b * bs, chd, v, wide)
        mx.add(b * bs, tone(I.bass, nn(bassn), I.vlayer(v), 900 if wide else 400, 0), -1.5, 0.0, 0.08, vgain(v))
    # glockenspiel flourishes under the long notes
    runs = [(2, ("C6", "F6", "A6", "C7")), (6, ("Bb5", "D6", "F6", "Bb6")), (12, ("F6", "A6", "C7", "A6", "F6")),
            (14, ("F6", "A6", "C7", "A6", "F6", "C6", "F6", "A6", "C7"))]
    for b, names in runs:
        for i, nm in enumerate(names):
            v = 0.7 - 0.03 * i
            mx.add((b + 0.25 * i) * bs + (0.125 * bs if b == 14 else 0.0), tone(I.glock, nn(nm), I.vlayer(v), i % 2),
                   -9.5, 0.45 - 0.2 * (i % 3), 0.4, vgain(v))
    # percussion: woodblock march, timpani, roll into the last chord
    for b in np.arange(0, 12, 1.0):
        mx.add(b * bs, tone(I.woodblock, "hi" if b % 2 == 0 else "lo", 3, int(b) % 2), -12.0, 0.25, 0.25, 0.7)
    for b, nm, v in ((0, "F2", .7), (2, "C3", .6), (4, "Bb2", .7), (6, "F2", .65), (8, "G2", .7), (12, "F2", 1.0), (13.5, "C3", .8), (14, "F2", 1.0)):
        mx.add(b * bs, tone(I.timp, nn(nm), I.vlayer(v), 0), -6.0, -0.05, 0.25, vgain(v))
    for i, b in enumerate(np.arange(10.0, 12.0, 0.25)):  # timpani roll crescendo on the dominant
        v = 0.3 + 0.6 * (i + 1) / 8
        mx.add(b * bs + rng.normal(0, 0.004), tone(I.timp, nn("C3"), I.vlayer(v), i % 2), -9.0, -0.05, 0.25, vgain(v))
        mx.add((b + 0.125) * bs, tone(I.ratchet_click, I.vlayer(v), i % 4), -15.0, 0.3, 0.2, vgain(v))
    # festive bells + pad on the two final chords
    mx.add(12 * bs, tone(I.bell_tone, nn("F5"), 3, 0), -9.0, -0.3, 0.4, 0.8)
    mx.add(14 * bs, tone(I.bell_tone, nn("F5"), 3, 1), -7.0, 0.3, 0.4, 1.0)
    mx.add(14 * bs + 0.01, tone(I.bell_tone, nn("C6"), 3, 0), -12.0, -0.35, 0.4, 1.0)
    for b, ms in ((12, 700), (14, 1500)):
        for j, nm in enumerate(("F3", "A3", "C4", "F4")):
            mx.add(b * bs, tone(I.pad, nn(nm), ms, j), -13.5, (-0.5, 0.5, -0.2, 0.2)[j], 0.4, 0.9)
    y = master(mx.render(MUSIC_IR), False, -15.0, ceiling_db=-2.5, drive=0.9)
    fo = ns(1.0)
    y[-fo:] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(fo) / fo))[:, None]
    return y
