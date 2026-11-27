"""DSP building blocks for the procedural audio of "Wolfgangs Tueftelwerkstatt".

Everything here is deterministic (callers pass seeded numpy Generators).
No samples are used anywhere: all sound is synthesised from these primitives:

* modal synthesis (sums of exponentially decaying, inharmonic partials)
* additive plucked-string model (the closed-form solution of an ideal plucked
  string with frequency dependent damping, i.e. what Karplus-Strong computes)
* FM, additive "brass", pads
* shaped / time-varying filtered noise (STFT domain) and periodic noise (loops)
* synthetic convolution reverb (decaying multi-band noise + early reflections)
* BS.1770 K-weighted loudness measurement
"""
from __future__ import annotations

import subprocess
import warnings

import numpy as np
from scipy import signal

SR = 44100
TAU = 2.0 * np.pi

# --------------------------------------------------------------------------
# basics
# --------------------------------------------------------------------------


def ns(dur: float) -> int:
    return int(round(dur * SR))


def tt(dur: float) -> np.ndarray:
    return np.arange(ns(dur)) / SR


def midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def nn(name: str) -> int:
    """'F#5' / 'Bb4' -> midi note number (C4 = 60)."""
    p = _NOTE[name[0]]
    i = 1
    while name[i] in "#b":
        p += 1 if name[i] == "#" else -1
        i += 1
    return p + 12 * (int(name[i:]) + 1)


def db(x: float) -> float:
    return 20.0 * np.log10(max(float(x), 1e-12))


def lin(d: float) -> float:
    return 10.0 ** (d / 20.0)


def peak_db(x: np.ndarray) -> float:
    return db(np.max(np.abs(x))) if x.size else -240.0


# --------------------------------------------------------------------------
# filters (all causal -> no pre-ringing in front of transients)
# --------------------------------------------------------------------------


def lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "low", fs=SR, output="sos"), x, axis=0)


def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x, axis=0)


