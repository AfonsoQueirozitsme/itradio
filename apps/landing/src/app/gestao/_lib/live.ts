// Dados do LIVE (alinhamento ao ar). SEAM de ligação — LIGADO aos dados reais.
// Contrato (LiveData) e MOCK ficam FIXOS: só o corpo de getLiveData() muda.
//
// Fontes:
//   now      → grelha (programa/locutor/género, Lisboa) + GET /api/nowplaying
//              (ouvintes, DJ ao vivo). programa/locutor vêm da GRELHA, não do
//              nome de playlist do AzuraCast (que é "Madrugada (tudo)" etc.).
//   itens    → faixa atual (now_playing) + fila do backend (GET /station/{id}/
//              queue), tudo kind "musica". A estação da IT.FM não tem locutores/
//              jingles/anúncios na fila (é música + notícias injetadas ao :30,
//              fora da fila), por isso o alinhamento REAL é uma lista de música.
//   blocoInicio/decorridoInicial → início e "elapsed" da faixa atual (now_playing).
// As horas de cada item são CALCULADAS na UI (ordem + durações); `decorridoInicial`
// posiciona o "agora" (determinístico → sem mismatch de hidratação).
// NB: horas de Lisboa — resolvidas no servidor (helpers em azuracast-read).
//
// REGRA: leitura falha (ou zero itens reais) → cai no MOCK. now_playing OK mas
// listeners a zero → mostra o zero real.

import { getListenerDaily, getNowPlaying, getQueue, lisbonNow, toLisbonClock } from "./azuracast-read";
import type { AzQueueItem, AzSong, AzSpin } from "./azuracast-read";
import { noArAgora } from "./grelha";

export type LiveKind =
  | "locutor" // passagem de animador (voice-track / DJ ao vivo)
  | "jingle" // ID / sweeper / stinger
  | "anuncio" // spot ou bloco de publicidade
  | "musica"
  | "segmento" // meteo, trânsito, etc.
  | "noticias"; // boletim

export type LivePreview = { tipo: "texto" | "audio"; corpo: string; meta?: string };

export type LiveItem = {
  id: string;
  kind: LiveKind;
  titulo: string;
  detalhe: string;
  duracao: number; // segundos
  fonte: string; // origem técnica (mostrada em pequeno)
  preview?: LivePreview;
};

export type LiveNow = {
  programa: string;
  locutor: string;
  genero: string;
  ouvintes: number;
  ouvintesDelta: number;
  aoVivo: boolean; // true = DJ em direto; false = piloto automático
};

export type LiveData = {
  now: LiveNow;
  blocoInicio: string; // "14:00" — início do alinhamento carregado (Lisboa)
  decorridoInicial: number; // segundos já decorridos no bloco → posiciona o "agora"
  itens: LiveItem[];
};

const GUIAO_ABERTURA = `Boa tarde! São 14 horas e isto é o Pause & Play, com o Tomás Rocha. Nas próximas horas: o melhor indie e alternativo, uma passagem pelas notícias das 30 e o trânsito à saída do trabalho. Fica connosco — a seguir, MGMT.`;

