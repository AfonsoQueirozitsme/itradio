// Grelha canónica da IT.FM — ESPELHO de apps/station/lib/programs.mjs (a FONTE
// ÚNICA no serviço de música). Vive aqui, no landing, porque importar um .mjs de
// outro workspace em runtime/build do Next é frágil (o deploy só faz checkout do
// apps/landing); e porque consolida a grelha que hoje está DUPLICADA em cada mock
// (painel/live/programas/segmentos/musica/locutores). Só dados estáticos da
// grelha — nomes, locutores, janelas (Lisboa), géneros, tetos de pool. Não muda
// quase nunca; se mudar em programs.mjs, atualizar aqui e redeploy (igual ao que
// os mocks já exigiam). As partes DINÂMICAS (faixas, ouvintes, estado no ar) vêm
// das leituras reais em azuracast-read.ts — nunca daqui.

export type GrelhaWindow = { inicioHHMM: number; fimHHMM: number; inicio: string; fim: string };

export type GrelhaPrograma = {
  slug: string;
  dir: string;
  nome: string;
  locutor: string;
  genero: string; // género interno de programs.mjs (rock/house/hiphop)
  ytGenre: string; // rótulo de trending (ytGenre)
  ytGenreAlts: string[];
  poolSize: number; // faixas novas por refresh
  poolCap: number; // teto no ar
  minDur: number;
  maxDur: number;
  windows: GrelhaWindow[]; // janelas de Lisboa (partida → mais do que uma)
  janelaLabel: string; // "07:00–10:00" | "10:00–12:00 + 12:30–13:00"
};

const w = (inicioHHMM: number, fimHHMM: number): GrelhaWindow => ({
  inicioHHMM,
  fimHHMM,
  inicio: hhmmToClock(inicioHHMM),
  fim: hhmmToClock(fimHHMM),
});

