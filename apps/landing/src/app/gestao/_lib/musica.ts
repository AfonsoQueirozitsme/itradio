// Dados de "Música & estilos". SEAM de ligação — LIGADO aos dados reais (overlay
// sobre POOLS/MOCK: nº de faixas e tracks do manifest, recência da rotação, KPIs
// e próximo rebuild; refreshHistory fica MOCK até à Fase B). Contrato e MOCK ficam
// FIXOS. Cada programa
// tem UMA pool de música (playlist AzuraCast "Música <nome>", Standard, shuffle,
// NÃO-interrupt) que substitui a rotação geral apenas dentro da sua janela de
// Lisboa. Fontes reais previstas (ver mapa do apps/station):
//   pools/kpis (base)   → apps/station/lib/programs.mjs (PROGRAMS): slug, nome,
//                         locutor, inicio/fim + windows (janelas Lisboa; o
//                         Ctrl+Alt+Ritmo é partida e cede 12:00–12:30 ao Tuga),
//                         ytGenre/ytGenreAlts, poolSize, poolCap (DEFAULT 60),
//                         minDur/maxDur; helpers programWindows()/programPoolCap().
//   faixas/estado/tracks→ apps/station/build-music/manifest.json (music[slug] =
//                         paths musica/<slug>/<videoId>.mp3; tracks[path] =
//                         {videoId,title,artist,dur,slug}; updatedAt) e
//                         apps/station/music/.rotation.json ({slug:{videoId:
//                         {title,artist,at,path}}}, HISTORY_KEEP 240) → recência.
//   noAr/estadoJanela   → GET /api/nowplaying/{shortcode} (que pool está no ar) +
//                         GET /station/{sid}/playlists (schedule_items = janelas).
//   pipeline/encode     → music-build.mjs (select_tracks → yt-dlp bestaudio →
//                         normalizeMusicToMp3 → MP3 192k @ -16 LUFS; oversample) e
//                         select_tracks.py (ytmusicapi sem auth: search playlists).
//   deploy/rotação      → music-deploy.mjs (playlist "Música <nome>", rotação com
//                         teto: apaga as mais antigas sob musica/<slug>/, cascata;
//                         restart SÓ se criar playlist nova).
//   próximo rebuild     → daily-refresh.mjs (systemd timer itfm-music-daily,
//                         OnCalendar 05:00 Europe/Lisbon; 6 programas EM SÉRIE).
//   botão "Reconstruir" → jobKeys "music-build"/"music-deploy" já existentes em
//                         _lib/jobs.ts (a ação aponta conceptualmente para Jobs).
// NB: todas as horas/datas são de Lisboa (host/container em UTC → converter na
// ligação). Regra de agendamento: nextsong-mode → a rotação geral tem de estar
// agendada FORA do daytime; a madrugada 23:00–07:00 é coberta pelo deployer da
// programação. NUNCA gerir segredos/.env aqui.

import {
  getMusicManifest,
  getRotationState,
  lisbonNow,
  toLisbonStamp,
  relativeFromNow,
  proximaOcorrenciaDiariaStamp,
} from "./azuracast-read";
import { programaAt } from "./grelha";

export type TrackEstado = "normalizado" | "pendente" | "falhou";
export type EstadoJanela = "em-janela" | "fora-janela";
export type RefreshEstado = "ok" | "parcial" | "falhou";

export type Track = {
  videoId: string; // 11 chars YouTube — é o nome do ficheiro
  artista: string;
  titulo: string;
  duracao: number; // segundos
  duracaoLabel: string; // "mm:ss"
  lufs: string; // "−16.0 LUFS"
  fonte: string; // "yt-dlp · bestaudio" / "ytmusicapi → yt-dlp"
  estado: TrackEstado;
  path: string; // "musica/<slug>/<videoId>.mp3"
  addedAt: string; // ISO (UTC) do .rotation.json
  addedAtLabel: string; // Lisboa "2026-09-19 00:05"
};