const MOCK: LiveData = {
  now: {
    programa: "Pause & Play",
    locutor: "Tomás Rocha",
    genero: "Indie & Alternative",
    ouvintes: 342,
    ouvintesDelta: 12,
    aoVivo: false,
  },
  blocoInicio: "14:00",
  // 153 s → itens 1 e 2 já passaram; a 1ª música está a ~2:00/3:49 no ar.
  decorridoInicial: 153,
  itens: [
    {
      id: "it-01",
      kind: "locutor",
      titulo: "Tomás Rocha — abertura",
      detalhe: "voice-track de abertura do bloco",
      duracao: 25,
      fonte: "voice-track",
      preview: { tipo: "texto", corpo: GUIAO_ABERTURA, meta: "guião de abertura" },
    },
    {
      id: "it-02",
      kind: "jingle",
      titulo: "ID — Pause & Play",
      detalhe: "identificação do programa",
      duracao: 8,
      fonte: "carts/id_pause_play.mp3",
      preview: { tipo: "audio", corpo: "carts/id_pause_play.mp3", meta: "0:08" },
    },
    {
      id: "it-03",
      kind: "musica",
      titulo: "MGMT — Electric Feel",
      detalhe: "pool Pause & Play",
      duracao: 229,
      fonte: "musica/tomas_rocha/electric-feel.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/electric-feel.mp3", meta: "3:49" },
    },
    {
      id: "it-04",
      kind: "musica",
      titulo: "Tame Impala — The Less I Know The Better",
      detalhe: "pool Pause & Play",
      duracao: 216,
      fonte: "musica/tomas_rocha/the-less-i-know.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/the-less-i-know.mp3", meta: "3:36" },
    },
    {
      id: "it-05",
      kind: "anuncio",
      titulo: "Bloco de publicidade — Tarde 1",
      detalhe: "2 spots · Café Aurora + Auto Silva",
      duracao: 60,
      fonte: "ads/bloco_tarde_1",
      preview: { tipo: "audio", corpo: "ads/bloco_tarde_1.mp3", meta: "1:00" },
    },
    {
      id: "it-06",
      kind: "jingle",
      titulo: "Sweeper — IT.FM",
      detalhe: "passagem musical curta",
      duracao: 6,
      fonte: "carts/sweeper_itfm.mp3",
      preview: { tipo: "audio", corpo: "carts/sweeper_itfm.mp3", meta: "0:06" },
    },
    {
      id: "it-07",
      kind: "musica",
      titulo: "Glass Animals — Heat Waves",
      detalhe: "pool Pause & Play",
      duracao: 238,
      fonte: "musica/tomas_rocha/heat-waves.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/heat-waves.mp3", meta: "3:58" },
    },
    {
      id: "it-08",
      kind: "segmento",
      titulo: "Meteo (:30)",
      detalhe: "boletim meteorológico · ducking a 50%",
      duracao: 24,
      fonte: "segments_mix.liq",
      preview: { tipo: "audio", corpo: "segmentos/meteo.mp3", meta: "0:24" },
    },
    {
      id: "it-09",
      kind: "locutor",
      titulo: "Tomás Rocha — passagem",
      detalhe: "voice-track sobre intro",
      duracao: 20,
      fonte: "voice-track",
    },
    {
      id: "it-10",
      kind: "musica",
      titulo: "Phoenix — Lisztomania",
      detalhe: "pool Pause & Play",
      duracao: 243,
      fonte: "musica/tomas_rocha/lisztomania.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/lisztomania.mp3", meta: "4:03" },
    },
    {
      id: "it-11",
      kind: "noticias",
      titulo: "Boletim de notícias (:30)",
      detalhe: "5 manchetes · RSS → TTS 2 vozes",
      duracao: 52,
      fonte: "programas/noticias_live.mp3",
      preview: { tipo: "audio", corpo: "programas/noticias_live.mp3", meta: "0:52" },
    },
    {
      id: "it-12",
      kind: "musica",
      titulo: "Foster the People — Pumped Up Kicks",
      detalhe: "pool Pause & Play",
      duracao: 239,
      fonte: "musica/tomas_rocha/pumped-up-kicks.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/pumped-up-kicks.mp3", meta: "3:59" },
    },
    {
      id: "it-13",
      kind: "jingle",
      titulo: "ID — Pause & Play",
      detalhe: "identificação do programa",
      duracao: 8,
      fonte: "carts/id_pause_play.mp3",
      preview: { tipo: "audio", corpo: "carts/id_pause_play.mp3", meta: "0:08" },
    },
    {
      id: "it-14",
      kind: "musica",
      titulo: "Two Door Cinema Club — What You Know",
      detalhe: "pool Pause & Play",
      duracao: 189,
      fonte: "musica/tomas_rocha/what-you-know.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/what-you-know.mp3", meta: "3:09" },
    },
    {
      id: "it-15",
      kind: "anuncio",
      titulo: "Bloco de publicidade — Tarde 2",
      detalhe: "1 spot · Ótica Central",
      duracao: 45,
      fonte: "ads/bloco_tarde_2",
      preview: { tipo: "audio", corpo: "ads/bloco_tarde_2.mp3", meta: "0:45" },
    },
    {
      id: "it-16",
      kind: "musica",
      titulo: "Franz Ferdinand — Take Me Out",
      detalhe: "pool Pause & Play",
      duracao: 237,
      fonte: "musica/tomas_rocha/take-me-out.mp3",
      preview: { tipo: "audio", corpo: "musica/tomas_rocha/take-me-out.mp3", meta: "3:57" },
    },
  ],
};

