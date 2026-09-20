// Arranjo do soundboard partilhado entre a aba Settings (onde se arrastam os
// cartões para a posição desejada) e o soundboard flutuante da página Live.
// Persistido no localStorage do browser para que reordenar em Settings se
// reflita imediatamente no soundboard — enquanto NÃO há backend, esta é a
// "fonte de verdade" do lado do cliente. Ao ligar, isto passa a gravar a config
// de carts no apps/station (com backup). NB: só corre no browser (guardado por
// `typeof window`), pelo que a leitura tem de ser feita num useEffect para não
// causar mismatch de hidratação — o estado inicial vem sempre do seam (props).

import { HOTKEYS, type SoundPad } from "../../_lib/settings";

const KEY = "gestao:soundboard:v1";

// A hotkey de cada cartão é POSICIONAL (segue o layout físico HOTKEYS). Depois
// de mover/trocar cartões, re-normaliza as hotkeys pelo índice do slot.
export function normalizeHotkeys(pads: (SoundPad | null)[]): (SoundPad | null)[] {
  return pads.map((p, i) => (p ? { ...p, hotkey: HOTKEYS[i] } : null));
}

// Troca o conteúdo de dois slots (mover um cartão para onde o utilizador quiser)
// e re-normaliza as hotkeys pela nova posição.
export function swapPads(pads: (SoundPad | null)[], from: number, to: number): (SoundPad | null)[] {
  if (from === to || from < 0 || to < 0 || from >= pads.length || to >= pads.length) return pads;
  const next = pads.slice();
  const tmp = next[to];
  next[to] = next[from];
  next[from] = tmp;
  return normalizeHotkeys(next);
}

export function loadPads(fallback: (SoundPad | null)[]): (SoundPad | null)[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return fallback;
    return normalizeHotkeys(parsed as (SoundPad | null)[]);
  } catch {
    return fallback;
  }
}

export function savePads(pads: (SoundPad | null)[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pads));
  } catch {
    // ignora (quota cheia / modo privado)
  }
}

export const SOUNDBOARD_STORE_KEY = KEY;