export type Pool = {
  slug: string;
  nome: string;
  locutor: string;
  playlist: string; // "Música <nome>" (nome exato da playlist AzuraCast)
  genero: string; // ytGenre
  generoAlts: string[]; // ytGenreAlts
  janela: string; // "07:00–10:00" (legível)
  windows: [string, string][]; // janelas Lisboa (partida → mais do que uma)
  faixas: number; // value da PoolBar
  cap: number; // poolCap / teto
  poolSize: number; // faixas NOVAS por refresh
  minDur: number; // segundos
  maxDur: number; // segundos
  durLabel: string; // "2:00–6:00"
  lufs: string; // "−16 LUFS"
  estadoJanela: EstadoJanela; // vs "agora" determinístico (14:20 Lisboa)
  noAr: boolean; // true = pool a substituir a rotação geral agora
  ultimaAtualizacao: string; // Lisboa (do `at` mais recente do slug)
  tracks: Track[];
};

export type MusicaKpis = {
  faixasTotais: number;
  pools: number;
  lufsAlvo: string; // "−16 LUFS"
  encode: string; // "MP3 192k"
  ultimaAtualizacao: string; // "2026-09-19 00:28" (manifest.updatedAt → Lisboa)
  ultimaAtualizacaoRel?: string; // "há 20 h"
  proximoRebuild: string; // "2026-09-20 05:00"
  proximoRebuildFonte: string; // "systemd · itfm-music-daily (05:00 Lisboa, diário)"
};

export type RefreshDia = {
  dia: string; // "19/09"
  faixasNovas: number;
  duracao: string; // "1h58"
  estado: RefreshEstado;
};

export type MusicaData = {
  kpis: MusicaKpis;
  pools: Pool[]; // os 6, ordenados por início de janela
  refreshHistory: RefreshDia[]; // últimas 7 execuções diárias
};

// ── Fábrica de faixas (mantém duracaoLabel/path coerentes) ───────────────────
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function tk(
  slug: string,
  videoId: string,
  artista: string,
  titulo: string,
  duracao: number,
  addedAt: string,
  addedAtLabel: string,
  estado: TrackEstado = "normalizado",
  fonte = "yt-dlp · bestaudio",
): Track {
  return {
    videoId,
    artista,
    titulo,
    duracao,
    duracaoLabel: fmt(duracao),
    lufs: "−16.0 LUFS",
    fonte,
    estado,
    path: `musica/${slug}/${videoId}.mp3`,
    addedAt,
    addedAtLabel,
  };
}

