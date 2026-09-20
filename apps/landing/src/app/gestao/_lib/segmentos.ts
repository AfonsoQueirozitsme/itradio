// Dados dos Segmentos (inserções recorrentes que pontuam a emissão: boletim de
// notícias, meteo, trânsito e sweepers/IDs). SEAM de ligação: hoje devolve
// PLACEHOLDERS; quando ligarmos, só este ficheiro muda — a UI que o consome fica
// igual. Ao contrário dos Programas, os segmentos NÃO são playlists do AzuraCast:
// um injetor Liquidsoap corre o seu próprio agendador e faz ducking da música.
//
// Fontes reais previstas (caminhos relativos à raiz do repo it_radio):
//   apps/station/liquidsoap/segments_mix.liq → o INJETOR (vai no
//     backend_config.custom_config). Mapa hora→conteúdo `seg_file_for_hour`
//     (trânsito 7·9, meteo 8·11·15, notícias 10·12·13·14·16–23),
//     `news_top_of_hour` (:00 às 19h), `fire()`/`fire_news()` e os refs de
//     ducking `music_vol` (1.0/0.5/0.18), `seg_gain` (1.30/1.0),
//     `bed_vol` (0/0.20); scheduler `thread.run(every=2.0)` a ler `time.local()`;
//     gatilho manual `.itfm_fire_news`. As playlists de segmentos ficam
//     DESATIVADAS no AzuraCast (aqui a música continua por baixo).
//   apps/station/news-live.mjs → GERAÇÃO do boletim (não agenda o ar): `FEEDS`
//     (RTP País/Mundo/Economia/Desporto/Cultura + Euronews), `GEN_HOURS`
//     [7,10,13,16,19,22], `TOPN=5`, `CHAR_BUDGET=700`, vozes Ruben Mateus /
//     Mariana Serrano (clones ElevenLabs, `eleven_turbo_v2_5`),
//     `NORM {I:-16,TP:-1.5,LRA:11}`; reescreve `programas/noticias_live.mp3`
//     in-place (sem restart); guarda de quota ElevenLabs + hash-skip.
//   apps/station/deploy-segments.mjs → o "Aplicar" real: substitui
//     `{{MEDIA_DIR}}`, faz backup em apps/station/build/custom_config.backup-*.liq,
//     PUT `/admin/station/{sid}` (custom_config) + POST `/station/{sid}/restart`.
//     Dry-run por defeito; `--yes` aplica + 1 restart do backend.
//   apps/station/lib/programs.mjs → roster canónico (nomes coerentes na UI).
//   GET /api/nowplaying/{shortcode} → agora/ouvintes p/ ancorar "próxima";
//     log journald `label="itfm_segments"` → estado on-air do injetor.
// NB: as horas são de Lisboa (host/container em UTC → converter na ligação).
// NB: segredos (.env) NUNCA são geridos nem mostrados aqui.

export type SegTipo = "noticias" | "meteo" | "transito" | "sweeper" | "id";
export type SegEstado = "ativo" | "pausado";
export type SegMecanismo = "injector" | "azuracast"; // segments_mix.liq vs jingle/cart do AzuraCast

// slot de disparo: minuto do flanco (:30 grelha, :00 topo da hora) + horas Lisboa
export type SegSlot = { minuto: 0 | 30; horas: number[]; label: string };

// mix/ducking real (refs do segments_mix.liq); null quando o AzuraCast corta a música (sweeper/id)
export type SegDucking = {
  musicaVolPct: number; // 50 clássico (meteo/trânsito) · 18 notícias (music_vol 0.5/0.18)
  segGainPct: number; // 130 = voz crua +30% (seg_gain 1.30) · 100 = notícias já a -16 LUFS (1.0)
  bedVolPct: number; // 20 = news_bed sob meteo/trânsito (bed_vol 0.20) · 0 = self-bed/notícias
  selfBed: boolean; // notícias = boletim pré-mixado (voz+bed a -16) → sem bed extra, sem +30%
  restauroMs: number; // rampa de restauro da música 0.70→0.85→1.00 (~600 ms)
} | null;

