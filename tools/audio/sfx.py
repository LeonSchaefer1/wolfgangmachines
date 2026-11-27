"""All one-shot / loop sound effects (mono).  Each function returns the raw
signal; build_audio.py trims, fades, loudness-normalises and encodes."""
from __future__ import annotations

import numpy as np
from scipy import signal

import instruments as I
from synth import (SR, TAU, add_room, bell_env, blsaw, bp, cluster, convolve, decay, hp, lp,
                   lp_noise_burst, make_ir, midi_hz, modal, nn, noise_burst, ns, peq,
                   periodic_noise, resonator, shaped_noise, soft_limit, softclip, tt)


def R(seed):
    return np.random.default_rng(seed)


# shared rooms (fixed seeds): a small wooden workshop and a bigger "sky" space
ROOM = make_ir(R(9001), t60=0.26, predelay=0.003, er_count=9, er_span=0.022)
ROOM_BIG = make_ir(R(9002), t60=1.0, predelay=0.015, er_count=6, er_span=0.06, hf_ratio=0.5)
ROOM_CHIME = make_ir(R(9003), t60=0.7, predelay=0.008, er_count=8, er_span=0.035, hf_ratio=0.6)


def canvas(dur):
    return np.zeros(ns(dur))


def put(buf, sig, t=0.0, g=1.0):
    i = ns(t)
    k = min(len(sig), len(buf) - i)
    if k > 0:
        buf[i : i + k] += g * sig[:k]
    return buf


def unit(x):
    return x / (np.max(np.abs(x)) + 1e-12)


def rms(x):
    return float(np.sqrt(np.mean(x**2)) + 1e-12)


# --------------------------------------------------------------------------
# generic struck objects
# --------------------------------------------------------------------------


def struck(rng, dur, f0, ratios, amps, t60, tilt=0.7, sat=2, spread=0.06, attack=0.0004,
           click=None, thump=None, sat_amp=0.35):
    """Modal object: base modes + random satellites, contact noise, body thump.

    click = (lo, hi, t60, amp), thump = (f, t60, amp, glide)
    """
    freqs = [f0 * r for r in ratios]
    t60s = [t60 * (1.0 / r) ** tilt for r in ratios]
    F, A, D = cluster(rng, freqs, amps, t60s, sat=sat, spread=spread, sat_amp=sat_amp)
    ph = rng.uniform(-0.4, 0.4, len(F))
    y = modal(dur, F, A, D, attack=attack, phases=ph)
    y = unit(y)
    if thump is not None:
        f, d, a, glide = thump
        t = tt(dur)
        y += a * modal(dur, [f, 2.02 * f], [1.0, 0.25], [d, d * 0.6], attack=0.0015,
                       bend=1.0 + glide * np.exp(-t / 0.012))
    if click is not None:
        lo, hi, d, a = click
        nb = noise_burst(rng, min(dur, d * 4 + 0.004), lo, hi, d, 0.00025)
        y[: len(nb)] += a * unit(nb)
    return y


def wood_hit(seed, f0, kind):
    rng = R(seed)
    if kind == "plank":
        y = struck(rng, 0.30, f0, [1, 2.05, 2.76, 3.9, 5.4, 7.1], [1, 0.35, 0.55, 0.25, 0.18, 0.07], 0.12,
                   click=(600, 3400, 0.010, 0.55), thump=(150.0, 0.05, 0.35, 0.5))
    elif kind == "crate":
        y = struck(rng, 0.36, f0, [1, 1.48, 2.1, 2.9, 3.75, 5.2, 7.4], [1, 0.7, 0.5, 0.35, 0.22, 0.1, 0.05], 0.15,
                   tilt=0.6, sat=3, spread=0.09, click=(350, 2400, 0.014, 0.5), thump=(128.0, 0.09, 0.55, 0.35))
    else:  # small block
        y = struck(rng, 0.22, f0, [1, 1.62, 2.76, 3.4, 5.1], [1, 0.3, 0.45, 0.15, 0.08], 0.075,
                   click=(900, 4200, 0.007, 0.5), thump=(210.0, 0.035, 0.25, 0.5))
    return add_room(y, ROOM, -15.0)