// ── Pools (6, por ordem de janela) ───────────────────────────────────────────
// "agora" determinístico = 14:20 Lisboa → só o "Pause & Play" (13:00–16:00) está
// em janela/no ar; os restantes fora. (Evita mismatch de hidratação.)
const POOLS: Pool[] = [
  {
    slug: "diogo_silva",
    nome: "Boot Matinal",
    locutor: "Diogo Silva",
    playlist: "Música Boot Matinal",
    genero: "Feel Good",
    generoAlts: ["Pop", "Energy Boosters", "Commute"],
    janela: "07:00–10:00",
    windows: [["07:00", "10:00"]],
    faixas: 38,
    cap: 60,
    poolSize: 20,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "fora-janela",
    noAr: false,
    ultimaAtualizacao: "2026-09-19 00:06",
    tracks: [
      tk("diogo_silva", "hqp3Ftq7bZ0", "Pharrell Williams", "Happy", 233, "2026-09-18T23:05:41Z", "2026-09-19 00:05"),
      tk("diogo_silva", "OPf0YbXq9m4", "Mark Ronson (feat. Bruno Mars)", "Uptown Funk", 270, "2026-09-18T23:05:12Z", "2026-09-19 00:05"),
      tk("diogo_silva", "ru0K8uYE2Ww", "Justin Timberlake", "Can't Stop the Feeling!", 236, "2026-09-17T23:07:02Z", "2026-09-18 00:07"),
      tk("diogo_silva", "TUVcZfQe1Kw", "Dua Lipa", "Levitating", 203, "2026-09-16T23:06:33Z", "2026-09-17 00:06"),
      tk("diogo_silva", "iPUmE7tne5U", "Katrina & The Waves", "Walking on Sunshine", 238, "2026-09-15T23:05:20Z", "2026-09-16 00:05"),
      tk("diogo_silva", "Gs069dnd8Yk", "Earth, Wind & Fire", "September", 215, "2026-09-14T23:05:50Z", "2026-09-15 00:05"),
      tk("diogo_silva", "e-fAgB4Ckj0", "OneRepublic", "I Ain't Worried", 148, "2026-09-13T23:04:10Z", "2026-09-14 00:04"),
    ],
  },
  {
    slug: "sofia_martins",
    nome: "Ctrl+Alt+Ritmo",
    locutor: "Sofia Martins",
    playlist: "Música Ctrl+Alt+Ritmo",
    genero: "Dance & Electronic",
    generoAlts: ["Electronic", "Dance", "Party"],
    janela: "10:00–12:00 + 12:30–13:00",
    windows: [["10:00", "12:00"], ["12:30", "13:00"]],
    faixas: 37,
    cap: 60,
    poolSize: 20,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "fora-janela",
    noAr: false,
    ultimaAtualizacao: "2026-09-19 00:11",
    tracks: [
      tk("sofia_martins", "Fr3dAg1nDlh", "Fred again..", "Delilah (pull me out of this)", 214, "2026-09-18T23:11:02Z", "2026-09-19 00:11", "falhou", "ytmusicapi → yt-dlp"),
      tk("sofia_martins", "Vp5s1t8mQ2A", "Poppy Baskcomb, Pete Tong, Armin van Buuren", "Toca's Miracle (Extended Mix)", 342, "2026-09-18T23:10:41Z", "2026-09-19 00:10"),
      tk("sofia_martins", "LrQ9d2xk7Pe", "FISHER", "Losing It", 356, "2026-09-18T23:10:02Z", "2026-09-19 00:10"),
      tk("sofia_martins", "9zXcQ1abD4k", "Swedish House Mafia (feat. John Martin)", "Don't You Worry Child", 212, "2026-09-17T23:09:15Z", "2026-09-18 00:09"),
      tk("sofia_martins", "kM3nP0vTb2s", "Calvin Harris", "Summer", 222, "2026-09-16T23:08:30Z", "2026-09-17 00:08"),
      tk("sofia_martins", "aVi2LxE9nQ8", "Avicii", "Levels", 203, "2026-09-15T23:07:44Z", "2026-09-16 00:07"),
      tk("sofia_martins", "D9sc0Latch7", "Disclosure (feat. Sam Smith)", "Latch", 256, "2026-09-14T23:06:00Z", "2026-09-15 00:06"),
    ],
  },
  {
    slug: "tuga_underground",
    nome: "Tuga Underground",
    locutor: "Sofia Martins",
    playlist: "Música Tuga Underground",
    genero: "Rap Tuga Underground",
    generoAlts: ["Hip Hop Tuga Underground", "Rap Português Underground", "Boom Bap Português", "Hip Hop Tuga"],
    janela: "12:00–12:30",
    windows: [["12:00", "12:30"]],
    faixas: 18,
    cap: 30,
    poolSize: 10,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "fora-janela",
    noAr: false,
    ultimaAtualizacao: "2026-09-19 00:15",
    tracks: [
      tk("tuga_underground", "o8yq_YDQWM8", "Deakon", "Dealema - A Cena Toda", 244, "2026-09-18T23:14:41Z", "2026-09-19 00:14", "normalizado", "ytmusicapi → yt-dlp"),
      tk("tuga_underground", "Sk1dP0eTz9m", "Sam The Kid", "Poetas de Karaoke", 268, "2026-09-18T23:14:10Z", "2026-09-19 00:14", "normalizado", "ytmusicapi → yt-dlp"),
      tk("tuga_underground", "Val3teEdV2u", "Valete", "Educação Visual", 301, "2026-09-16T23:12:20Z", "2026-09-17 00:12", "normalizado", "ytmusicapi → yt-dlp"),
      tk("tuga_underground", "Ac1bH0pS0uE", "Boss AC", "Hip Hop (Sou Eu e És Tu)", 236, "2026-09-15T23:11:44Z", "2026-09-16 00:11", "normalizado", "ytmusicapi → yt-dlp"),
      tk("tuga_underground", "DaW3aselRe1", "Da Weasel", "Re-Definições", 279, "2026-09-14T23:10:30Z", "2026-09-15 00:10", "normalizado", "ytmusicapi → yt-dlp"),
      tk("tuga_underground", "MdG4pSmpr2M", "Mind Da Gap", "Sempre em Movimento", 254, "2026-09-13T23:09:12Z", "2026-09-14 00:09", "normalizado", "ytmusicapi → yt-dlp"),
    ],
  },
  {
    slug: "tomas_rocha",
    nome: "Pause & Play",
    locutor: "Tomás Rocha",
    playlist: "Música Pause & Play",
    genero: "Indie & Alternative",
    generoAlts: ["Chill", "Indie", "Focus"],
    janela: "13:00–16:00",
    windows: [["13:00", "16:00"]],
    faixas: 20,
    cap: 60,
    poolSize: 20,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "em-janela",
    noAr: true,
    ultimaAtualizacao: "2026-09-19 00:19",
    tracks: [
      tk("tomas_rocha", "Ph03bR1dgrs", "Phoebe Bridgers", "I Can't Wait", 189, "2026-09-18T23:18:41Z", "2026-09-19 00:18", "pendente"),
      tk("tomas_rocha", "Tm1mpaLos3r", "Tame Impala", "Loser", 232, "2026-09-18T23:18:02Z", "2026-09-19 00:18"),
      tk("tomas_rocha", "Alv2ysArc4M", "Alvvays", "Archie, Marry Me", 208, "2026-09-17T23:16:15Z", "2026-09-18 00:16"),
      tk("tomas_rocha", "T1975SmbdE1", "The 1975", "Somebody Else", 344, "2026-09-16T23:15:30Z", "2026-09-17 00:15"),
      tk("tomas_rocha", "Bh0useSpc9g", "Beach House", "Space Song", 320, "2026-09-15T23:14:44Z", "2026-09-16 00:14"),
      tk("tomas_rocha", "McD3mCham2r", "Mac DeMarco", "Chamber of Reflection", 236, "2026-09-14T23:13:20Z", "2026-09-15 00:13"),
      tk("tomas_rocha", "Arc7kMnkyDW", "Arctic Monkeys", "Do I Wanna Know?", 272, "2026-09-13T23:12:00Z", "2026-09-14 00:12"),
    ],
  },
  {
    slug: "beatriz_lima",
    nome: "Hora de Ponta",
    locutor: "Beatriz Lima",
    playlist: "Música Hora de Ponta",
    genero: "Hip-Hop",
    generoAlts: ["Hip Hop", "Party", "Energy Boosters"],
    janela: "16:00–20:00",
    windows: [["16:00", "20:00"]],
    faixas: 20,
    cap: 60,
    poolSize: 20,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "fora-janela",
    noAr: false,
    ultimaAtualizacao: "2026-09-19 00:24",
    tracks: [
      tk("beatriz_lima", "Km1dLHmbl3E", "Kendrick Lamar", "HUMBLE.", 177, "2026-09-18T23:23:41Z", "2026-09-19 00:23"),
      tk("beatriz_lima", "Drk3PsnFru2", "Drake", "Passionfruit", 298, "2026-09-18T23:23:02Z", "2026-09-19 00:23"),
      tk("beatriz_lima", "TrS4ckoMd9e", "Travis Scott", "SICKO MODE", 312, "2026-09-17T23:21:15Z", "2026-09-18 00:21"),
      tk("beatriz_lima", "Jc0leNoR2md", "J. Cole", "No Role Modelz", 292, "2026-09-16T23:20:30Z", "2026-09-17 00:20"),
      tk("beatriz_lima", "Mtr0Creep8n", "Metro Boomin, The Weeknd", "Creepin'", 221, "2026-09-15T23:19:44Z", "2026-09-16 00:19"),
      tk("beatriz_lima", "Tyl3rEarfq2", "Tyler, The Creator", "EARFQUAKE", 190, "2026-09-14T23:18:20Z", "2026-09-15 00:18"),
      tk("beatriz_lima", "Dj0SaySo4Kw", "Doja Cat", "Say So", 237, "2026-09-13T23:17:00Z", "2026-09-14 00:17"),
    ],
  },
  {
    slug: "goncalo_pires",
    nome: "Modo Noturno",
    locutor: "Gonçalo Pires",
    playlist: "Música Modo Noturno",
    genero: "R&B & Soul",
    generoAlts: ["Chill", "Sleep", "R&B"],
    janela: "20:00–23:00",
    windows: [["20:00", "23:00"]],
    faixas: 14,
    cap: 60,
    poolSize: 20,
    minDur: 120,
    maxDur: 360,
    durLabel: "2:00–6:00",
    lufs: "−16 LUFS",
    estadoJanela: "fora-janela",
    noAr: false,
    ultimaAtualizacao: "2026-09-19 00:28",
    tracks: [
      tk("goncalo_pires", "Sd0HangOn2u", "Sade", "Hang On to Your Love", 262, "2026-09-18T23:27:41Z", "2026-09-19 00:27", "falhou"),
      tk("goncalo_pires", "Wh1tSaving4", "Whitney Houston", "Saving All My Love for You", 234, "2026-09-18T23:27:02Z", "2026-09-19 00:27"),
      tk("goncalo_pires", "Fo0ThinkB2u", "Frank Ocean", "Thinkin Bout You", 200, "2026-09-17T23:25:15Z", "2026-09-18 00:25"),
      tk("goncalo_pires", "Sz4GoodDy9s", "SZA", "Good Days", 279, "2026-09-16T23:24:30Z", "2026-09-17 00:24"),
      tk("goncalo_pires", "Dan3lBestP2", "Daniel Caesar", "Best Part (feat. H.E.R.)", 209, "2026-09-15T23:23:44Z", "2026-09-16 00:23"),
      tk("goncalo_pires", "Eryk4hOnOn8", "Erykah Badu", "On & On", 227, "2026-09-14T23:22:20Z", "2026-09-15 00:22"),
    ],
  },
];

