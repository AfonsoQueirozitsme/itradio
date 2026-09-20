// Dados do Painel (dashboard). SEAM de ligação: hoje devolve PLACEHOLDERS;
// quando ligarmos ao AzuraCast, só este ficheiro muda — os componentes que o
// consomem ficam iguais. Fontes reais previstas (ver mapa de dados):
//   ouvintesAgora/ouvintesHoje → GET /api/nowplaying/{shortcode} (+ /listeners)
//   noAr/proximos              → grelha em programs.mjs + nowplaying.playing_next
//   ocupacaoGrelha             → schedule_items de GET /station/{sid}/playlists
//   pools                      → ficheiros em musica/<slug>/ + manifest.json
//   proximoSegmento            → AIR_WINDOWS de news-live.mjs

export type PainelData = {
  ouvintesAgora: { value: number; delta: number; spark: number[] };
  noAr: { programa: string; locutor: string; ate: string };
  ocupacaoGrelha: { pct: number; horasCobertas: number; totalHoras: number };
  proximoSegmento: { tipo: string; hora: string; emMin: number };
  ouvintesHoje: { serie: number[]; picoIndex: number; picoLabel: string; picoHora: string };
  pools: { label: string; value: number; cap: number }[];
  proximos: { hora: string; titulo: string; tipo: "programa" | "noticias" | "segmento" }[];
};

const MOCK: PainelData = {
  ouvintesAgora: { value: 342, delta: 12, spark: [280, 291, 275, 320, 305, 360, 344, 402, 388, 342] },
  noAr: { programa: "Pause & Play", locutor: "Tomás Rocha", ate: "16:00" },
  ocupacaoGrelha: { pct: 67, horasCobertas: 16, totalHoras: 24 },
  proximoSegmento: { tipo: "Meteo", hora: "15:30", emMin: 53 },
  ouvintesHoje: {
    serie: [120, 150, 138, 185, 210, 196, 250, 411, 232, 216, 176, 140, 110],
    picoIndex: 7,
    picoLabel: "411",
    picoHora: "15h",
  },
  pools: [
    { label: "Ctrl+Alt+Ritmo", value: 60, cap: 60 },
    { label: "Pause & Play", value: 55, cap: 60 },
    { label: "Hora de Ponta", value: 58, cap: 60 },
    { label: "Modo Noturno", value: 31, cap: 60 },
  ],
  proximos: [
    { hora: "15:30", titulo: "Meteo (:30)", tipo: "segmento" },
    { hora: "16:00", titulo: "Hora de Ponta · Beatriz Lima", tipo: "programa" },
    { hora: "16:30", titulo: "Notícias :30", tipo: "noticias" },
    { hora: "20:00", titulo: "Modo Noturno · Gonçalo Pires", tipo: "programa" },
  ],
};

export async function getPainelData(): Promise<PainelData> {
  // TODO(ligação): substituir por leituras reais (nowplaying + playlists +
  // manifest). Mantém a mesma forma de PainelData para não mexer na UI.
  return MOCK;
}