def metal_hit(seed, variant):
    rng = R(seed)
    if variant == 1:  # steel ball on wood: bright tick with a woody answer
        ring = struck(rng, 0.32, 1720.0, [1, 1.68, 2.40, 3.28], [1, 0.6, 0.28, 0.08], 0.17, tilt=0.9,
                      sat=1, spread=0.012, sat_amp=0.6, click=(1500, 5000, 0.004, 0.45))
        wood = struck(rng, 0.2, 470.0, [1, 1.9, 2.76, 4.1], [1, 0.4, 0.4, 0.15], 0.07,
                      click=None, thump=(190.0, 0.035, 0.12, 0.5))
        y = canvas(0.34)
        put(y, ring, 0, 0.85)
        put(y, wood, 0, 0.45)
    else:  # steel on steel: slightly longer shimmering ring
        ring = struck(rng, 0.42, 2140.0, [0.415, 1, 1.59, 2.16, 2.85], [0.4, 1, 0.5, 0.2, 0.05], 0.25, tilt=0.9,
                      sat=1, spread=0.008, sat_amp=0.7, click=(1800, 5200, 0.0035, 0.5))
        y = canvas(0.44)
        put(y, ring, 0, 1.0)
    y = lp(y, 7000.0, 2)
    return add_room(y, ROOM, -15.0)


def rubber_bounce(seed, variant):
    rng = R(seed)
    k = 1.0 if variant == 1 else 1.16
    dur = 0.3 if variant == 1 else 0.25
    t = tt(dur)
    glide = 1.0 + 0.55 * np.exp(-t / 0.018)
    # skin thump + air cavity ring of the hollow ball ("pomp")
    y = modal(dur, [172.0 * k, 344.0 * k, 520.0 * k, 705.0 * k, 930.0 * k],
              [0.7, 0.75, 0.55, 0.28, 0.10], [0.10, 0.10, 0.12, 0.08, 0.05], attack=0.0018, bend=glide)
    y = unit(y)
    # the characteristic slightly "pingy" shell resonance
    y += 0.16 * modal(dur, [1180.0 * k, 1490.0 * k], [1.0, 0.5], [0.09, 0.06], attack=0.001)
    slap = noise_burst(rng, 0.05, 500.0, 2600.0, 0.016, 0.0006)
    y[: len(slap)] += 0.45 * unit(slap)
    y = softclip(y, 1.2)
    return add_room(y, ROOM, -13.0)


def domino(seed, f0):
    rng = R(seed)

    def one(scale, g):
        return g * struck(rng, 0.07, f0 * scale, [0.36, 1, 1.47, 2.09, 2.83], [0.4, 1, 0.5, 0.28, 0.1], 0.032,
                          tilt=0.8, sat=1, spread=0.03, click=(1400, 5200, 0.0035, 0.6))

    y = canvas(0.09)
    put(y, one(1.0, 1.0), 0.0)
    put(y, one(1.07, 0.33), 0.009 + 0.004 * rng.random())  # tiny chatter contact
    y = lp(y, 7500.0, 2)
    return add_room(y, ROOM, -17.0)


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------


def ui_tap():
    rng = R(101)
    y = struck(rng, 0.09, 930.0, [1, 1.55, 2.5, 3.6], [1, 0.4, 0.2, 0.06], 0.05, attack=0.0008,
               click=(700, 3000, 0.004, 0.3), thump=(300.0, 0.03, 0.3, 0.3))
    return add_room(y, ROOM, -18.0)


def ui_pick():
    rng = R(102)
    dur = 0.16
    t = tt(dur)
    f = 420.0 * (930.0 / 420.0) ** np.minimum(t / 0.07, 1.0) ** 0.8  # upward "pop"
    ph = TAU * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * decay(t, 0.12) * (1 - np.exp(-t / 0.0015))
    pl = I.pizz(nn("A5"), 4)[: ns(0.14)] * decay(tt(0.14), 0.1)
    y = unit(y)
    put(y, unit(pl), 0.0, 0.35)
    tick = struck(rng, 0.05, 1250.0, [1, 1.6, 2.5], [1, 0.4, 0.15], 0.03, click=(900, 3500, 0.004, 0.4))
    put(y, tick, 0.0, 0.3)
    return add_room(y, ROOM, -17.0)


def ui_place():
    rng = R(103)
    y = struck(rng, 0.2, 335.0, [1, 1.83, 2.76, 3.95, 5.4, 7.0], [1, 0.55, 0.5, 0.25, 0.15, 0.05], 0.105,
               attack=0.0006, click=(500, 3000, 0.008, 0.5), thump=(165.0, 0.06, 0.5, 0.45))
    return add_room(y, ROOM, -14.0)


def ui_rotate():
    rng = R(104)
    y = struck(rng, 0.055, 1850.0, [0.33, 1, 1.57, 2.3], [0.45, 1, 0.45, 0.15], 0.022, tilt=0.6, sat=1,
               spread=0.03, click=(1500, 5000, 0.0025, 0.7))
    return add_room(lp(y, 7000.0), ROOM, -19.0)