export type SegVoz = { nome: string; voiceId: string }; // clones ElevenLabs da estação
export type SegFonte = {
  mecanismo: SegMecanismo;
  ficheiro: string; // path no media da estação
  geracao: string; // como o áudio é produzido
  loudness: string; // "-16 LUFS · TP -1.5 · LRA 11"
  feeds?: string[]; // só notícias
  vozes?: SegVoz[]; // só notícias
  modeloTTS?: string; // "eleven_turbo_v2_5"
};
export type SegPreview = { tipo: "audio" | "texto"; corpo: string; meta?: string };

export type Segmento = {
  id: string;
  nome: string;
  tipo: SegTipo;
  descricao: string;
  slots: SegSlot[];
  agendaLabel: string; // rótulo legível pré-computado
  duracaoSeg: number;
  duracaoVariavel: boolean; // notícias = true (request.duration lida por disparo)
  fonte: SegFonte;
  ducking: SegDucking;
  estado: SegEstado;
  proxima: { abs: string; emMin: number; slotLabel: string } | null; // Lisboa, pré-computado (âncora)
  preview: SegPreview;
  disparoManual: string | null; // ".itfm_fire_news" (só notícias) — dispara JÁ, sem restart
};

export type SegmentosData = {
  agoraLisboa: string; // "14:08" — âncora DETERMINÍSTICA p/ recalcular "próxima" na UI (evita mismatch de hidratação, ver live.ts)
  injector: { ativo: boolean; ultimoRestart: string; customConfigChars: number };
  proximo: { segId: string; tipo: SegTipo; nome: string; abs: string; emMin: number; slotLabel: string };
  resumo: { ativos: number; pausados: number; disparosHoje: number };
  segmentos: Segmento[];
};

const GUIAO_NOTICIAS = `Boa tarde. Destaques desta hora: o Governo apresentou hoje as linhas gerais do Orçamento do Estado, com foco na habitação e no IRS jovem. Em Bruxelas, o Conselho Europeu retomou a discussão sobre o pacto migratório. Na economia, a inflação em Portugal abrandou para 2,1% em agosto, segundo o INE. No desporto, arranca esta noite a Liga dos Campeões com dois clubes portugueses em campo. E na cultura, o festival de cinema regressa à Baixa com mais de cem sessões. Continua connosco na IT.FM — a seguir, mais música.`;