// "Artista — Título" a partir de uma song do AzuraCast (fallback: campo `text`).
function songTitle(song?: AzSong): string {
  const a = (song?.artist ?? "").trim();
  const t = (song?.title ?? "").trim();
  if (a && t) return `${a} — ${t}`;
  return t || a || (song?.text ?? "").trim() || "Faixa";
}

// Detalhe/fonte de uma faixa a partir da playlist do AzuraCast.
const faixaDetalhe = (playlist?: string): string => (playlist ? `pool ${playlist}` : "rotação");
const faixaFonte = (playlist?: string): string =>
  playlist ? `AzuraCast · ${playlist}` : "AzuraCast · fila";

// now_playing / playing_next (AzSpin) → item de música do alinhamento.
function spinToItem(spin: AzSpin, id: string): LiveItem {
  return {
    id,
    kind: "musica",
    titulo: songTitle(spin.song),
    detalhe: faixaDetalhe(spin.playlist),
    duracao: Math.max(1, Math.round(spin.duration ?? 0)),
    fonte: faixaFonte(spin.playlist),
  };
}

// Item da fila do backend (AzQueueItem) → item de música do alinhamento.
function queueToItem(q: AzQueueItem, idx: number): LiveItem {
  return {
    id: `q-${idx}-${q.cued_at ?? q.played_at ?? ""}`,
    kind: "musica",
    titulo: songTitle(q.song),
    detalhe: faixaDetalhe(q.playlist),
    duracao: Math.max(1, Math.round(q.duration ?? 0)),
    fonte: faixaFonte(q.playlist),
  };
}

export async function getLiveData(): Promise<LiveData> {
  const clock = lisbonNow();

  const [np, queue, daily] = await Promise.all([getNowPlaying(), getQueue(), getListenerDaily()]);

  // Sem nowplaying → não há estado real do ar: cai tudo no MOCK.
  if (!np) return MOCK;

  // ── now — programa/locutor/género da GRELHA; ouvintes/DJ do nowplaying.
  const grid = noArAgora(clock.hhmm);
  const dailyYs = Array.isArray(daily) ? daily.map((d) => d.y) : null;
  const ouvintesDelta =
    dailyYs && dailyYs.length >= 2 ? dailyYs[dailyYs.length - 1] - dailyYs[dailyYs.length - 2] : 0;
  const now: LiveNow = {
    programa: grid.programa,
    locutor: grid.locutor,
    genero: grid.genero,
    ouvintes: np.listeners?.total ?? 0,
    ouvintesDelta,
    aoVivo: np.live?.is_live ?? false,
  };

  // ── itens — faixa atual + fila (ou playing_next se a fila vier vazia).
  const itens: LiveItem[] = [];
  const cur = np.now_playing;
  if (cur?.song) itens.push(spinToItem(cur, `np-${cur.sh_id ?? "now"}`));
  if (Array.isArray(queue) && queue.length) {
    queue.forEach((q, i) => itens.push(queueToItem(q, i)));
  } else if (np.playing_next?.song) {
    itens.push(spinToItem(np.playing_next, `np-next-${np.playing_next.sh_id ?? ""}`));
  }

  // Nenhum item real (a estação toca sempre algo → isto sinaliza leitura torta):
  // cai no MOCK para não mostrar um alinhamento vazio.
  if (itens.length === 0) return MOCK;

  // blocoInicio/decorridoInicial = início e "elapsed" da faixa atual. Sem faixa
  // atual (só fila) → arranca "agora", elapsed 0.
  const blocoInicio = cur?.played_at ? toLisbonClock(cur.played_at, "s") : clock.clock;
  const decorridoInicial = cur?.song ? Math.max(0, Math.round(cur.elapsed ?? 0)) : 0;

  return { now, blocoInicio, decorridoInicial, itens };
}