def ui_return():
    rng = R(105)
    dur = 0.27
    t = tt(dur)
    w = shaped_noise(rng, dur, lambda x: 2600.0 * (520.0 / 2600.0) ** np.clip(x / 0.2, 0, 1), 0.55)
    w *= bell_env(t, 0.07, 0.035, 0.06)
    y = 0.8 * unit(w)
    thud = struck(rng, 0.09, 270.0, [1, 1.9, 2.8, 4.2], [1, 0.5, 0.3, 0.1], 0.06, attack=0.001,
                  click=(400, 2000, 0.008, 0.3), thump=(150.0, 0.04, 0.4, 0.3))
    put(y, thud, 0.175, 0.75)
    return add_room(y, ROOM, -16.0)


def ui_error():
    rng = R(106)
    y = canvas(0.34)
    for t0, f, g in ((0.0, 311.0, 1.0), (0.125, 247.0, 0.9)):  # falling major third, felt mallet
        dur = 0.2
        t = tt(dur)
        th = modal(dur, [f, 2.0 * f, 3.02 * f, 0.5 * f], [1.0, 0.38, 0.12, 0.30], [0.13, 0.08, 0.05, 0.10],
                   attack=0.004, bend=1.0 + 0.06 * np.exp(-t / 0.02))
        th = unit(th)
        nb = lp_noise_burst(rng, 0.04, 700.0, 0.02, 0.003)
        th[: len(nb)] += 0.3 * unit(nb)
        put(y, th, t0, g)
    return add_room(y, ROOM, -16.0)


def _clunk(rng, f0=210.0, dur=0.16):
    return struck(rng, dur, f0, [1, 1.62, 2.67, 4.33, 6.9, 10.9], [1, 0.8, 0.6, 0.4, 0.22, 0.1], 0.09, tilt=0.5,
                  click=(600, 4000, 0.006, 0.5), thump=(120.0, 0.05, 0.4, 0.4))


def _whirr(rng, dur, f_a, f_b, curve):
    t = tt(dur)
    x = t / dur
    f0 = f_a * (f_b / f_a) ** (x**curve)
    ph = np.cumsum(f0) / SR
    saw = blsaw(ph, f0, fmax=5200.0, rolloff=1.15)
    y = 0.15 * saw + 1.0 * resonator(saw, 640.0, 3.5) + 0.7 * resonator(saw, 1450.0, 5.0) + 0.3 * resonator(saw, 2550.0, 6.0)
    y *= 1.0 + 0.22 * np.sin(TAU * np.cumsum(f0 * 0.25) / SR)  # gear mesh
    air = shaped_noise(rng, dur, lambda q: np.interp(q, t, f0 * 7.0), 0.7)
    y = unit(y) + 0.35 * unit(air)
    return y, f0, t


def ui_start():
    rng = R(107)
    y = canvas(0.56)
    put(y, _clunk(rng), 0.0, 0.9)
    D = 0.44
    w, f0, t = _whirr(rng, D, 95.0, 340.0, 0.8)
    env = (1 - np.exp(-t / 0.05)) * np.minimum(1.0, (D - t) / 0.08) * (0.55 + 0.45 * t / D)
    put(y, w * env, 0.06, 0.6)
    # accelerating ratchet of the wind-up
    tick_ph = np.cumsum(14.0 * (48.0 / 14.0) ** (t / D)) / SR
    idx = np.nonzero(np.diff(np.floor(tick_ph)) > 0)[0]
    for j, i in enumerate(idx):
        put(y, I.ratchet_click(3, j % 4), 0.06 + i / SR, 0.32 * (0.6 + 0.4 * i / len(t)))
    put(y, I.woodblock("hi", 3), 0.505, 0.35)  # "ready" tick
    return add_room(y, ROOM, -15.0)


def ui_stop():
    rng = R(108)
    y = canvas(0.38)
    D = 0.27
    w, f0, t = _whirr(rng, D, 310.0, 95.0, 0.65)
    env = (1 - np.exp(-t / 0.006)) * np.minimum(1.0, (D - t) / 0.08) * (1.0 - 0.5 * t / D)
    put(y, w * env, 0.0, 0.6)
    tick_ph = np.cumsum(40.0 * (9.0 / 40.0) ** (t / D)) / SR
    idx = np.nonzero(np.diff(np.floor(tick_ph)) > 0)[0]
    for j, i in enumerate(idx):
        put(y, I.ratchet_click(2, j % 4), i / SR, 0.26 * (1.0 - 0.5 * i / len(t)))
    put(y, _clunk(rng, 205.0, 0.12), 0.245, 0.9)
    return add_room(y, ROOM, -15.0)


def ui_hint():
    y = canvas(0.85)
    put(y, unit(I.glock(nn("C6"), 3)), 0.0, 0.8)
    put(y, unit(I.glock(nn("F6"), 4)), 0.115, 1.0)
    put(y, unit(I.celesta(nn("F5"), 3)), 0.115, 0.25)
    y *= decay(tt(0.85), 2.2)
    return add_room(y, ROOM_CHIME, -15.0)


