// Dados dos PROGRAMAS (grelha / grelha de programação). SEAM de ligação —
// LIGADO aos dados reais (overlay sobre o MOCK: pool.atual do manifest,
// playlistEnabled/estado das playlists do AzuraCast, proximaEntrada e kpis.proximo
// da grelha; segmentos/jingle/diasSemana ficam estáticos). Contrato e MOCK ficam
// FIXOS. Reflete a grelha REAL da IT.FM (Boot Matinal,
// Ctrl+Alt+Ritmo, Tuga Underground, Pause & Play, Hora de Ponta, Modo Noturno).
// Os mocks do painel.ts / live.ts / locutores.ts já estão alinhados a esta
// grelha — todos os ecrãs (e a barra global "Em direto") concordam.
//
// Fontes reais previstas (todos os caminhos são relativos a apps/station):
//   programas[].{slug,dir,nome,locutor,genero,janelas,pool.*}
//     → lib/programs.mjs — FONTE ÚNICA: PROGRAMS[] (slug, dir, nome, locutor,
//       genero, inicio/fim, windows, ytGenre/ytGenreAlts, poolSize, poolCap,
//       minDur, maxDur) + programWindows(p), hhmm(h), programBySlug(slug),
//       programPoolCap(p), DEFAULT_POOL_CAP=60. `poolSize` = faixas NOVAS por
//       refresh; `poolCap` = teto no ar (o deploy retira as mais antigas acima
//       do teto → rotação, não crescimento). `windows` = janela partida.
//   janelas, diasSemana, estado "pausado", playlistEnabled
//     → lib/azuracast.mjs — GET /station/{sid}/playlists → playlist.schedule_items
//       ([start_time,end_time,days]); sched() com days:[] = TODOS os dias (hoje
//       Seg–Dom, sem variação por dia — o campo fica para poder diferir depois);
//       getPlaylists, findByName, updatePlaylist(is_enabled) → is_enabled:false = pausado.
//   madrugada, mapping programa→playlist
//     → deploy-programacao.mjs — mapeia cada programa → playlist + schedule_items
//       por ordem (+ restart); bootstrap/WIPE da grelha; cobre a madrugada como
//       rotação geral (nextsong-mode agendado FORA do horário diurno).
//   segmentos tipo "noticias" + cadência
//     → news-live.mjs — GEN_HOURS [7,10,13,16,19,22] (launchd :05), AIR_MINUTE 30
//       + AIR_HOURS 7..22 + AIR_WINDOWS → playlist "Notícias (live)" (single_track)
//       ao :30 de hora a hora 07:30–22:30; vozes Ruben Mateus + Mariana Serrano.
//   segmentos meteo/transito por janela + topo da hora 19:00
//     → liquidsoap/segments_mix.liq — grelha :30 (transito h∈[7,9], meteo
//       h∈[8,11,15], senão noticias), news_top_of_hour(19), music_vol 0.5 (ducking).
//   pool.atual e derivação de estado/kpis.proximo
//     → musica/<slug>/ + manifest.json (ficheiros da pool) e
//       GET /api/nowplaying/{shortcode} (programa/locutor no ar + próximo).
//
// `estado` é DERIVADO, não guardado: janela contém "agora" (Lisboa) → "no_ar";
// senão "agendado"; "pausado" = playlist is_enabled:false no AzuraCast.
// NB: as janelas são horas de Lisboa (host/container em UTC → converter na
// ligação real). NUNCA gerir segredos/.env aqui.

import { getMusicManifest, getPlaylists, findPlaylistByName, lisbonNow } from "./azuracast-read";
import { programaAt, proximoArranque, fimJanelaAt, hhmmToClock, GRELHA } from "./grelha";

export type ProgramaEstado = "no_ar" | "agendado" | "pausado";
export type Janela = { inicio: string; fim: string }; // "07:00","10:00" Lisboa
export type SegTipo = "noticias" | "meteo" | "transito";
export type Segmento = { tipo: SegTipo; cadencia: string; fonte: string };

export type Pool = {
  playlist: string; // nome da playlist AzuraCast
  dir: string; // "musica/diogo_silva/"
  ytGenre: string;
  ytGenreAlts: string[];
  poolSize: number; // faixas novas por refresh (20)
  poolCap: number; // teto no ar (60)
  atual: number; // faixas atualmente na pool (54)
  minDur: number; // segundos (120)
  maxDur: number; // segundos (360)
  loudness: string; // "-16 LUFS"
};

