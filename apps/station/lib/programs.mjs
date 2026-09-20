/**
 * lib/programs.mjs — FONTE ÚNICA dos programas da IT.FM.
 *
 * Hoje o array vive inline em build-programacao.mjs; passa a viver aqui para o
 * serviço de música e o builder partilharem a mesma verdade (slug, janela,
 * género). Os campos `dir`/`locutor`/`genero` mantêm o shape do build atual (para
 * um futuro refactor importar daqui sem mudança de comportamento); os campos de
 * música (`ytGenre*`, `poolSize`, `poolCap`, `minDur`, `maxDur`) são novos.
 *
 * `poolSize` = faixas NOVAS a acrescentar por refresh; `poolCap` = TETO da pool
 * no ar (o deploy retira as mais antigas acima do teto → rotação, não crescimento
 * infinito). Sem `poolCap`, assume-se DEFAULT_POOL_CAP.
 *
 * `ytGenre` é o rótulo a procurar em `ytmusicapi.get_mood_categories()`; como os
 * rótulos exatos podem variar, o select.py faz match por substring e cai para
 * `ytGenreAlts` (por ordem) — e, em último recurso, para charts.
 *
 * Janela: [inicio, fim) em horas locais de Lisboa. A música toca 24/7 na sua
 * janela; a madrugada (23–07) é coberta à parte pelo deployer da programação.
 *
 * `windows` (opcional): lista de [inicioHHMM, fimHHMM] quando a janela NÃO é um
 * bloco contíguo de horas inteiras — ex.: um programa modular curto (Tuga
 * Underground 12:00–12:30) obriga o programa anfitrião a ceder essa meia-hora,
 * ficando com duas janelas. Sem `windows`, assume-se [[hhmm(inicio), hhmm(fim)]].
 */
export const PROGRAMS = [
  {
    dir: "BootMatinal_DiogoSilva", nome: "Boot Matinal", locutor: "Diogo Silva", slug: "diogo_silva",
    genero: "rock", inicio: 7, fim: 10,
    ytGenre: "Feel Good", ytGenreAlts: ["Pop", "Energy Boosters", "Commute"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: false,
  },
  {
    dir: "CtrlAltRitmo_SofiaMartins", nome: "Ctrl+Alt+Ritmo", locutor: "Sofia Martins", slug: "sofia_martins",
    genero: "rock", inicio: 10, fim: 13,
    // cede 12:00–12:30 ao Tuga Underground → duas janelas
    windows: [[1000, 1200], [1230, 1300]],
    ytGenre: "Dance & Electronic", ytGenreAlts: ["Electronic", "Dance", "Party"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "TugaUnderground", nome: "Tuga Underground", locutor: "Sofia Martins", slug: "tuga_underground",
    genero: "hiphop", inicio: 12, fim: 13,
    // programa modular curto — meia-hora entalada na janela do sofia_martins
    windows: [[1200, 1230]],
    ytGenre: "Rap Tuga Underground",
    ytGenreAlts: ["Hip Hop Tuga Underground", "Rap Português Underground", "Boom Bap Português", "Hip Hop Tuga"],
    poolSize: 10, poolCap: 30, minDur: 120, maxDur: 360,
    djMode: false,
  },
  {
    dir: "Pause&Play_TomasRocha", nome: "Pause & Play", locutor: "Tomás Rocha", slug: "tomas_rocha",
    genero: "house", inicio: 13, fim: 16,
    ytGenre: "Indie & Alternative", ytGenreAlts: ["Chill", "Indie", "Focus"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: false,
  },
  {
    dir: "HoraDePonta_BeatrizLima", nome: "Hora de Ponta", locutor: "Beatriz Lima", slug: "beatriz_lima",
    genero: "house", inicio: 16, fim: 20,
    ytGenre: "Hip-Hop", ytGenreAlts: ["Hip Hop", "Party", "Energy Boosters"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "ModoNoturno_GoncaloPires", nome: "Modo Noturno", locutor: "Gonçalo Pires", slug: "goncalo_pires",
    genero: "house", inicio: 20, fim: 23,
    ytGenre: "R&B & Soul", ytGenreAlts: ["Chill", "Sleep", "R&B"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
];

/** Teto por omissão da pool no ar (faixas), quando o programa não define `poolCap`. */
export const DEFAULT_POOL_CAP = 60;

/** Programa por slug (ou undefined). */
export const programBySlug = (slug) => PROGRAMS.find((p) => p.slug === slug);

/** Teto da pool no ar do programa (faixas a manter; as mais antigas saem). */
export const programPoolCap = (p) => p.poolCap ?? DEFAULT_POOL_CAP;

/** Janela HHMM (ex.: 7 → 700, 20 → 2000) para schedule_items. */
export const hhmm = (hour) => hour * 100;

/**
 * Janelas de agendamento do programa como lista de [inicioHHMM, fimHHMM].
 * Usa `windows` se existir (programas com janela partida); senão deriva o bloco
 * contíguo [hhmm(inicio), hhmm(fim)]. Fonte única para schedule_items + colisões.
 */
export const programWindows = (p) => p.windows ?? [[hhmm(p.inicio), hhmm(p.fim)]];
