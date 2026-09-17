/**
 * lib/programs.mjs — FONTE ÚNICA dos programas da IT.FM.
 *
 * Hoje o array vive inline em build-programacao.mjs; passa a viver aqui para o
 * serviço de música e o builder partilharem a mesma verdade (slug, janela,
 * género). Os campos `dir`/`locutor`/`genero` mantêm o shape do build atual (para
 * um futuro refactor importar daqui sem mudança de comportamento); os campos de
 * música (`ytGenre*`, `poolSize`, `minDur`, `maxDur`) são novos.
 *
 * `ytGenre` é o rótulo a procurar em `ytmusicapi.get_mood_categories()`; como os
 * rótulos exatos podem variar, o select.py faz match por substring e cai para
 * `ytGenreAlts` (por ordem) — e, em último recurso, para charts.
 *
 * Janela: [inicio, fim) em horas locais de Lisboa. A música toca 24/7 na sua
 * janela; a madrugada (23–07) é coberta à parte pelo deployer da programação.
 */
export const PROGRAMS = [
  {
    dir: "BootMatinal_DiogoSilva", nome: "Boot Matinal", locutor: "Diogo Silva", slug: "diogo_silva",
    genero: "rock", inicio: 7, fim: 10,
    ytGenre: "Feel Good", ytGenreAlts: ["Pop", "Energy Boosters", "Commute"],
    poolSize: 20, minDur: 120, maxDur: 360,
  },
  {
    dir: "CtrlAltRitmo_SofiaMartins", nome: "Ctrl+Alt+Ritmo", locutor: "Sofia Martins", slug: "sofia_martins",
    genero: "rock", inicio: 10, fim: 13,
    ytGenre: "Dance & Electronic", ytGenreAlts: ["Electronic", "Dance", "Party"],
    poolSize: 20, minDur: 120, maxDur: 360,
  },
  {
    dir: "Pause&Play_TomasRocha", nome: "Pause & Play", locutor: "Tomás Rocha", slug: "tomas_rocha",
    genero: "house", inicio: 13, fim: 16,
    ytGenre: "Indie & Alternative", ytGenreAlts: ["Chill", "Indie", "Focus"],
    poolSize: 20, minDur: 120, maxDur: 360,
  },
  {
    dir: "HoraDePonta_BeatrizLima", nome: "Hora de Ponta", locutor: "Beatriz Lima", slug: "beatriz_lima",
    genero: "house", inicio: 16, fim: 20,
    ytGenre: "Hip-Hop", ytGenreAlts: ["Hip Hop", "Party", "Energy Boosters"],
    poolSize: 20, minDur: 120, maxDur: 360,
  },
  {
    dir: "ModoNoturno_GoncaloPires", nome: "Modo Noturno", locutor: "Gonçalo Pires", slug: "goncalo_pires",
    genero: "house", inicio: 20, fim: 23,
    ytGenre: "R&B & Soul", ytGenreAlts: ["Chill", "Sleep", "R&B"],
    poolSize: 20, minDur: 120, maxDur: 360,
  },
];

/** Programa por slug (ou undefined). */
export const programBySlug = (slug) => PROGRAMS.find((p) => p.slug === slug);

/** Janela HHMM (ex.: 7 → 700, 20 → 2000) para schedule_items. */
export const hhmm = (hour) => hour * 100;