def ui_panel():
    rng = R(110)
    dur = 0.26
    t = tt(dur)
    fc = lambda x: 480.0 * (1700.0 / 480.0) ** np.clip(x / 0.16, 0, 1) ** 0.8 * (1.0 - 0.3 * np.clip((x - 0.16) / 0.1, 0, 1))
    w = shaped_noise(rng, dur, fc, 0.6) * bell_env(t, 0.10, 0.045, 0.055)
    y = unit(w)
    put(y, struck(rng, 0.05, 410.0, [1, 1.8, 2.9], [1, 0.4, 0.15], 0.04, attack=0.001), 0.2, 0.18)
    return add_room(y, ROOM, -17.0)


# --------------------------------------------------------------------------
# physics specials
# --------------------------------------------------------------------------


def boing():
    rng = R(201)
    dur = 0.4
    t = tt(dur)
    f0 = 150.0 * (430.0 / 150.0) ** (np.minimum(t / 0.3, 1.0) ** 0.7)
    f0 = f0 * (1.0 + 0.11 * np.exp(-t / 0.11) * np.sin(TAU * 27.0 * t))  # springy wobble
    ph = TAU * np.cumsum(f0) / SR
    fc = 520.0 * (1500.0 / 520.0) ** np.minimum(t / 0.3, 1.0)
    y = np.zeros_like(t)
    for k in range(1, 11):
        fk = k * f0
        g = (1.0 + 2.6 * np.exp(-0.5 * (np.log2(fk / fc) / 0.4) ** 2)) / k**1.25
        g *= 1.0 / (1.0 + (fk / 4200.0) ** 4)
        y += g * np.sin(k * ph)
    y *= (1 - np.exp(-t / 0.004)) * decay(t, 0.36)
    y = unit(y)
    th = modal(0.1, [118.0, 236.0, 410.0], [1, 0.5, 0.25], [0.06, 0.05, 0.03], attack=0.002)
    y[: len(th)] += 0.4 * unit(th)
    nb = lp_noise_burst(rng, 0.03, 1200.0, 0.012, 0.001)
    y[: len(nb)] += 0.25 * unit(nb)
    y = softclip(y, 1.1)
    return add_room(y, ROOM, -15.0)


def pop():
    rng = R(202)
    dur = 0.22
    t = tt(dur)
    y = canvas(dur)
    snap = noise_burst(rng, 0.04, 450.0, 5200.0, 0.011, 0.0003, order=1)
    put(y, unit(snap), 0, 1.0)
    thup = modal(0.09, [250.0, 505.0], [1, 0.4], [0.05, 0.035], attack=0.001, bend=1.0 + 0.6 * np.exp(-tt(0.09) / 0.01))
    put(y, unit(thup), 0, 0.7)
    # rubber shreds flapping: AM noise, flutter slowing down
    fl_f = 95.0 * (45.0 / 95.0) ** (t / dur)
    fl = np.maximum(0.0, np.sin(TAU * np.cumsum(fl_f) / SR)) ** 2
    tail = bp(rng.standard_normal(len(t)), 650.0, 2400.0, 1) * fl * np.exp(-t / 0.045) * (1 - np.exp(-t / 0.012))
    y += 0.42 * unit(tail)
    y = soft_limit(y, 0.75, 0.45) / 0.75
    return add_room(lp(y, 6500.0, 2), ROOM, -11.0)


def basket_land():
    rng = R(203)
    base = [318.0, 497.0, 742.0, 1105.0, 1630.0, 2290.0, 3050.0]
    amps = [1.0, 0.8, 0.6, 0.42, 0.25, 0.12, 0.05]
    t60 = [0.30, 0.26, 0.20, 0.15, 0.10, 0.07, 0.05]
    y = canvas(0.46)

    def hit(g, bright, seed_shift):
        F, A, D = cluster(rng, base, [a * bright**i for i, a in enumerate(amps)], t60, sat=2, spread=0.035, sat_amp=0.5)
        h = unit(modal(0.4, F, A, D, attack=0.0006, phases=rng.uniform(0, TAU, len(F))))
        nb = noise_burst(rng, 0.02, 700.0, 4200.0, 0.006, 0.0003)
        h[: len(nb)] += 0.3 * unit(nb)
        return g * h

    put(y, hit(1.0, 0.85, 0), 0.0)
    tt0, gap, g = 0.085, 0.062, 0.34
    for _ in range(4):  # the ball rattling to rest inside the bucket
        put(y, hit(g, 1.05, 1), tt0)
        tt0 += gap
        gap *= 0.66
        g *= 0.62
    thud = modal(0.08, [140.0, 215.0], [1, 0.6], [0.05, 0.04], attack=0.002)
    put(y, unit(thud), 0.0, 0.35)
    return add_room(lp(y, 6500.0, 2), ROOM, -14.0)