def peq(x, f0, gain_db, q=1.0):
    """RBJ peaking EQ."""
    a = 10.0 ** (gain_db / 40.0)
    w0 = TAU * f0 / SR
    alpha = np.sin(w0) / (2.0 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    aa = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(np.array(b) / aa[0], np.array(aa) / aa[0], x, axis=0)


def resonator(x, f0, q, gain=1.0):
    """2-pole band-pass resonator (constant peak gain)."""
    b, a = signal.iirpeak(f0, q, fs=SR)
    return gain * signal.lfilter(b, a, x, axis=0)


def softclip(x, drive=1.0):
    """tanh saturation, unity gain for small signals."""
    return np.tanh(x * drive) / drive


def soft_limit(x, ceiling, knee=0.5):
    """Memoryless soft limiter: linear below knee*ceiling, tanh-shaped above."""
    k = knee * ceiling
    y = x.copy()
    over = np.abs(x) > k
    y[over] = np.sign(x[over]) * (k + (ceiling - k) * np.tanh((np.abs(x[over]) - k) / (ceiling - k)))
    return y


# --------------------------------------------------------------------------
# envelopes
# --------------------------------------------------------------------------


def decay(t, t60):
    return np.exp(-6.908 * t / t60)


def fade_io(x, fin=0.003, fout=0.02):
    """Raised-cosine fade in / out (returns a copy)."""
    y = np.array(x, dtype=float, copy=True)
    n = len(y)
    a = min(ns(fin), n // 2)
    b = min(ns(fout), n // 2)
    if a > 0:
        w = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
        y[:a] = (y[:a].T * w).T
    if b > 0:
        w = 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
        y[-b:] = (y[-b:].T * w).T
    return y


def bell_env(t, t0, rise, fall):
    """Asymmetric smooth bump peaking at t0."""
    e = np.where(t < t0, np.exp(-0.5 * ((t - t0) / rise) ** 2), np.exp(-0.5 * ((t - t0) / fall) ** 2))
    return e


def adsr(dur, a, d, s, r, total=None):
    """Smooth ADSR; note is held for `dur`, array lasts `total` (default dur+r*4)."""
    total = dur + 4 * r if total is None else total
    t = tt(total)
    att = 1.0 - np.exp(-t / (a / 3.0))
    dec = s + (1.0 - s) * np.exp(-t / d)
    rel = np.where(t < dur, 1.0, np.exp(-(t - dur) / r))
    return att * dec * rel


# --------------------------------------------------------------------------
# sources
# --------------------------------------------------------------------------


def modal(dur, freqs, amps, t60s, attack=0.0004, phases=None, bend=None):
    """Sum of exponentially decaying sinusoids.

    bend: optional per-sample frequency multiplier (pitch glide).
    attack: time constant of a (1-exp) onset -> "mallet hardness".
    """
    t = tt(dur)
    y = np.zeros_like(t)
    base = None if bend is None else TAU * np.cumsum(bend) / SR
    for i, (f, a, d) in enumerate(zip(freqs, amps, t60s)):
        if f >= 0.45 * SR or a == 0.0:
            continue
        ph = 0.0 if phases is None else phases[i]
        arg = TAU * f * t if base is None else f * base
        y += a * np.exp(-6.908 * t / d) * np.sin(arg + ph)
    if attack > 0:
        y *= 1.0 - np.exp(-t / attack)
    return y


def cluster(rng, freqs, amps, t60s, sat=2, spread=0.07, sat_amp=0.35):
    """Add randomly detuned satellite modes around each base mode.

    Real objects have far more modes than the handful an idealised bar has;
    the satellites give the 'grainy', non-synthetic quality of real wood/metal.
    """
    F, A, D = list(freqs), list(amps), list(t60s)
    for f, a, d in zip(freqs, amps, t60s):
        for _ in range(sat):
            F.append(f * (1.0 + rng.uniform(-spread, spread) + rng.choice([-1, 1]) * 0.02))
            A.append(a * sat_amp * rng.uniform(0.4, 1.0))
            D.append(d * rng.uniform(0.5, 0.95))
    return F, A, D


def noise_burst(rng, dur, lo, hi, t60, attack=0.0003, order=2):
    n = ns(dur)
    x = bp(rng.standard_normal(n), lo, hi, order)
    t = np.arange(n) / SR
    return x * decay(t, t60) * (1.0 - np.exp(-t / attack))


def lp_noise_burst(rng, dur, fc, t60, attack=0.001):
    n = ns(dur)
    x = lp(rng.standard_normal(n), fc, 2)
    t = np.arange(n) / SR
    return x * decay(t, t60) * (1.0 - np.exp(-t / attack))


def shaped_noise(rng, dur, fc, bw_oct=1.0, nfft=1024, hop=128, tilt=0.0):
    """Noise with a time-varying log-gaussian band-pass (STFT domain).

    fc: callable t->Hz (vectorised) or constant; bw_oct: callable or constant
    (standard deviation of the band in octaves); tilt: dB/oct spectral tilt.
    """
    n = ns(dur)
    w = rng.standard_normal(n + 2 * nfft)
    f, tf, Z = signal.stft(w, SR, nperseg=nfft, noverlap=nfft - hop, boundary=None)
    tf = tf - nfft / SR
    fcs = fc(tf) if callable(fc) else np.full_like(tf, float(fc))
    bws = bw_oct(tf) if callable(bw_oct) else np.full_like(tf, float(bw_oct))
    ff = np.maximum(f, 20.0)[:, None]
    shape = np.exp(-0.5 * (np.log2(ff / np.maximum(fcs, 20.0)[None, :]) / bws[None, :]) ** 2)
    if tilt:
        shape *= (ff / 1000.0) ** (tilt / 6.02)
    with warnings.catch_warnings():  # edge frames are cropped below, NOLA warning is moot
        warnings.simplefilter("ignore")
        _, y = signal.istft(Z * shape, SR, nperseg=nfft, noverlap=nfft - hop, boundary=None)
    y = y[nfft : nfft + n]
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    return y


def periodic_noise(rng, n, shape_fn):
    """Exactly n-periodic coloured noise (spectrum shaped in the FFT domain)."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    spec *= shape_fn(np.maximum(f, 1.0))
    spec[0] = 0.0
    return np.fft.irfft(spec, n)


def blsaw(phase, f_inst, fmax=6000.0, kmax=40, rolloff=1.0):
    """Band-limited saw by additive synthesis; phase in cycles, f_inst in Hz.

    Harmonics are faded out smoothly as they approach fmax (no aliasing).
    """
    y = np.zeros_like(phase)
    fmin = float(np.min(f_inst))
    K = int(min(kmax, fmax / max(fmin, 1.0)))
    for k in range(1, K + 1):
        g = np.clip((fmax - k * f_inst) / (0.25 * fmax), 0.0, 1.0)
        y += g * np.sin(TAU * k * phase) / k**rolloff
    return y


# --------------------------------------------------------------------------
# reverb
# --------------------------------------------------------------------------


def make_ir(rng, t60=0.3, predelay=0.004, channels=1, hf_ratio=0.45, lf_ratio=1.1,
            er_count=8, er_span=0.03, er_gain=5.0, lowcut=180.0, highcut=6500.0):
    """Synthetic room impulse response.

    Diffuse tail = three noise bands with their own decay times (high
    frequencies die faster, like in a wooden room) + a handful of sparse early
    reflections.  Each channel uses independent noise -> decorrelated stereo.
    Energy-normalised per channel.
    """
    n = ns(predelay + t60 * 1.25 + 0.05)
    t = np.arange(n) / SR
    out = np.zeros((n, channels))
    pd = ns(predelay)
    for c in range(channels):
        noise = rng.standard_normal(n)
        lo = lp(noise, 450.0)
        hi = hp(noise, 2600.0)
        mid = bp(noise, 450.0, 2600.0, 1)
        tail = lo * decay(t, t60 * lf_ratio) + mid * decay(t, t60) + hi * decay(t, t60 * hf_ratio)
        tail *= 1.0 - np.exp(-t / 0.006)
        ir = np.zeros(n)
        ir[pd:] += tail[: n - pd]
        for k in range(er_count):
            tk = predelay + rng.uniform(0.0015, er_span)
            g = er_gain * rng.uniform(0.4, 1.0) * (-1.0) ** k * np.exp(-2.0 * (tk - predelay) / er_span)
            ir[min(n - 1, ns(tk))] += g
        ir = hp(lp(ir, highcut, 1), lowcut, 1)
        ir *= np.minimum(1.0, (n - np.arange(n)) / (0.03 * SR))
        ir /= np.sqrt(np.sum(ir**2))
        out[:, c] = ir
    return out if channels > 1 else out[:, 0]


def convolve(x, ir):
    return signal.fftconvolve(x, ir, mode="full")


def add_room(x, ir, wet_db=-14.0):
    """Mono dry + mono wet; output is longer by the IR length."""
    wet = convolve(x, ir) * lin(wet_db)
    out = wet
    out[: len(x)] += x
    return out


# --------------------------------------------------------------------------
# loudness (ITU-R BS.1770 K-weighting)
# --------------------------------------------------------------------------


def _k_coeffs():
    # Analog-prototype re-derivation of the BS.1770 filters for arbitrary
    # sample rates (Brecht De Man); matches the 48 kHz reference coefficients.
    g, q, fc = 3.999843853973347, 0.7071752369554196, 1681.974450955533
    k = np.tan(np.pi * fc / SR)
    vh = 10.0 ** (g / 20.0)
    vb = vh**0.4996667741545416
    a0 = 1.0 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    q, fc = 0.5003270373238773, 38.13547087602444
    k = np.tan(np.pi * fc / SR)
    a0 = 1.0 + k / q + k * k
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    return (np.array(b1), np.array(a1)), (np.array(b2), np.array(a2))


_K1, _K2 = _k_coeffs()


def k_weight(x):
    y = signal.lfilter(_K1[0], _K1[1], x, axis=0)
    return signal.lfilter(_K2[0], _K2[1], y, axis=0)


def lufs_integrated(x, circular=False):
    """Gated integrated loudness (BS.1770-4). x: (n,) or (n, ch)."""
    x = np.atleast_2d(x.T).T
    if circular:  # loop: run the filter in from the loop's own end
        pre = min(len(x), 2 * SR)
        y = k_weight(np.concatenate([x[-pre:], x], axis=0))[pre:]
    else:
        y = k_weight(x)
    blk, hop = ns(0.4), ns(0.1)
    if len(y) < blk:
        ms = np.sum(np.mean(y**2, axis=0))
        return -0.691 + 10 * np.log10(max(ms, 1e-12))
    p = np.sum(y**2, axis=1)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    idx = np.arange(0, len(y) - blk + 1, hop)
    z = (cs[idx + blk] - cs[idx]) / blk
    l = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    keep = l > -70.0
    if not np.any(keep):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(z[keep])) - 10.0
    keep &= l > rel
    return -0.691 + 10 * np.log10(np.mean(z[keep]))


def loud_window(x, win=0.1):
    """Max K-weighted loudness in a sliding window (energy referred to the full
    window length even if the sound is shorter) -> perceived loudness of short
    one-shots (the ear integrates over roughly 100 ms)."""
    x = np.atleast_2d(x.T).T
    y = k_weight(np.concatenate([x, np.zeros((ns(win), x.shape[1]))], axis=0))
    p = np.sum(y**2, axis=1)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    w = ns(win)
    if len(p) <= w:
        z = cs[-1] / w
    else:
        z = np.max(cs[w:] - cs[:-w]) / w
    return -0.691 + 10 * np.log10(max(z, 1e-12))


def spectral_centroid(x):
    x = np.atleast_2d(x.T).T.mean(axis=1)
    f, p = signal.welch(x, SR, nperseg=min(4096, max(256, len(x))))
    return float(np.sum(f * p) / max(np.sum(p), 1e-20))


# --------------------------------------------------------------------------
# encoding
# --------------------------------------------------------------------------


def write_ogg(path, x, quality):
    """Encode float array (n,) or (n,2) to OGG Vorbis 44.1 kHz via ffmpeg.

    -page_duration 50 ms: with ffmpeg's default (1 s pages) a file shorter
    than one page is a single Ogg page, and ffmpeg-based decoders (that
    includes Chrome's decodeAudioData) then mis-time the stream and drop the
    last 128 samples.  Short pages make every decoder return the exact
    sample count (verified in analyze.py); the overhead is ~0.5 kB/s."""
    x = np.asarray(x, dtype=np.float32)
    ch = 1 if x.ndim == 1 else x.shape[1]
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "pipe:0",
           "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
           "-c:a", "libvorbis", "-q:a", str(quality), "-ar", str(SR), "-ac", str(ch),
           "-page_duration", "50000", str(path)]
    subprocess.run(cmd, input=x.tobytes(), check=True)
