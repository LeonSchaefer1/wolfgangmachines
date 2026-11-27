"""Pitched + percussion instruments used by the music, fanfares and chimes.

All functions return a mono float array starting exactly at the note onset.
`vel` is 0..1 and changes the *timbre* (brightness, mallet hardness); the
caller applies the actual gain.  Results are cached per (pitch, velocity
layer, variant) because the music re-uses the same notes many times.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from synth import SR, TAU, adsr, bp, decay, lp, hp, midi_hz, modal, noise_burst, lp_noise_burst, ns, tt

VEL_LAYERS = 6


def _rng(*key):
    """Deterministic per-note RNG (hash() of strings is salted, so build by hand)."""
    seed = 1469598103
    for k in key:
        for ch in str(k):
            seed = (seed * 16777619 + ord(ch)) % (2**32)
    return np.random.default_rng(seed)


def vlayer(vel):
    return int(np.clip(round(vel * (VEL_LAYERS - 1)), 0, VEL_LAYERS - 1))


def _v(layer):
    return layer / (VEL_LAYERS - 1)


# --------------------------------------------------------------------------
# mallets
# --------------------------------------------------------------------------


@lru_cache(maxsize=None)
def marimba(m, layer, variant=0):
    """Rosewood bar over a tube resonator, soft yarn mallet.

    Marimba bars are tuned so that the 2nd partial is 4x and the third
    ~9.2-10x the fundamental; the resonator makes the fundamental dominate.
    """
    v = _v(layer)
    rng = _rng("marimba", m, layer, variant)
    f = midi_hz(m) * (1.0 + rng.uniform(-0.0006, 0.0006))
    t60 = float(np.clip(1.3 * (440.0 / f) ** 0.7, 0.3, 2.0))
    bright = 0.35 + 0.9 * v
    freqs = [f, 3.98 * f, 9.6 * f, 2.0 * f]
    amps = [1.0, 0.20 * bright, 0.045 * bright, 0.03]
    t60s = [t60, t60 * 0.28, t60 * 0.10, t60 * 0.35]
    dur = min(2.2, t60 * 1.3 + 0.05)
    y = modal(dur, freqs, amps, t60s, attack=0.0022 - 0.0012 * v)
    # resonator "bloom": the air column answers a few ms late and a hair flat
    y += 0.22 * modal(dur, [f * 0.9985], [1.0], [t60 * 0.8], attack=0.012)
    # yarn mallet contact noise
    y[: ns(0.03)] += (0.10 + 0.14 * v) * noise_burst(rng, 0.03, 250.0, 1400.0 + 1600.0 * v, 0.012, 0.0006)
    return y


@lru_cache(maxsize=None)
def glock(m, layer, variant=0):
    """Glockenspiel: free steel bar partials 1 : 2.756 : 5.404 : 8.933.

    Upper partials are deliberately kept low and progressively attenuated
    above ~4.5 kHz so it sparkles without ever becoming piercing.
    """
    v = _v(layer)
    rng = _rng("glock", m, layer, variant)
    f = midi_hz(m)
    t60 = float(np.clip(1.9 * (1000.0 / f) ** 0.5, 0.7, 2.6))
    b = 0.35 + 0.65 * v
    ratios = [1.0, 2.756, 5.404, 8.933]
    amps0 = [1.0, 0.30 * b, 0.09 * b, 0.02 * b]
    dts = [1.0, 0.42, 0.18, 0.08]
    freqs, amps, t60s = [], [], []
    for r, a, d in zip(ratios, amps0, dts):
        fk = f * r
        a *= 1.0 / (1.0 + (fk / 4500.0) ** 3)
        freqs.append(fk)
        amps.append(a)
        t60s.append(t60 * d)
    # slow beating partner of the fundamental (bars are never perfectly uniform)
    freqs.append(f + 0.8 + 0.5 * rng.random())
    amps.append(0.22)
    t60s.append(t60 * 0.9)
    dur = min(2.6, t60 * 1.15)
    phases = [0.0] * (len(freqs) - 1) + [-np.pi / 2]  # partner starts in quadrature, swings into phase: the tone blooms
    y = modal(dur, freqs, amps, t60s, attack=0.0009, phases=phases)
    y[: ns(0.012)] += (0.04 + 0.05 * v) * noise_burst(rng, 0.012, 1500.0, 4500.0, 0.005, 0.0003)
    return y


@lru_cache(maxsize=None)
def celesta(m, layer, variant=0):
    """Celesta: felt hammer on a steel plate over a wooden resonator box.

    Fundamental-heavy tone + a short FM 'tine' transient (carrier:mod = 1:4)
    whose index dies away within ~60 ms.
    """
    v = _v(layer)
    rng = _rng("celesta", m, layer, variant)
    f = midi_hz(m)
    t60 = float(np.clip(1.6 * (700.0 / f) ** 0.4, 0.6, 2.4))
    dur = min(2.4, t60 * 1.15)
    t = tt(dur)
    idx = (0.5 + 1.3 * v) * np.exp(-t / 0.055)
    y = decay(t, t60) * np.sin(TAU * f * t + idx * np.sin(TAU * 4.0 * f * t))
    y += modal(dur, [2 * f, 3 * f, 5.4 * f, f * 1.0012], [0.16, 0.05, 0.03 * v, 0.25],
               [t60 * 0.5, t60 * 0.3, t60 * 0.08, t60], attack=0, phases=[0.0, 0.0, 0.0, -np.pi / 2])
    y *= 1.0 - np.exp(-t / 0.0028)
    y[: ns(0.03)] += 0.05 * lp_noise_burst(rng, 0.03, 900.0, 0.012)
    return y


@lru_cache(maxsize=None)
def musicbox(m, layer, variant=0):
    """Music-box comb tine: nearly pure tone, clamped-bar 2nd mode at 6.27x that
    dies in a few ms, soundboard adds weak 2nd/3rd harmonics, tiny pin 'plink'."""
    v = _v(layer)
    rng = _rng("mbox", m, layer, variant)
    f = midi_hz(m)
    t60 = float(np.clip(1.7 * (800.0 / f) ** 0.5, 0.7, 2.4))
    dur = min(2.5, t60 * 1.15)
    f627 = 6.27 * f
    freqs = [f, f * 1.0009 + 0.3, 2 * f, 3 * f, f627]
    amps = [1.0, 0.25, 0.14 + 0.08 * v, 0.05 + 0.04 * v, 0.07 * v / (1.0 + (f627 / 5000.0) ** 2)]
    t60s = [t60, t60 * 0.9, t60 * 0.45, t60 * 0.25, 0.07]
    y = modal(dur, freqs, amps, t60s, attack=0.0012, phases=[0.0, -np.pi / 2, 0.0, 0.0, 0.0])
    y[: ns(0.01)] += 0.035 * noise_burst(rng, 0.01, 1800.0, 4200.0, 0.004, 0.0003)
    return y


# --------------------------------------------------------------------------
# plucked strings (closed-form Karplus-Strong: harmonic k of a string plucked
# at relative position p has amplitude sin(k*pi*p)/k^2-ish and its own decay)
# --------------------------------------------------------------------------


def _body(fk, peaks):
    g = 1.0
    for f0, bw, gain in peaks:
        g += gain / (1.0 + ((fk - f0) / bw) ** 2)
    return g


def _pluck(f, dur, v, p, t0, rolloff, damp, fmax, inharm, body):
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    kmax = max(1, min(48, int(fmax / f)))
    for k in range(1, kmax + 1):
        fk = k * f * np.sqrt(1.0 + inharm * k * k)
        a = np.sin(np.pi * k * p) / k**rolloff
        a *= k ** (-(1.0 - v) * 0.7)
        a *= _body(fk, body)
        t60 = t0 / (1.0 + damp * (k - 1)) / (1.0 + (fk / 4500.0) ** 2)
        y += a * np.exp(-6.908 * t / t60) * np.sin(TAU * fk * t)
    return y, t


_VIOLIN_BODY = ((285.0, 40.0, 1.2), (460.0, 50.0, 1.0), (560.0, 60.0, 0.8), (1100.0, 250.0, 0.5), (2400.0, 600.0, 0.6))
_BASS_BODY = ((190.0, 40.0, 1.0), (265.0, 60.0, 1.1), (400.0, 90.0, 0.8), (620.0, 150.0, 0.5))


@lru_cache(maxsize=None)
def pizz(m, layer, variant=0):
    """Pizzicato violin/viola/cello section note."""
    v = _v(layer)
    rng = _rng("pizz", m, layer, variant)
    f = midi_hz(m) * (1.0 + rng.uniform(-0.0012, 0.0012))
    t0 = float(np.clip(0.75 * (220.0 / f) ** 0.6, 0.16, 1.2))
    dur = min(1.4, t0 * 1.3 + 0.05)
    y, t = _pluck(f, dur, v, p=0.23, t0=t0, rolloff=1.25, damp=0.28, fmax=6000.0, inharm=1.0e-4, body=_VIOLIN_BODY)
    # two desks slightly apart -> section feel
    f2 = f * 2 ** (rng.uniform(4, 9) / 1200.0)
    y2, _ = _pluck(f2, dur, v, p=0.27, t0=t0 * 0.9, rolloff=1.3, damp=0.3, fmax=6000.0, inharm=1.0e-4, body=_VIOLIN_BODY)
    d = ns(0.004 + 0.004 * rng.random())
    y[d:] += 0.6 * y2[: len(y) - d]
    y *= 1.0 - np.exp(-t / 0.0007)
    y[: ns(0.02)] += (0.10 + 0.12 * v) * np.max(np.abs(y)) * noise_burst(rng, 0.02, 500.0, 2600.0, 0.008, 0.0004)
    return y


@lru_cache(maxsize=None)
def bass(m, layer, dur_ms, variant=0):
    """Upright bass pizzicato.  Extra weight on harmonics 2..6 + gentle
    saturation so the line is still audible on a phone loudspeaker."""
    v = _v(layer)
    rng = _rng("bass", m, layer, variant)
    f = midi_hz(m)
    t0 = float(np.clip(1.5 * (80.0 / f) ** 0.4, 0.7, 1.8))
    hold = dur_ms / 1000.0
    dur = min(hold + 0.25, t0 * 1.2)
    y, t = _pluck(f, dur, v, p=0.30, t0=t0, rolloff=1.15, damp=0.30, fmax=2600.0, inharm=6.0e-5, body=_BASS_BODY)
    y *= 1.0 - np.exp(-t / 0.004)
    y /= np.max(np.abs(y)) + 1e-9
    y = np.tanh(1.4 * y) / 1.4
    y[: ns(0.05)] += (0.10 + 0.10 * v) * lp_noise_burst(rng, 0.05, 420.0, 0.02, 0.002)
    # finger damps the string at note end
    y *= np.where(t < hold, 1.0, np.exp(-(t - hold) / 0.05))
    return y


# --------------------------------------------------------------------------
# sustained
# --------------------------------------------------------------------------


@lru_cache(maxsize=None)
def pad(m, dur_ms, variant=0):
    """Warm, slow 'harmonium/strings' pad: 3 detuned additive voices."""
    rng = _rng("pad", m, dur_ms, variant)
    f = midi_hz(m)
    hold = dur_ms / 1000.0
    env = adsr(hold, 0.45, 1.5, 0.75, 0.45, total=hold + 1.6)
    t = np.arange(len(env)) / SR
    y = np.zeros(len(env))
    for cents in (-5.0, 0.7, 5.5):
        fv = f * 2 ** (cents / 1200.0)
        drift = 1.0 + 0.0012 * np.sin(TAU * rng.uniform(0.15, 0.4) * t + rng.uniform(0, TAU))
        ph = TAU * np.cumsum(fv * drift) / SR
        for k in range(1, 9):
            if k * fv > 4200:
                break
            y += np.sin(k * ph + rng.uniform(0, TAU)) / k**2.1 / (1.0 + (k * fv / 2200.0) ** 2)
    return y * env / 3.0


@lru_cache(maxsize=None)
def brass(m, layer, dur_ms, variant=0):
    """Soft 'toy flugelhorn' lead: additive harmonics whose brightness follows
    the amplitude envelope (the defining property of brass), slight pitch
    scoop, delayed vibrato, two players a few cents apart."""
    v = _v(layer)
    rng = _rng("brass", m, layer, dur_ms, variant)
    f = midi_hz(m)
    hold = dur_ms / 1000.0
    env = adsr(hold, 0.045, 0.25, 0.78, 0.07, total=hold + 0.4)
    t = np.arange(len(env)) / SR
    slow = adsr(hold, 0.09, 0.3, 0.7, 0.09, total=hold + 0.4)
    bright = 0.55 + (1.3 + 1.5 * v) * slow
    vib = 1.0 + 0.0035 * np.sin(TAU * 5.3 * t) * np.clip((t - 0.16) / 0.25, 0.0, 1.0)
    scoop = 2.0 ** ((-30.0 * np.exp(-t / 0.018)) / 1200.0)
    y = np.zeros(len(env))
    kmax = max(2, min(22, int(6500.0 / f)))
    for cents in (-3.5, 3.0):
        ph = TAU * np.cumsum(f * 2 ** (cents / 1200.0) * vib * scoop) / SR
        for k in range(1, kmax + 1):
            fk = k * f
            w = 1.0 / (1.0 + (fk / 3600.0) ** 4) * (1.0 + 0.6 / (1.0 + ((fk - 900.0) / 500.0) ** 2))
            y += w * np.exp(-(k - 1) / bright) * np.sin(k * ph + rng.uniform(0, 0.6))
    y *= env / 2.0
    y += 0.012 * env * bp(rng.standard_normal(len(env)), 900.0, 3000.0)
    return y


# --------------------------------------------------------------------------
# percussion ("clockwork kit")
# --------------------------------------------------------------------------


@lru_cache(maxsize=None)
def woodblock(kind, layer, variant=0):
    """Hollow wood block: 'tick' (high) / 'tock' (low)."""
    v = _v(layer)
    rng = _rng("wb", kind, layer, variant)
    f = {"hi": 1040.0, "lo": 760.0, "mid": 880.0}[kind] * (1.0 + rng.uniform(-0.006, 0.006))
    freqs = [f, 1.57 * f, 2.43 * f, 3.3 * f, 0.52 * f]
    amps = [1.0, 0.32, 0.15 * (0.5 + v), 0.06 * v, 0.18]
    t60s = [0.085, 0.055, 0.035, 0.025, 0.05]
    y = modal(0.16, freqs, amps, t60s, attack=0.0005)
    y[: ns(0.012)] += (0.12 + 0.12 * v) * noise_burst(rng, 0.012, 900.0, 3800.0, 0.004, 0.0003)
    return y


@lru_cache(maxsize=None)
def shaker(layer, variant=0):
    v = _v(layer)
    rng = _rng("shk", layer, variant)
    n = ns(0.11)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 2600.0, 6200.0, 1)
    x = lp(x, 7000.0, 2)
    env = (1.0 - np.exp(-t / (0.010 - 0.004 * v))) * np.exp(-t / 0.022)
    return x * env


@lru_cache(maxsize=None)
def brush(layer, variant=0):
    rng = _rng("brush", layer, variant)
    n = ns(0.22)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 900.0, 3600.0, 1)
    env = (1.0 - np.exp(-t / 0.014)) * np.exp(-t / 0.05)
    return x * env


@lru_cache(maxsize=None)
def thump(layer, variant=0):
    """Felt beater on a wooden box - a soft 'heartbeat' instead of a kick drum."""
    v = _v(layer)
    rng = _rng("thump", layer, variant)
    dur = 0.3
    t = tt(dur)
    glide = 1.0 + 0.45 * np.exp(-t / 0.025)
    y = modal(dur, [98.0, 196.0, 297.0, 402.0], [0.8, 0.7, 0.35, 0.14], [0.18, 0.14, 0.09, 0.06], attack=0.003, bend=glide)
    y[: ns(0.04)] += 0.25 * lp_noise_burst(rng, 0.04, 500.0 + 500.0 * v, 0.02, 0.002)
    return y


@lru_cache(maxsize=None)
def ratchet_click(layer, variant=0):
    """One tooth of a small wooden ratchet / clock escapement."""
    v = _v(layer)
    rng = _rng("ratchet", layer, variant)
    f = 1500.0 * (1.0 + rng.uniform(-0.05, 0.05))
    y = modal(0.06, [f, 1.7 * f, 2.6 * f, 0.45 * f], [1.0, 0.4, 0.15, 0.3], [0.03, 0.02, 0.012, 0.03], attack=0.0003)
    y[: ns(0.008)] += 0.3 * noise_burst(rng, 0.008, 1200.0, 4500.0, 0.003, 0.0002)
    return y


@lru_cache(maxsize=None)
def timp(m, layer, variant=0):
    """Small soft-mallet kettle drum (preferred modes 1 : 1.5 : 1.99 : 2.44 : 2.89)."""
    v = _v(layer)
    rng = _rng("timp", m, layer, variant)
    f = midi_hz(m)
    dur = 1.3
    t = tt(dur)
    glide = 1.0 + 0.03 * np.exp(-t / 0.05)
    y = modal(dur, [f, 1.5 * f, 1.99 * f, 2.44 * f, 2.89 * f, 3.4 * f],
              [1.0, 0.7, 0.4, 0.22, 0.12, 0.06], [1.0, 0.75, 0.5, 0.35, 0.3, 0.2], attack=0.003, bend=glide)
    y[: ns(0.06)] += (0.15 + 0.2 * v) * lp_noise_burst(rng, 0.06, 700.0, 0.03, 0.002)
    return y


@lru_cache(maxsize=None)
def bell_tone(m, layer, variant=0):
    """Small brass hand bell for the finale (church-bell partial series)."""
    rng = _rng("bell", m, layer, variant)
    f = midi_hz(m)
    ratios = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166]
    amps = [0.35, 1.0, 0.45, 0.25, 0.55, 0.15, 0.12, 0.18, 0.06]
    t60 = 2.6
    freqs, aa, dd = [], [], []
    for r, a in zip(ratios, amps):
        fk = f * r
        a /= 1.0 + (fk / 4000.0) ** 3
        for det in (0.0, rng.uniform(0.4, 1.4)):
            freqs.append(fk + det)
            aa.append(a * (1.0 if det == 0.0 else 0.5))
            dd.append(t60 / (r**0.9) * (1.0 if r > 0.6 else 0.75))
    y = modal(3.0, freqs, aa, dd, attack=0.001)
    y[: ns(0.02)] += 0.15 * noise_burst(rng, 0.02, 1200.0, 4200.0, 0.007, 0.0003)
    return y