def seesaw():
    rng = R(204)
    y = canvas(0.42)
    th = struck(rng, 0.3, 232.0, [1, 1.52, 2.3, 3.3, 4.7, 6.6, 9.0], [1, 0.8, 0.65, 0.45, 0.28, 0.14, 0.06], 0.13,
                tilt=0.6, sat=3, click=(400, 2800, 0.012, 0.55), thump=(130.0, 0.07, 0.28, 0.4))
    put(y, th, 0.0, 1.0)
    # creak: stick-slip pulse train (irregular, rising) through wood formants
    dur = 0.2
    t = tt(dur)
    rate = 62.0 * (118.0 / 62.0) ** (t / dur) * (1.0 + 0.10 * lp(rng.standard_normal(len(t)), 30.0) * 6.0)
    ph = np.cumsum(rate) / SR
    imp = np.zeros(len(t))
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    imp[idx] = rng.uniform(0.5, 1.0, len(idx))
    cr = resonator(imp, 870.0, 7.0) + 0.8 * resonator(imp, 1560.0, 9.0) + 0.45 * resonator(imp, 2450.0, 9.0)
    cr *= bell_env(t, 0.09, 0.05, 0.05)
    put(y, unit(cr), 0.11, 0.2)
    return add_room(y, ROOM, -14.0)


# --------------------------------------------------------------------------
# devices
# --------------------------------------------------------------------------


def button_click():
    rng = R(301)
    y = canvas(0.2)
    a = struck(rng, 0.08, 1180.0, [0.34, 1, 1.72, 2.6, 3.7], [0.6, 1, 0.5, 0.25, 0.08], 0.035, tilt=0.6,
               click=(900, 4500, 0.004, 0.7), thump=(190.0, 0.03, 0.4, 0.3))
    b = struck(rng, 0.08, 1420.0, [0.36, 1, 1.66, 2.5, 3.5], [0.5, 1, 0.45, 0.2, 0.06], 0.03, tilt=0.6,
               click=(1100, 4800, 0.0035, 0.6), thump=(230.0, 0.025, 0.25, 0.3))
    put(y, a, 0.0, 1.0)
    put(y, b, 0.082, 0.72)
    return add_room(lp(y, 7000.0), ROOM, -15.0)


def lamp_on():
    rng = R(302)
    dur = 0.66
    t = tt(dur)
    y = canvas(dur)
    ck = struck(rng, 0.04, 2100.0, [0.3, 1, 1.6, 2.4], [0.5, 1, 0.4, 0.12], 0.016, click=(1500, 5000, 0.002, 0.6))
    put(y, ck, 0.0, 0.42)
    put(y, ck, 0.021, 0.14)
    # warm rising shimmer: F major partials blooming one after another
    sh = np.zeros_like(t)
    for i, (name, a) in enumerate((("F4", 0.55), ("C5", 0.6), ("F5", 0.9), ("A5", 0.7), ("C6", 0.55), ("F6", 0.3))):
        f = midi_hz(nn(name))
        on = 0.025 + 0.035 * i
        env = np.where(t > on, (1 - np.exp(-(t - on) / (0.05 + 0.012 * i))) * np.exp(-np.maximum(t - on - 0.14, 0) / 0.17), 0.0)
        for det in (-1.5, 1.8):
            sh += a * env * np.sin(TAU * (f + det) * t + rng.uniform(0, TAU)) * 0.5
            sh += 0.12 * a * env * np.sin(TAU * 2 * (f + det) * t + rng.uniform(0, TAU)) * 0.5
    y += 0.55 * unit(sh)
    hum = (np.sin(TAU * 100 * t) * 0.6 + np.sin(TAU * 200 * t + 0.4) * 0.5 + np.sin(TAU * 300 * t + 1.0) * 0.3
           + np.sin(TAU * 400 * t + 2.0) * 0.12)
    y += 0.09 * hum * (1 - np.exp(-t / 0.08)) * np.exp(-np.maximum(t - 0.3, 0) / 0.2)
    put(y, unit(I.glock(nn("F6"), 3))[: ns(0.6)], 0.11, 0.38)  # the "bling"
    put(y, unit(I.celesta(nn("C6"), 3))[: ns(0.6)], 0.11, 0.2)
    y *= np.minimum(1.0, (dur - t) / 0.2)
    return add_room(y, ROOM, -13.0)