export type Programa = {
  slug: string;
  dir: string;
  nome: string;
  locutor: string;
  genero: string;
  estado: ProgramaEstado;
  janelas: Janela[];
  diasSemana: string[]; // ["Seg".."Dom"] (days:[] → todos)
  pool: Pool;
  segmentos: Segmento[];
  jingle: { id: string; fonte: string };
  proximaEntrada: string; // "amanhã 07:00" | "no ar até 16:00" | "em 1h23"
  playlistEnabled: boolean;
};

export type Madrugada = {
  nome: string;
  janelas: Janela[];
  fonte: string;
  nota: string;
};

export type ProgramasData = {
  agora: string; // "14:37" Lisboa — âncora determinística da derivação de estado
  kpis: {
    totalProgramas: number; // 6 (+ madrugada)
    horasLocutor: number; // 16
    horasRotacao: number; // 8
    totalHoras: number; // 24
    locutoresAtivos: number; // 5 (Sofia Martins tem 2 shows)
    proximo: { nome: string; hora: string; emMin: number }; // "Hora de Ponta","16:00",83
  };
  programas: Programa[];
  madrugada: Madrugada;
};

const DIAS_TODOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const MOCK: ProgramasData = {
  agora: "14:37",
  kpis: {
    totalProgramas: 6,
    horasLocutor: 16,
    horasRotacao: 8,
    totalHoras: 24,
    locutoresAtivos: 5,
    proximo: { nome: "Hora de Ponta", hora: "16:00", emMin: 83 },
  },
  programas: [
    {
      slug: "diogo_silva",
      dir: "BootMatinal_DiogoSilva",
      nome: "Boot Matinal",
      locutor: "Diogo Silva",
      genero: "rock",
      estado: "agendado",
      janelas: [{ inicio: "07:00", fim: "10:00" }],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Boot Matinal",
        dir: "musica/diogo_silva/",
        ytGenre: "Feel Good",
        ytGenreAlts: ["Pop", "Energy Boosters", "Commute"],
        poolSize: 20,
        poolCap: 60,
        atual: 57,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [
        { tipo: "transito", cadencia: ":30 · 07:30 e 09:30", fonte: "segments_mix.liq" },
        { tipo: "meteo", cadencia: ":30 · 08:30", fonte: "segments_mix.liq" },
        { tipo: "noticias", cadencia: ":30 horário (07:30–09:30)", fonte: "Notícias (live)" },
      ],
      jingle: { id: "ID — Boot Matinal", fonte: "carts/id_boot_matinal.mp3" },
      proximaEntrada: "amanhã 07:00",
      playlistEnabled: true,
    },
    {
      slug: "sofia_martins",
      dir: "CtrlAltRitmo_SofiaMartins",
      nome: "Ctrl+Alt+Ritmo",
      locutor: "Sofia Martins",
      genero: "rock",
      estado: "agendado",
      // cede 12:00–12:30 ao Tuga Underground → janela partida
      janelas: [
        { inicio: "10:00", fim: "12:00" },
        { inicio: "12:30", fim: "13:00" },
      ],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Ctrl+Alt+Ritmo",
        dir: "musica/sofia_martins/",
        ytGenre: "Dance & Electronic",
        ytGenreAlts: ["Electronic", "Dance", "Party"],
        poolSize: 20,
        poolCap: 60,
        atual: 60,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [
        { tipo: "meteo", cadencia: ":30 · 11:30", fonte: "segments_mix.liq" },
        { tipo: "noticias", cadencia: ":30 horário (10:30–12:30)", fonte: "Notícias (live)" },
      ],
      jingle: { id: "ID — Ctrl+Alt+Ritmo", fonte: "carts/id_ctrl_alt_ritmo.mp3" },
      proximaEntrada: "amanhã 10:00",
      playlistEnabled: true,
    },
    {
      slug: "tuga_underground",
      dir: "TugaUnderground",
      nome: "Tuga Underground",
      locutor: "Sofia Martins",
      genero: "hiphop",
      // exemplo de "pausado" (playlist is_enabled:false) para demonstrar o 3.º tom
      estado: "pausado",
      // programa modular curto — meia-hora entalada na janela do sofia_martins
      janelas: [{ inicio: "12:00", fim: "12:30" }],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Tuga Underground",
        dir: "musica/tuga_underground/",
        ytGenre: "Rap Tuga Underground",
        ytGenreAlts: [
          "Hip Hop Tuga Underground",
          "Rap Português Underground",
          "Boom Bap Português",
          "Hip Hop Tuga",
        ],
        poolSize: 10,
        poolCap: 30,
        atual: 27,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [],
      jingle: { id: "ID — Tuga Underground", fonte: "carts/id_tuga_underground.mp3" },
      proximaEntrada: "pausado — não vai ao ar",
      playlistEnabled: false,
    },
    {
      slug: "tomas_rocha",
      dir: "Pause&Play_TomasRocha",
      nome: "Pause & Play",
      locutor: "Tomás Rocha",
      genero: "house",
      estado: "no_ar",
      janelas: [{ inicio: "13:00", fim: "16:00" }],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Pause & Play",
        dir: "musica/tomas_rocha/",
        ytGenre: "Indie & Alternative",
        ytGenreAlts: ["Chill", "Indie", "Focus"],
        poolSize: 20,
        poolCap: 60,
        atual: 55,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [
        { tipo: "meteo", cadencia: ":30 · 15:30", fonte: "segments_mix.liq" },
        { tipo: "noticias", cadencia: ":30 horário (13:30–15:30)", fonte: "Notícias (live)" },
      ],
      jingle: { id: "ID — Pause & Play", fonte: "carts/id_pause_play.mp3" },
      proximaEntrada: "no ar até 16:00",
      playlistEnabled: true,
    },
    {
      slug: "beatriz_lima",
      dir: "HoraDePonta_BeatrizLima",
      nome: "Hora de Ponta",
      locutor: "Beatriz Lima",
      genero: "house",
      estado: "agendado",
      janelas: [{ inicio: "16:00", fim: "20:00" }],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Hora de Ponta",
        dir: "musica/beatriz_lima/",
        ytGenre: "Hip-Hop",
        ytGenreAlts: ["Hip Hop", "Party", "Energy Boosters"],
        poolSize: 20,
        poolCap: 60,
        atual: 58,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [
        { tipo: "noticias", cadencia: ":30 horário (16:30–19:30)", fonte: "Notícias (live)" },
        { tipo: "noticias", cadencia: "topo da hora · 19:00 (self-bed, sem jingle)", fonte: "segments_mix.liq" },
      ],
      jingle: { id: "ID — Hora de Ponta", fonte: "carts/id_hora_de_ponta.mp3" },
      proximaEntrada: "em 1h23",
      playlistEnabled: true,
    },
    {
      slug: "goncalo_pires",
      dir: "ModoNoturno_GoncaloPires",
      nome: "Modo Noturno",
      locutor: "Gonçalo Pires",
      genero: "house",
      estado: "agendado",
      janelas: [{ inicio: "20:00", fim: "23:00" }],
      diasSemana: DIAS_TODOS,
      pool: {
        playlist: "Música Modo Noturno",
        dir: "musica/goncalo_pires/",
        ytGenre: "R&B & Soul",
        ytGenreAlts: ["Chill", "Sleep", "R&B"],
        poolSize: 20,
        poolCap: 60,
        atual: 31,
        minDur: 120,
        maxDur: 360,
        loudness: "-16 LUFS",
      },
      segmentos: [
        { tipo: "noticias", cadencia: ":30 · 20:30 / 21:30 / 22:30", fonte: "Notícias (live)" },
      ],
      jingle: { id: "ID — Modo Noturno", fonte: "carts/id_modo_noturno.mp3" },
      proximaEntrada: "hoje 20:00",
      playlistEnabled: true,
    },
  ],
  madrugada: {
    nome: "Madrugada · Rotação geral",
    janelas: [{ inicio: "23:00", fim: "07:00" }],
    fonte: "deploy-programacao.mjs / rotação geral (nextsong)",
    nota: "sem locutor — rotação automática fora do horário diurno",
  },
};