export function hhmmToClock(hhmm: number): string {
  const h = Math.floor(hhmm / 100);
  const m = hhmm % 100;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// Os 6 programas, por ordem de janela (igual a PROGRAMS em programs.mjs).
export const GRELHA: GrelhaPrograma[] = [
  {
    slug: "diogo_silva",
    dir: "BootMatinal_DiogoSilva",
    nome: "Boot Matinal",
    locutor: "Diogo Silva",
    genero: "rock",
    ytGenre: "Feel Good",
    ytGenreAlts: ["Pop", "Energy Boosters", "Commute"],
    poolSize: 20,
    poolCap: 60,
    minDur: 120,
    maxDur: 360,
    windows: [w(700, 1000)],
    janelaLabel: "07:00–10:00",
  },
  {
    slug: "sofia_martins",
    dir: "CtrlAltRitmo_SofiaMartins",
    nome: "Ctrl+Alt+Ritmo",
    locutor: "Sofia Martins",
    genero: "rock",
    ytGenre: "Dance & Electronic",
    ytGenreAlts: ["Electronic", "Dance", "Party"],
    poolSize: 20,
    poolCap: 60,
    minDur: 120,
    maxDur: 360,
    // cede 12:00–12:30 ao Tuga Underground → janela partida
    windows: [w(1000, 1200), w(1230, 1300)],
    janelaLabel: "10:00–12:00 + 12:30–13:00",
  },
  {
    slug: "tuga_underground",
    dir: "TugaUnderground",
    nome: "Tuga Underground",
    locutor: "Sofia Martins",
    genero: "hiphop",
    ytGenre: "Rap Tuga Underground",
    ytGenreAlts: [
      "Hip Hop Tuga Underground",
      "Rap Português Underground",
      "Boom Bap Português",
      "Hip Hop Tuga",
    ],
    poolSize: 10,
    poolCap: 30,
    minDur: 120,
    maxDur: 360,
    windows: [w(1200, 1230)],
    janelaLabel: "12:00–12:30",
  },
  {
    slug: "tomas_rocha",
    dir: "Pause&Play_TomasRocha",
    nome: "Pause & Play",
    locutor: "Tomás Rocha",
    genero: "house",
    ytGenre: "Indie & Alternative",
    ytGenreAlts: ["Chill", "Indie", "Focus"],
    poolSize: 20,
    poolCap: 60,
    minDur: 120,
    maxDur: 360,
    windows: [w(1300, 1600)],
    janelaLabel: "13:00–16:00",
  },
  {
    slug: "beatriz_lima",
    dir: "HoraDePonta_BeatrizLima",
    nome: "Hora de Ponta",
    locutor: "Beatriz Lima",
    genero: "house",
    ytGenre: "Hip-Hop",
    ytGenreAlts: ["Hip Hop", "Party", "Energy Boosters"],
    poolSize: 20,
    poolCap: 60,
    minDur: 120,
    maxDur: 360,
    windows: [w(1600, 2000)],
    janelaLabel: "16:00–20:00",
  },
  {
    slug: "goncalo_pires",
    dir: "ModoNoturno_GoncaloPires",
    nome: "Modo Noturno",
    locutor: "Gonçalo Pires",
    genero: "house",
    ytGenre: "R&B & Soul",
    ytGenreAlts: ["Chill", "Sleep", "R&B"],
    poolSize: 20,
    poolCap: 60,
    minDur: 120,
    maxDur: 360,
    windows: [w(2000, 2300)],
    janelaLabel: "20:00–23:00",
  },
];

// Madrugada = rotação geral (23:00–07:00, sem locutor).
export const MADRUGADA = {
  nome: "Madrugada · Rotação geral",
  inicioHHMM: 2300,
  fimHHMM: 700,
  inicio: "23:00",
  fim: "07:00",
} as const;

// Programa da grelha OU o bloco de madrugada (o retorno de proximoArranque).
export type GrelhaProgramaOuMadrugada = GrelhaPrograma | typeof MADRUGADA;

export const programaBySlug = (slug: string): GrelhaPrograma | undefined =>
  GRELHA.find((p) => p.slug === slug);

// Uma janela contém `hhmm`? (semiaberto [inicio, fim); trata a passagem por
// meia-noite para a madrugada). start<end → normal; start>end → wrap.
function windowContains(inicioHHMM: number, fimHHMM: number, hhmm: number): boolean {
  return inicioHHMM <= fimHHMM
    ? hhmm >= inicioHHMM && hhmm < fimHHMM
    : hhmm >= inicioHHMM || hhmm < fimHHMM;
}

// Programa no ar a `hhmm` (Lisboa). null quando é madrugada (rotação geral).
export function programaAt(hhmm: number): GrelhaPrograma | null {
  for (const p of GRELHA) {
    if (p.windows.some((win) => windowContains(win.inicioHHMM, win.fimHHMM, hhmm))) return p;
  }
  return null;
}

export function isMadrugada(hhmm: number): boolean {
  return windowContains(MADRUGADA.inicioHHMM, MADRUGADA.fimHHMM, hhmm);
}

// Quem está NO AR a `hhmm` (Lisboa), derivado só da grelha estática — sempre
// disponível, nunca depende de I/O. Partilhado por painel.noAr e live.now (para
// concordarem sempre). Na madrugada não há locutor (rotação geral).
export type NoAr = { programa: string; locutor: string; genero: string; ate: string };

export function noArAgora(hhmm: number): NoAr {
  const p = programaAt(hhmm);
  if (!p) {
    return { programa: MADRUGADA.nome, locutor: "—", genero: "Rotação geral", ate: MADRUGADA.fim };
  }
  return { programa: p.nome, locutor: p.locutor, genero: p.ytGenre, ate: fimJanelaAt(hhmm) };
}

// Fim da janela do programa que contém `hhmm` ("16:00"). Para madrugada → "07:00".
export function fimJanelaAt(hhmm: number): string {
  const p = programaAt(hhmm);
  if (!p) return MADRUGADA.fim;
  const win = p.windows.find((win) => windowContains(win.inicioHHMM, win.fimHHMM, hhmm));
  return win ? win.fim : p.windows[0].fim;
}

// Próximo ARRANQUE de programa depois de `hhmm` (dá a volta ao dia). Devolve o
// programa e a hora de início em HHMM/clock — para kpis.proximo e "próximo".
export function proximoArranque(hhmm: number): { programa: GrelhaProgramaOuMadrugada; inicioHHMM: number } {
  // todos os arranques do dia (início de cada janela) + a madrugada às 23:00
  const arranques: { programa: GrelhaProgramaOuMadrugada; inicioHHMM: number }[] = [];
  for (const p of GRELHA) {
    for (const win of p.windows) arranques.push({ programa: p, inicioHHMM: win.inicioHHMM });
  }
  arranques.push({ programa: MADRUGADA, inicioHHMM: MADRUGADA.inicioHHMM });
  arranques.sort((a, b) => a.inicioHHMM - b.inicioHHMM);
  // o primeiro arranque estritamente depois de agora…
  const next = arranques.find((a) => a.inicioHHMM > hhmm);
  // …ou, se já passámos todos hoje, o primeiro de amanhã (dá a volta).
  return next ?? arranques[0];
}
