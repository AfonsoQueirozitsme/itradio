#!/usr/bin/env python3
"""
analyze-bpm-key.py — BPM, musical key, and energy analysis via librosa.

Input:  one or more MP3 file paths as positional arguments.
Output: JSON array to STDOUT with one object per file:
        [{"file": "path.mp3", "bpm": 128.0, "key": "8B", "energy": 0.72}]

The key is in Camelot Wheel notation (1A–12A, 1B–12B) for harmonic mixing.
Energy is RMS-based, normalized 0–1 across the track.

Diagnostics go to STDERR (safe for the caller to JSON.parse STDOUT).

Dependencies: librosa, numpy (install in the music/.venv).
"""
import json
import sys

def log(*a):
    print(*a, file=sys.stderr, flush=True)

# Camelot Wheel: maps (pitch_class, mode) to Camelot notation.
# pitch_class: 0=C, 1=C#, ..., 11=B.  mode: 0=minor, 1=major.
CAMELOT = {
    (0, 1): "8B",  (0, 0): "5A",   # C maj / C min
    (1, 1): "3B",  (1, 0): "12A",  # Db maj / C# min
    (2, 1): "10B", (2, 0): "7A",   # D maj / D min
    (3, 1): "5B",  (3, 0): "2A",   # Eb maj / Eb min
    (4, 1): "12B", (4, 0): "9A",   # E maj / E min
    (5, 1): "7B",  (5, 0): "4A",   # F maj / F min
    (6, 1): "2B",  (6, 0): "11A",  # Gb maj / F# min
    (7, 1): "9B",  (7, 0): "6A",   # G maj / G min
    (8, 1): "4B",  (8, 0): "1A",   # Ab maj / Ab min
    (9, 1): "11B", (9, 0): "8A",   # A maj / A min
    (10, 1): "6B", (10, 0): "3A",  # Bb maj / Bb min
    (11, 1): "1B", (11, 0): "10A", # B maj / B min
}

def correct_bpm(bpm):
    """Fix common 2x/0.5x detection errors. Target range: 70–180."""
    if bpm <= 0:
        return 0.0
    while bpm > 180:
        bpm /= 2
    while bpm < 70:
        bpm *= 2
    return round(bpm, 1)

def analyze(filepath):
    """Analyze a single audio file. Returns dict or None on failure."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        log("ERRO: librosa/numpy not installed. Run: music/.venv/bin/pip install librosa numpy")
        sys.exit(3)

    try:
        y, sr = librosa.load(filepath, sr=22050, mono=True)
    except Exception as e:
        log(f"  ! failed to load {filepath}: {e}")
        return None

    # BPM
    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = correct_bpm(float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo))
    except Exception as e:
        log(f"  ! BPM detection failed for {filepath}: {e}")
        bpm = 0.0

    # Key detection via chroma
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)

        # Major and minor key profiles (Krumhansl-Kessler)
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

        best_corr = -2
        best_key = (0, 1)
        for shift in range(12):
            shifted = np.roll(chroma_mean, -shift)
            corr_maj = float(np.corrcoef(shifted, major_profile)[0, 1])
            corr_min = float(np.corrcoef(shifted, minor_profile)[0, 1])
            if corr_maj > best_corr:
                best_corr = corr_maj
                best_key = (shift, 1)
            if corr_min > best_corr:
                best_corr = corr_min
                best_key = (shift, 0)

        camelot = CAMELOT.get(best_key, "1A")
    except Exception as e:
        log(f"  ! key detection failed for {filepath}: {e}")
        camelot = "1A"

    # Energy (normalized RMS)
    try:
        rms = librosa.feature.rms(y=y)[0]
        energy = float(np.mean(rms))
        rms_max = float(np.max(rms)) if np.max(rms) > 0 else 1.0
        energy = round(energy / rms_max, 3)
    except Exception as e:
        log(f"  ! energy detection failed for {filepath}: {e}")
        energy = 0.5

    return {"file": filepath, "bpm": bpm, "key": camelot, "energy": energy}


def main():
    if len(sys.argv) < 2:
        log("Usage: analyze-bpm-key.py <file1.mp3> [file2.mp3 ...]")
        sys.exit(1)

    results = []
    for f in sys.argv[1:]:
        log(f"  analyzing {f}...")
        r = analyze(f)
        if r:
            results.append(r)
            log(f"    bpm={r['bpm']} key={r['key']} energy={r['energy']}")

    json.dump(results, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