def fan_loop():
    """Exactly periodic by construction: FFT-shaped periodic noise, every
    modulation / hum frequency is an integer multiple of 1/2 s."""
    rng = R(303)
    n = ns(2.0)
    t = np.arange(n) / SR
    air = periodic_noise(rng, n, lambda f: (f / (f + 260.0)) / (1.0 + (f / 1400.0) ** 2.3))
    hiss = periodic_noise(rng, n, lambda f: np.exp(-0.5 * (np.log2(f / 2200.0) / 0.6) ** 2))
    low = periodic_noise(rng, n, lambda f: np.exp(-0.5 * (np.log2(f / 330.0) / 0.6) ** 2))
    bpf = 42.0  # blade-pass: 3 blades x 14 rev/s
    flutter = 1.0 + 0.11 * np.sin(TAU * bpf * t) + 0.045 * np.sin(TAU * 2 * bpf * t + 1.0) + 0.03 * np.sin(TAU * 14.0 * t + 0.5)
    slow = 1.0 + 0.02 * np.sin(TAU * 0.5 * t) + 0.015 * np.sin(TAU * 1.5 * t + 2.0)
    y = air / rms(air) * (0.7 + 0.3 * flutter) + 0.22 * hiss / rms(hiss) * flutter + 0.5 * low / rms(low) * flutter
    y *= slow
    hum = (0.20 * np.sin(TAU * 100 * t) + 0.15 * np.sin(TAU * 200 * t + 0.3) + 0.08 * np.sin(TAU * 300 * t + 1.1)
           + 0.035 * np.sin(TAU * 400 * t + 2.0) + 0.05 * np.sin(TAU * 84 * t) + 0.04 * np.sin(TAU * 168 * t + 0.7)
           + 0.02 * np.sin(TAU * 252 * t + 1.9))
    y += hum * (1.0 + 0.04 * np.sin(TAU * 1.0 * t))
    return y


def conveyor_loop():
    rng = R(304)
    n = ns(2.0)
    t = np.arange(n) / SR
    rumble = periodic_noise(rng, n, lambda f: (f / (f + 110.0)) ** 2 / (1.0 + (f / 430.0) ** 2.5))
    rumble = rumble / rms(rumble) * (1.0 + 0.28 * np.sin(TAU * 8 * t) + 0.1 * np.sin(TAU * 16 * t + 0.7))
    belt = periodic_noise(rng, n, lambda f: np.exp(-0.5 * (np.log2(f / 1300.0) / 0.7) ** 2))
    belt = belt / rms(belt) * (1.0 + 0.35 * np.sin(TAU * 4 * t + 1.0))
    y = 0.8 * rumble + 0.16 * belt
    y += 0.10 * np.sin(TAU * 100 * t) + 0.08 * np.sin(TAU * 200 * t + 0.5) + 0.03 * np.sin(TAU * 300 * t + 1.3)
    y += 0.02 * np.sin(TAU * 350 * t) * (1.0 + 0.3 * np.sin(TAU * 2 * t))

    def tick(f, g):
        k = struck(rng, 0.07, f, [0.45, 1, 1.66, 2.57, 3.8], [0.5, 1, 0.5, 0.22, 0.08], 0.04, tilt=0.7, attack=0.0008,
                   click=(600, 3200, 0.005, 0.35))
        return g * k

    ticks = np.zeros(n)
    pattern = [(700.0, 1.0), (930.0, 0.28), (590.0, 0.75), (930.0, 0.24)] * 4  # tick-a-tock-a
    for s, (f, g) in enumerate(pattern):
        k = tick(f, g * (1.0 + 0.06 * rng.standard_normal()))
        i = int(round(s * n / 16))
        idx = (i + np.arange(len(k))) % n
        np.add.at(ticks, idx, k)
    y += 3.2 * ticks
    wet = convolve(y, ROOM) * 10 ** (-15 / 20)
    pad = (-len(wet)) % n
    wet = np.pad(wet, (0, pad)).reshape(-1, n).sum(axis=0)  # fold reverb tail around the loop
    # rotate so that the wrap point lies in the quiet gap between two ticks
    return np.roll(y + wet, ns(0.0625))


def _crackle(rng, dur, rate_fn, lo=1700.0, hi=6000.0, tail=1.4):
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for klen, kdec in ((0.004, 0.0006), (0.008, 0.0013), (0.014, 0.0026)):
        hits = rng.random(n) < rate_fn(t) / SR / 3.0
        imp = np.zeros(n)
        imp[hits] = rng.exponential(1.0, int(hits.sum())) ** tail * rng.choice([-1.0, 1.0], int(hits.sum()))
        kt = tt(klen)
        k = bp(rng.standard_normal(len(kt)), lo, hi, 1) * np.exp(-kt / kdec)
        y += signal.fftconvolve(imp, k)[:n]
    return y