// HHMM inteiro (700) → minutos do dia (420). Puro, sem I/O.
const hhmmToMin = (hhmm: number): number => Math.floor(hhmm / 100) * 60 + (hhmm % 100);

// "proximaEntrada" DERIVADA do estado + grelha (sempre disponível, sem I/O):
//   pausado  → não vai ao ar; no_ar → até ao fim da janela atual; agendado →
//   PRÓXIMO arranque DESTE programa. Para janela partida (Sofia: 10–12 + 12:30–13)
//   escolhe a próxima janela ainda por arrancar HOJE; se já passaram todas hoje,
//   a mais cedo de AMANHÃ. (Sem isto, no intervalo 12:00–12:30 a Sofia mostrava
//   "amanhã 10:00" quando na verdade volta ao ar hoje às 12:30.)
function proximaEntradaDe(estado: ProgramaEstado, slug: string, hhmm: number): string {
  if (estado === "pausado") return "pausado — não vai ao ar";
  if (estado === "no_ar") return `no ar até ${fimJanelaAt(hhmm)}`;
  // agendado — próxima janela por arrancar hoje (a mais cedo depois de agora), ou
  // então a janela mais cedo do dia para amanhã.
  const windows = GRELHA.find((p) => p.slug === slug)?.windows;
  if (!windows || windows.length === 0) return "agendado"; // defensivo: slug sem grelha
  const maisCedo = windows.reduce((a, b) => (b.inicioHHMM < a.inicioHHMM ? b : a));
  const hojeAinda = windows
    .filter((win) => win.inicioHHMM > hhmm)
    .sort((a, b) => a.inicioHHMM - b.inicioHHMM)[0];
  return hojeAinda ? `hoje ${hojeAinda.inicio}` : `amanhã ${maisCedo.inicio}`;
}

