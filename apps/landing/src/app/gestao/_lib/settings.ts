// Definições da gestão. SEAM de ligação: hoje devolve config PLACEHOLDER do
// soundboard (cartões/hot keys). Quando ligarmos, guarda-se num ficheiro de
// config do apps/station (ex.: carts.json) e os pads apontam para ficheiros
// reais em /home/itradio/itfm-data. A grelha é 4×4 (16 slots; null = vazio).
// Segredos (.env) NUNCA são geridos aqui.

export type PadKind = "jingle" | "noticias" | "anuncio" | "segmento" | "efeito" | "musica";

export type SoundPad = {
  id: string;
  label: string;
  kind: PadKind;
  ficheiro: string;
  hotkey: string; // tecla única (mostrada no pad)
  dur: string; // "0:08" / "loop"
};

export type SettingsData = {
  // 16 posições fixas (4×4), na ordem das teclas HOTKEYS; null = pad vazio.
  pads: (SoundPad | null)[];
};

// Layout de teclas do soundboard (linha a linha, esquerda→direita).
export const HOTKEYS = ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"];

const MOCK: SettingsData = {
  pads: [
    { id: "p1", label: "ID Pause & Play", kind: "jingle", ficheiro: "carts/id_pause_play.mp3", hotkey: "1", dur: "0:08" },
    { id: "p2", label: "Sweeper IT.FM", kind: "jingle", ficheiro: "carts/sweeper_itfm.mp3", hotkey: "2", dur: "0:06" },
    { id: "p3", label: "Aplausos", kind: "efeito", ficheiro: "fx/aplausos.mp3", hotkey: "3", dur: "0:05" },
    { id: "p4", label: "Stinger", kind: "efeito", ficheiro: "fx/stinger.mp3", hotkey: "4", dur: "0:02" },
    { id: "p5", label: "Boletim :30", kind: "noticias", ficheiro: "programas/noticias_live.mp3", hotkey: "Q", dur: "0:52" },
    { id: "p6", label: "Meteo", kind: "segmento", ficheiro: "segmentos/meteo.mp3", hotkey: "W", dur: "0:24" },
    { id: "p7", label: "Trânsito", kind: "segmento", ficheiro: "segmentos/transito.mp3", hotkey: "E", dur: "0:18" },
    { id: "p8", label: "Flash notícia", kind: "noticias", ficheiro: "segmentos/flash.mp3", hotkey: "R", dur: "0:35" },
    { id: "p9", label: "Spot — Café Aurora", kind: "anuncio", ficheiro: "ads/cafe_aurora.mp3", hotkey: "A", dur: "0:30" },
    { id: "p10", label: "Spot — Auto Silva", kind: "anuncio", ficheiro: "ads/auto_silva.mp3", hotkey: "S", dur: "0:30" },
    { id: "p11", label: "Risos", kind: "efeito", ficheiro: "fx/risos.mp3", hotkey: "D", dur: "0:04" },
    null, // F
    { id: "p13", label: "Bed suave", kind: "musica", ficheiro: "beds/suave.mp3", hotkey: "Z", dur: "loop" },
    null, // X
    null, // C
    null, // V
  ],
};

export async function getSettingsData(): Promise<SettingsData> {
  // TODO(ligação): ler/gravar a config de carts (ex.: carts.json) com backup.
  return MOCK;
}