def fuse():
    rng = R(305)
    dur = 1.25
    t = tt(dur)
    hiss = shaped_noise(rng, dur, 3100.0, 0.75)
    wob = 1.0 + 0.9 * lp(rng.standard_normal(len(t)), 22.0, 1) * 9.0
    hiss = unit(hiss * np.clip(wob, 0.25, 2.2))
    body = unit(shaped_noise(rng, dur, 950.0, 0.6)) * (0.6 + 0.4 * np.clip(wob, 0, 2))
    cr = _crackle(rng, dur, lambda x: 95.0 + 0 * x)
    y = 0.5 * hiss + 0.18 * body + 0.5 * cr / (np.percentile(np.abs(cr), 99.9) + 1e-9)
    y *= (1 - np.exp(-t / 0.012)) * np.minimum(1.0, (dur - t) / 0.16)
    y = soft_limit(y, 0.8, 0.5)
    return add_room(lp(y, 7000.0, 2), ROOM, -18.0)


def rocket_launch():
    rng = R(306)
    dur = 1.7
    t = tt(dur)
    # 1) fizz
    fz = unit(shaped_noise(rng, dur, 3000.0, 0.8)) * 0.6 + 0.5 * unit(_crackle(rng, dur, lambda x: 120.0 + 0 * x))
    fz_env = (1 - np.exp(-t / 0.02)) * np.exp(-np.maximum(t - 0.3, 0) / 0.12) * (0.5 + 0.5 * np.minimum(t / 0.3, 1.0))
    # 2) whoosh rising in pitch, then flying away
    u = np.clip((t - 0.28) / 1.2, 0.0, 1.0)
    fc_t = 420.0 * (2500.0 / 420.0) ** (u**0.75)
    wh = shaped_noise(rng, dur, lambda x: np.interp(x, t, fc_t), 0.62)
    wh_env = np.where(t > 0.28, (1 - np.exp(-(t - 0.28) / 0.07)) * np.exp(-np.maximum(t - 0.72, 0) / 0.33), 0.0)
    roar = unit(shaped_noise(rng, dur, 300.0, 0.7)) * np.where(t > 0.28, np.exp(-(t - 0.28) / 0.22) * (1 - np.exp(-(t - 0.28) / 0.03)), 0.0)
    # 3) the toy "pheeew" whistle riding on top
    fw = 780.0 * (2150.0 / 780.0) ** (u**0.8) * (1.0 + 0.018 * np.sin(TAU * 17.0 * t))
    ph = TAU * np.cumsum(fw) / SR
    whistle = (np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)) * wh_env * (0.7 + 0.3 * np.sin(TAU * 34.0 * t))
    y = 0.42 * fz * fz_env + 0.95 * unit(wh) * wh_env + 0.45 * roar + 0.26 * whistle
    y *= np.minimum(1.0, (dur - t) / 0.25)
    y = soft_limit(y, 0.85, 0.5)
    return add_room(lp(y, 7000.0, 2), ROOM_BIG, -17.0)


def firework():
    rng = R(307)
    dur = 2.0
    t = tt(dur)
    y = canvas(dur)
    boom = modal(0.7, [78.0, 156.0, 236.0, 318.0, 410.0, 530.0], [0.55, 0.8, 0.7, 0.5, 0.3, 0.16],
                 [0.32, 0.34, 0.28, 0.22, 0.17, 0.13], attack=0.006, bend=1.0 + 0.6 * np.exp(-tt(0.7) / 0.05))
    put(y, unit(softclip(unit(boom) * 1.5, 1.0)), 0.0, 0.75)
    put(y, unit(bp(lp_noise_burst(rng, 0.7, 900.0, 0.38, 0.006), 150.0, 1200.0, 1)), 0.0, 0.8)
    put(y, unit(noise_burst(rng, 0.3, 350.0, 1900.0, 0.16, 0.004, order=1)), 0.0, 0.55)
    # crackling sparkle tail
    rate = lambda x: np.where(x > 0.1, 150.0 * np.exp(-(x - 0.1) / 0.55) + 6.0, 0.0)
    cr = _crackle(rng, dur, rate, 1500.0, 5200.0, tail=1.0)
    cr *= np.exp(-np.maximum(t - 0.2, 0) / 0.9)
    y += 0.5 * cr / (np.percentile(np.abs(cr), 99.9) + 1e-9)
    # a few friendly glitter pings
    notes = ["C6", "F6", "A5", "D6", "G6", "A6", "F6", "C6", "A6"]
    for i, nm in enumerate(notes):
        t0 = 0.16 + 0.11 * i + 0.05 * rng.random()
        put(y, unit(I.glock(nn(nm), 2, i % 2)), t0, 0.07 * np.exp(-t0 / 1.0))
    y *= np.minimum(1.0, (dur - t) / 0.5)
    y = soft_limit(y, 0.85, 0.5)
    return add_room(lp(y, 6800.0, 2), ROOM_BIG, -13.0)