export async function getProgramasData(): Promise<ProgramasData> {
  // Âncora de Lisboa (servidor) — deriva estado / proximaEntrada / kpis.proximo.
  const clock = lisbonNow();

  // Leituras reais em paralelo (memoizadas por render em azuracast-read):
  //   manifest  → build-music/manifest.json (nº de faixas na pool por slug)
  //   playlists → GET /station/{id}/playlists (is_enabled → estado "pausado")
  const [manifest, playlists] = await Promise.all([getMusicManifest(), getPlaylists()]);

  // ── kpis — contadores estáticos do MOCK; só `proximo` é dinâmico (grelha).
  const nx = proximoArranque(clock.hhmm);
  let emMin = hhmmToMin(nx.inicioHHMM) - clock.minutesOfDay;
  if (nx.inicioHHMM <= clock.hhmm) emMin += 1440; // arranque já passou hoje → amanhã
  const kpis: ProgramasData["kpis"] = {
    totalProgramas: MOCK.kpis.totalProgramas,
    horasLocutor: MOCK.kpis.horasLocutor,
    horasRotacao: MOCK.kpis.horasRotacao,
    totalHoras: MOCK.kpis.totalHoras,
    locutoresAtivos: MOCK.kpis.locutoresAtivos,
    proximo: { nome: nx.programa.nome, hora: hhmmToClock(nx.inicioHHMM), emMin },
  };

  // ── Overlay por programa: parte do conteúdo ESTÁTICO do MOCK (segmentos,
  // jingle, diasSemana, metadados da pool) e sobrepõe só os campos dinâmicos.
  const programas: Programa[] = MOCK.programas.map((p) => {
    // pool — só `atual` muda (nº de faixas do manifest p/ o slug); real-a-zero
    // honesto quando o manifest existe mas o programa não tem faixas na pool.
    const atual = manifest ? (manifest.music?.[p.slug]?.length ?? 0) : p.pool.atual;
    const pool: Pool = { ...p.pool, atual };

    // playlistEnabled — is_enabled da playlist AzuraCast. Sem lista → degrada ao
    // mock; sem correspondência de nome → degrada ao mock (não inventa true).
    let playlistEnabled = p.playlistEnabled;
    if (playlists !== null) {
      const pl = findPlaylistByName(playlists, p.pool.playlist);
      playlistEnabled = pl ? (pl.is_enabled ?? true) : p.playlistEnabled;
    }

    // estado — DERIVADO: sem playlists → mock (preserva o demo "pausado");
    // senão pausado > no ar (grelha em Lisboa) > agendado.
    let estado: ProgramaEstado;
    if (playlists === null) {
      estado = p.estado;
    } else if (!playlistEnabled) {
      estado = "pausado";
    } else if (programaAt(clock.hhmm)?.slug === p.slug) {
      estado = "no_ar";
    } else {
      estado = "agendado";
    }

    return {
      ...p,
      pool,
      playlistEnabled,
      estado,
      proximaEntrada: proximaEntradaDe(estado, p.slug, clock.hhmm),
    };
  });

  return {
    agora: clock.clock,
    kpis,
    programas,
    madrugada: MOCK.madrugada,
  };
}
