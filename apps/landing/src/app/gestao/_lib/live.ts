// Dados do LIVE (alinhamento ao ar). SEAM de ligação: hoje devolve um
// alinhamento PLACEHOLDER; quando ligarmos, só este ficheiro muda. Fontes reais
// previstas (ver mapa do apps/station):
//   now      → GET /api/nowplaying/{shortcode} (programa, locutor, ouvintes, DJ)
//   itens    → fila do backend Liquidsoap (request.queue) + grelha :30
//              (segments_mix.liq) + carts/jingles + blocos de publicidade.
//              É MATERIAL PRONTO com hora prevista — NÃO são jobs a correr.
// As horas de início de cada item são CALCULADAS na UI a partir da ordem e das
// durações (arrastar reordena → recalcula tudo). `decorridoInicial` posiciona o
// "agora" dentro do bloco (determinístico → sem mismatch de hidratação).
// NB: horas de Lisboa (host/container em UTC → converter na ligação).

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

export async function getLiveData(): Promise<LiveData> {
  // TODO(ligação): substituir MOCK por nowplaying + fila do backend + grelha.
  // Manter a forma de LiveData para não mexer na UI.
  return MOCK;
}
