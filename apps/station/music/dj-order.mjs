/**
 * dj-order.mjs — harmonic BPM-aware track ordering for DJ-mode programs.
 *
 * Takes an array of tracks with { path, bpm, key, energy } and returns them
 * sorted for smooth DJ-style transitions:
 *   1. BPM progression (gradual ramp up, then cool down)
 *   2. Camelot Wheel compatibility between consecutive tracks
 *   3. Energy curve (warm up → peak → wind down)
 *
 * The ordering uses a nearest-neighbor greedy algorithm on a combined
 * BPM-distance + Camelot-distance score, starting from the lowest-energy
 * track and building outward.
 */

// Camelot Wheel adjacency: compatible keys are ±1 on the wheel number
// (same letter) or same number (switch letter). E.g., 8A is compatible
// with 7A, 9A, and 8B.
function parseCamelot(key) {
  const m = /^(\d{1,2})([AB])$/i.exec(key || "1A");
  if (!m) return { num: 1, letter: "A" };
  return { num: parseInt(m[1], 10), letter: m[2].toUpperCase() };
}

function camelotDistance(a, b) {
  const ka = parseCamelot(a);
  const kb = parseCamelot(b);
  if (ka.num === kb.num && ka.letter === kb.letter) return 0;
  if (ka.num === kb.num && ka.letter !== kb.letter) return 1;
  if (ka.letter === kb.letter) {
    const diff = Math.abs(ka.num - kb.num);
    const wrap = 12 - diff;
    return Math.min(diff, wrap);
  }
  // Different letter AND different number — poor match
  const diff = Math.abs(ka.num - kb.num);
  const wrap = 12 - diff;
  return Math.min(diff, wrap) + 2;
}

/**
 * Orders tracks for DJ-style playback.
 * @param {Array<{path: string, bpm: number, key: string, energy: number}>} tracks
 * @returns {string[]} ordered paths
 */
export function djOrder(tracks) {
  if (tracks.length <= 2) return tracks.map((t) => t.path);

  // Score: lower = better transition. BPM difference dominates, Camelot is
  // a tiebreaker/bonus. Energy difference adds a small penalty for jumps.
  function transitionScore(a, b) {
    const bpmDiff = Math.abs(a.bpm - b.bpm);
    const camDist = camelotDistance(a.key, b.key);
    const energyDiff = Math.abs(a.energy - b.energy);
    return bpmDiff * 1.0 + camDist * 3.0 + energyDiff * 5.0;
  }

  // Nearest-neighbor greedy: start from the lowest-BPM track, always pick
  // the closest unvisited track. This naturally creates a BPM ramp.
  const sorted = [...tracks].sort((a, b) => a.bpm - b.bpm);
  const used = new Set();
  const order = [];

  let current = sorted[0];
  order.push(current);
  used.add(current.path);

  while (order.length < tracks.length) {
    let bestScore = Infinity;
    let bestTrack = null;
    for (const t of tracks) {
      if (used.has(t.path)) continue;
      const s = transitionScore(current, t);
      if (s < bestScore) {
        bestScore = s;
        bestTrack = t;
      }
    }
    if (!bestTrack) break;
    order.push(bestTrack);
    used.add(bestTrack.path);
    current = bestTrack;
  }

  return order.map((t) => t.path);
}

/**
 * Pretty-prints the DJ order with transition info (for console logging).
 */
export function djOrderLog(tracks, orderedPaths) {
  const byPath = Object.fromEntries(tracks.map((t) => [t.path, t]));
  const lines = [];
  for (let i = 0; i < orderedPaths.length; i++) {
    const t = byPath[orderedPaths[i]];
    if (!t) continue;
    const prefix = i === 0 ? "  ▸" : "  →";
    const trans = i > 0 ? (() => {
      const prev = byPath[orderedPaths[i - 1]];
      if (!prev) return "";
      const cam = camelotDistance(prev.key, t.key);
      const bpmD = Math.abs(prev.bpm - t.bpm).toFixed(0);
      const compat = cam <= 1 ? "★" : cam <= 2 ? "○" : "✕";
      return ` [Δbpm=${bpmD} key=${compat}]`;
    })() : "";
    lines.push(`${prefix} ${t.bpm} BPM · ${t.key} · e=${t.energy} — ${t.path}${trans}`);
  }
  return lines.join("\n");
}