def bell():
    rng = R(308)
    f = midi_hz(nn("F5"))
    ratios = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433]
    amps = [0.45, 1.0, 0.5, 0.22, 0.6, 0.16, 0.13, 0.2, 0.07, 0.03]
    F, A, D = [], [], []
    for r, a in zip(ratios, amps):
        fk = f * r
        a /= 1.0 + (fk / 3800.0) ** 3
        d = 3.4 / r**0.85 if r >= 1.0 else 3.0
        beat = rng.uniform(0.35, 1.3)
        F += [fk, fk + beat]
        A += [a, a * 0.55]
        D += [d, d * 0.92]
    dur = 3.0
    t = tt(dur)
    y = modal(dur, F, A, D, attack=0.0008, phases=rng.uniform(-0.3, 0.3, len(F)))
    y = unit(y)
    nb = noise_burst(rng, 0.03, 900.0, 4200.0, 0.008, 0.0003)
    y[: len(nb)] += 0.22 * unit(nb)
    y *= np.minimum(1.0, (dur - t) / 0.9) ** 1.5
    return add_room(y, ROOM_CHIME, -16.0)


# --------------------------------------------------------------------------
# rewards (mono chimes; the stereo fanfares live in music.py)
# --------------------------------------------------------------------------


def star():
    rng = R(401)
    y = canvas(0.92)
    for i, nm in enumerate(("A5", "C6", "F6", "A6")):
        t0 = 0.068 * i
        put(y, unit(I.glock(nn(nm), 3 + (i == 3), i % 2)), t0, 0.62 + 0.12 * i)
        put(y, unit(I.celesta(nn(nm) - 12, 3)), t0, 0.22)
    t = tt(0.92)
    sp = shaped_noise(rng, 0.92, lambda x: 2600.0 + 1800.0 * np.clip(x / 0.3, 0, 1), 0.45) * bell_env(t, 0.26, 0.09, 0.16)
    y += 0.05 * unit(sp)
    y *= decay(t, 2.5)
    return add_room(y, ROOM_CHIME, -14.0)


def unlock():
    y = canvas(1.15)
    for nm, g in (("Bb4", 0.7), ("D5", 0.7), ("F5", 0.8)):
        put(y, unit(I.celesta(nn(nm), 3)), 0.0, g * 0.5)
        put(y, unit(I.marimba(nn(nm), 3)), 0.0, g * 0.5)
    put(y, unit(I.bass(nn("Bb2"), 3, 200))[: ns(0.4)], 0.0, 0.3)
    for i, (nm, g) in enumerate((("C5", 0.7), ("F5", 0.8), ("A5", 0.85), ("C6", 0.8))):
        t0 = 0.235 + 0.012 * i  # gently rolled chord
        put(y, unit(I.celesta(nn(nm), 4)), t0, g * 0.5)
        put(y, unit(I.marimba(nn(nm), 4)), t0, g * 0.45)
    put(y, unit(I.glock(nn("F6"), 3)), 0.26, 0.35)
    put(y, unit(I.bass(nn("F2"), 3, 500))[: ns(0.7)], 0.235, 0.3)
    y *= decay(tt(1.15), 2.6)
    return add_room(y, ROOM_CHIME, -14.0)


def confetti():
    rng = R(403)
    dur = 0.95
    t = tt(dur)
    y = canvas(dur)
    pf = shaped_noise(rng, 0.1, lambda x: 1100.0 * (3200.0 / 1100.0) ** np.clip(x / 0.08, 0, 1), 0.6)
    pf *= np.clip(tt(0.1) / 0.075, 0, 1) ** 2 * np.minimum(1.0, (0.1 - tt(0.1)) / 0.012)
    put(y, unit(pf), 0.0, 0.5)
    snap = noise_burst(rng, 0.04, 550.0, 4200.0, 0.009, 0.0004, order=1)
    put(y, unit(snap), 0.082, 0.9)
    th = modal(0.07, [330.0, 610.0], [1, 0.4], [0.04, 0.03], attack=0.001, bend=1.0 + 0.4 * np.exp(-tt(0.07) / 0.01))
    put(y, unit(th), 0.082, 0.5)
    # paper flutter: many small rustling grains, thinning out
    fl = np.zeros_like(t)
    tg = 0.12
    while tg < 0.86:
        gl = rng.uniform(0.018, 0.055)
        g = shaped_noise(rng, gl, rng.uniform(1700.0, 4300.0), rng.uniform(0.3, 0.55), nfft=256, hop=32)
        g *= np.hanning(len(g)) ** 2
        put(fl, unit(g), tg, rng.uniform(0.4, 1.0) * np.exp(-(tg - 0.12) / 0.33))
        tg += rng.exponential(0.014) * (1.0 + 2.2 * (tg - 0.12))
    y += 0.42 * fl
    y = soft_limit(y, 0.8, 0.5)
    return add_room(lp(y, 6800.0, 2), ROOM, -13.0)