const MOCK: MusicaData = {
  kpis: {
    faixasTotais: 147, // soma real dos 6 pools (38+37+18+20+20+14)
    pools: 6,
    lufsAlvo: "−16 LUFS",
    encode: "MP3 192k",
    ultimaAtualizacao: "2026-09-19 00:28", // manifest.updatedAt 2026-09-18T23:28:15Z → Lisboa
    ultimaAtualizacaoRel: "há 20 h",
    proximoRebuild: "2026-09-20 05:00",
    proximoRebuildFonte: "systemd · itfm-music-daily (05:00 Lisboa, diário)",
  },
  pools: POOLS,
  refreshHistory: [
    { dia: "13/09", faixasNovas: 118, duracao: "1h51", estado: "ok" },
    { dia: "14/09", faixasNovas: 110, duracao: "1h44", estado: "ok" },
    { dia: "15/09", faixasNovas: 96, duracao: "1h37", estado: "ok" },
    { dia: "16/09", faixasNovas: 101, duracao: "1h49", estado: "ok" },
    { dia: "17/09", faixasNovas: 92, duracao: "1h55", estado: "ok" },
    { dia: "18/09", faixasNovas: 83, duracao: "2h11", estado: "parcial" },
    { dia: "19/09", faixasNovas: 104, duracao: "1h58", estado: "ok" },
  ],
};