const MOCK: SegmentosData = {
  agoraLisboa: "14:08",
  injector: { ativo: true, ultimoRestart: "há 3 dias", customConfigChars: 4210 },
  proximo: {
    segId: "seg-noticias",
    tipo: "noticias",
    nome: "Boletim de notícias",
    abs: "14:30",
    emMin: 22,
    slotLabel: "grelha :30",
  },
  resumo: { ativos: 4, pausados: 1, disparosHoje: 9 },
  segmentos: [
    {
      id: "seg-noticias",
      nome: "Boletim de notícias",
      tipo: "noticias",
      descricao:
        "Boletim pré-mixado (voz + bed a -16 LUFS) que entra sobre a rotação. Reescrito in-place pelo news-live.mjs.",
      slots: [
        { minuto: 30, horas: [10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23], label: "grelha :30" },
        { minuto: 0, horas: [19], label: "topo da hora" },
      ],
      agendaLabel: "Notícias :30 · 10·12·13·14·16–23  +  :00 às 19h (hora nobre)",
      duracaoSeg: 52,
      duracaoVariavel: true,
      fonte: {
        mecanismo: "injector",
        ficheiro: "programas/noticias_live.mp3",
        geracao:
          "RSS→TTS 2 vozes (news-live.mjs, de 3 em 3h · GEN_HOURS 07·10·13·16·19·22), reescrito in-place · top 5 manchetes · ~700 car.",
        loudness: "-16 LUFS · TP -1.5 · LRA 11",
        feeds: ["RTP País", "RTP Mundo", "RTP Economia", "RTP Desporto", "RTP Cultura", "Euronews"],
        vozes: [
          { nome: "Ruben Mateus", voiceId: "el_••••••OHD" },
          { nome: "Mariana Serrano", voiceId: "el_••••••U0Z" },
        ],
        modeloTTS: "eleven_turbo_v2_5",
      },
      ducking: { musicaVolPct: 18, segGainPct: 100, bedVolPct: 0, selfBed: true, restauroMs: 600 },
      estado: "ativo",
      proxima: { abs: "14:30", emMin: 22, slotLabel: "grelha :30" },
      preview: { tipo: "texto", corpo: GUIAO_NOTICIAS, meta: "guião · 5 manchetes · ~0:52" },
      disparoManual: ".itfm_fire_news",
    },
    {
      id: "seg-meteo",
      nome: "Meteo",
      tipo: "meteo",
      descricao: "Boletim meteorológico curto sobre a música, com news_bed por baixo e a voz reforçada +30%.",
      slots: [{ minuto: 30, horas: [8, 11, 15], label: "grelha :30" }],
      agendaLabel: "Meteo :30 · 08·11·15",
      duracaoSeg: 24,
      duracaoVariavel: false,
      fonte: {
        mecanismo: "injector",
        ficheiro: "segmentos/meteo.mp3",
        geracao: "clip fixo (dur lida no arranque)",
        loudness: "-16 LUFS",
      },
      ducking: { musicaVolPct: 50, segGainPct: 130, bedVolPct: 20, selfBed: false, restauroMs: 600 },
      estado: "ativo",
      proxima: { abs: "15:30", emMin: 82, slotLabel: "grelha :30" },
      preview: { tipo: "audio", corpo: "segmentos/meteo.mp3", meta: "0:24" },
      disparoManual: null,
    },
    {
      id: "seg-transito",
      nome: "Trânsito",
      tipo: "transito",
      descricao: "Ponto de trânsito da hora de ponta da manhã, sobre a música com bed e voz reforçada +30%.",
      slots: [{ minuto: 30, horas: [7, 9], label: "grelha :30" }],
      agendaLabel: "Trânsito :30 · 07·09 (só de manhã)",
      duracaoSeg: 22,
      duracaoVariavel: false,
      fonte: {
        mecanismo: "injector",
        ficheiro: "segmentos/transito.mp3",
        geracao: "clip fixo",
        loudness: "-16 LUFS",
      },
      ducking: { musicaVolPct: 50, segGainPct: 130, bedVolPct: 20, selfBed: false, restauroMs: 600 },
      estado: "ativo",
      proxima: { abs: "07:30 (amanhã)", emMin: 1042, slotLabel: "grelha :30" },
      preview: { tipo: "audio", corpo: "segmentos/transito.mp3", meta: "0:22" },
      disparoManual: null,
    },
    {
      id: "seg-sweeper",
      nome: "Sweeper IT.FM",
      tipo: "sweeper",
      descricao: "Varredura musical curta entre faixas. Gerida pelo AzuraCast (playlist de jingles), não pelo injetor.",
      slots: [],
      agendaLabel: "gerido pelo AzuraCast (varredura/rotação de jingles)",
      duracaoSeg: 6,
      duracaoVariavel: false,
      fonte: {
        mecanismo: "azuracast",
        ficheiro: "carts/sweeper_itfm.mp3",
        geracao: "cart estático (jingle playlist)",
        loudness: "-16 LUFS",
      },
      ducking: null,
      estado: "ativo",
      proxima: null,
      preview: { tipo: "audio", corpo: "carts/sweeper_itfm.mp3", meta: "0:06" },
      disparoManual: null,
    },
    {
      id: "seg-id",
      nome: "ID de topo de hora",
      tipo: "id",
      descricao: "Identificação da estação ao topo da hora. Gerida pelo AzuraCast (anúncios de topo de hora).",
      slots: [{ minuto: 0, horas: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], label: "topo da hora" }],
      agendaLabel: "ID :00 (AzuraCast — anúncios de topo de hora)",
      duracaoSeg: 8,
      duracaoVariavel: false,
      fonte: {
        mecanismo: "azuracast",
        ficheiro: "carts/id_topo_hora.mp3",
        geracao: "cart estático (top-of-hour)",
        loudness: "-16 LUFS",
      },
      ducking: null,
      estado: "pausado",
      proxima: null,
      preview: { tipo: "audio", corpo: "carts/id_topo_hora.mp3", meta: "0:08" },
      disparoManual: null,
    },
  ],
};

export async function getSegmentosData(): Promise<SegmentosData> {
  // TODO(ligação): substituir MOCK por leituras reais mantendo a forma de SegmentosData.
  return MOCK;
}