// Último segmento de um path do manifest ("musica/<slug>/<x>.mp3" → "<x>.mp3").
// Puro; sem I/O. Base para o fallback de videoId/título quando não há meta.
function baseName(p: string): string {
  const seg = p.split("/");
  return seg[seg.length - 1] || p;
}

export async function getMusicaData(): Promise<MusicaData> {
  const clock = lisbonNow();

  // Leituras reais em paralelo (ambas memoizadas por render em azuracast-read):
  //   manifest → contagem/tracks por slug + updatedAt; rotation → recência (`at`).
  const [manifest, rotation] = await Promise.all([getMusicManifest(), getRotationState()]);

  // ── Pools — OVERLAY sobre POOLS (base estática). Só os campos DINÂMICOS caem do
  // manifest/.rotation.json; tudo o resto (playlist/género/janela/cap/lufs/…) fica
  // de P. Cada campo degrada para o seu valor de P se a leitura falhar; um SUCESSO
  // a zero/vazio mostra o zero/vazio real (regra de ouro).
  const pools: Pool[] = POOLS.map((P) => {
    // faixas — nº de paths do slug no manifest (real-a-zero honesto); degrade → P.faixas.
    const faixas = manifest ? manifest.music?.[P.slug]?.length ?? 0 : P.faixas;

    // noAr / estadoJanela — só da grelha (Lisboa), sempre disponível, sem I/O.
    const noAr = programaAt(clock.hhmm)?.slug === P.slug;
    const estadoJanela: EstadoJanela = noAr ? "em-janela" : "fora-janela";

    // ultimaAtualizacao — `at` mais recente do slug no .rotation.json → Lisboa;
    // sem entradas válidas (ou sem rotação) → degrade para P.ultimaAtualizacao.
    let ultimaAtualizacao = P.ultimaAtualizacao;
    const rotSlug = rotation?.[P.slug];
    if (rotSlug) {
      let bestIso = "";
      let bestMs = -Infinity;
      for (const t of Object.values(rotSlug)) {
        if (!t?.at) continue;
        const ms = Date.parse(t.at);
        if (Number.isFinite(ms) && ms > bestMs) {
          bestMs = ms;
          bestIso = t.at;
        }
      }
      if (bestIso) ultimaAtualizacao = toLisbonStamp(bestIso);
    }

    // tracks — do manifest (presença no manifest === normalizado); sem array de
    // paths (manifest ausente/sem slug) → degrade para P.tracks.
    let tracks = P.tracks;
    const paths = manifest?.music?.[P.slug];
    if (Array.isArray(paths)) {
      tracks = paths.map((path): Track => {
        const meta = manifest?.tracks?.[path];
        const videoId = meta?.videoId ?? baseName(path).replace(/\.mp3$/, "");
        const duracao = Math.max(0, Math.round(meta?.dur ?? 0));
        const rot = rotation?.[P.slug]?.[videoId];
        const addedAt = rot?.at ?? manifest?.updatedAt ?? "";
        return {
          videoId,
          artista: meta?.artist ?? "",
          titulo: meta?.title ?? baseName(path),
          duracao,
          duracaoLabel: fmt(duracao),
          lufs: "−16.0 LUFS",
          fonte: "yt-dlp · bestaudio",
          estado: "normalizado",
          path,
          addedAt,
          addedAtLabel: addedAt ? toLisbonStamp(addedAt) : P.ultimaAtualizacao,
        };
      });
    }

    return { ...P, faixas, noAr, estadoJanela, ultimaAtualizacao, tracks };
  });

  // ── KPIs — soma real do manifest sobre os 6 slugs (real-a-zero); degrade → MOCK.
  const faixasTotais = manifest
    ? POOLS.reduce((acc, P) => acc + (manifest.music?.[P.slug]?.length ?? 0), 0)
    : MOCK.kpis.faixasTotais;

  const kpis: MusicaKpis = {
    faixasTotais,
    pools: MOCK.kpis.pools, // 6 (estático)
    lufsAlvo: MOCK.kpis.lufsAlvo, // estático
    encode: MOCK.kpis.encode, // estático
    ultimaAtualizacao: manifest?.updatedAt
      ? toLisbonStamp(manifest.updatedAt)
      : MOCK.kpis.ultimaAtualizacao,
    ultimaAtualizacaoRel: manifest?.updatedAt
      ? relativeFromNow(manifest.updatedAt)
      : MOCK.kpis.ultimaAtualizacaoRel,
    proximoRebuild: proximaOcorrenciaDiariaStamp(5, 0), // próximo 05:00 Lisboa
    proximoRebuildFonte: MOCK.kpis.proximoRebuildFonte, // estático
  };

  return {
    kpis,
    pools,
    // refreshHistory: sem fonte real por-dia ainda → aguarda run-log dos jobs (Fase B).
    refreshHistory: MOCK.refreshHistory,
  };
}
