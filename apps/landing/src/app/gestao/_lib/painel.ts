// Dados do Painel (dashboard). SEAM de ligação — LIGADO aos dados reais.
// Contrato (PainelData) e MOCK ficam FIXOS: só o corpo de getPainelData() muda.
// Regra: cada campo cai no seu valor mock/computado se a leitura falhar; uma
// leitura com SUCESSO mas a zero mostra o zero real (não o mock).
//
// Fontes por campo:
//   ouvintesAgora → GET /api/nowplaying/{shortcode} (listeners.total) + série
//                   diária (reports/overview/charts) para spark/delta.
//   noAr          → grelha (Lisboa vs janelas) — sempre disponível, não faz I/O.
//   ocupacaoGrelha→ grelha estática (soma das janelas dos 6 programas / 24 h).
//   proximoSegmento→ próximo segmento do injetor (segments_mix.liq via _lib/
//                   segmentos.ts): trânsito/meteo/notícias — alinhado com Segmentos.
//   ouvintesHoje  → série diária de ouvintes (charts.daily). Real-a-zero honesto.
//   pools         → build-music/manifest.json (nº de faixas por slug) + poolCap.
//   proximos      → grelha (próximos arranques) + próximo boletim :30.

import {
  getListenerDaily,
  getMusicManifest,
  getNowPlaying,
  lisbonNow,
  type LisbonClock,
} from "./azuracast-read";
import { GRELHA, noArAgora } from "./grelha";

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

// HHMM inteiro (700) → minutos do dia (420).
const hhmmToMin = (hhmm: number): number => Math.floor(hhmm / 100) * 60 + (hhmm % 100);

// Ocupação da grelha = fração do dia com programa NOMEADO (07–23 = 16 h). A
// madrugada (rotação geral) não conta como "programada". Estático da grelha.
function ocupacaoGrelhaEstatica(): PainelData["ocupacaoGrelha"] {
  const cobertasMin = GRELHA.reduce(
    (acc, p) =>
      acc + p.windows.reduce((a, w) => a + (hhmmToMin(w.fimHHMM) - hhmmToMin(w.inicioHHMM)), 0),
    0,
  );
  const totalMin = 24 * 60;
  return {
    pct: Math.round((cobertasMin / totalMin) * 100),
    horasCobertas: Math.round(cobertasMin / 60),
    totalHoras: 24,
  };
}

// Agendador do INJETOR (espelho do apps/station/liquidsoap/segments_mix.liq; ver o
// mapa hora→conteúdo em _lib/segmentos.ts): trânsito :30 em 07·09, meteo :30 em
// 08·11·15, notícias :30 em 10·12·13·14·16–23 + notícias :00 às 19h (hora nobre).
// É o MESMO conjunto de slots que o ecrã Segmentos usa para o seu `proximo` → o
// "próximo segmento" do Painel nunca contradiz o dos Segmentos.
type SegAt = { minuto: 0 | 30; horas: number[]; tipo: string };
const SEG_INJETOR: SegAt[] = [
  { minuto: 30, horas: [7, 9], tipo: "Trânsito" },
  { minuto: 30, horas: [8, 11, 15], tipo: "Meteo" },
  { minuto: 30, horas: [10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23], tipo: "Notícias" },
  { minuto: 0, horas: [19], tipo: "Notícias" },
];

// Só as horas :30 de NOTÍCIAS (para a lista "Próximos", cujo rótulo é "Notícias :30").
const NOTICIAS_30_HORAS = [10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23];

// Próximo SEGMENTO do injetor (qualquer tipo) a partir do relógio de Lisboa. O
// `tipo` é o real do slot (Meteo/Trânsito/Notícias), não "Notícias" fixo. Dá a
// volta ao dia. Determinístico (só depende de nowMin e do mapa BAKED).
function proximoSegmento(clock: LisbonClock): PainelData["proximoSegmento"] {
  const nowMin = clock.minutesOfDay;
  type Cand = { min: number; hora: number; minuto: number; tipo: string };
  const cands: Cand[] = [];
  for (const s of SEG_INJETOR)
    for (const h of s.horas) cands.push({ min: h * 60 + s.minuto, hora: h, minuto: s.minuto, tipo: s.tipo });
  const futuros = cands.filter((c) => c.min > nowMin).sort((a, b) => a.min - b.min);
  const c = futuros[0] ?? cands.slice().sort((a, b) => a.min - b.min)[0];
  const emMin = c.min > nowMin ? c.min - nowMin : 24 * 60 - nowMin + c.min;
  return { tipo: c.tipo, hora: `${pad2(c.hora)}:${pad2(c.minuto)}`, emMin };
}

// Próximo BOLETIM DE NOTÍCIAS :30 (para a lista "Próximos"). Só slots :30 de
// notícias; dá a volta ao dia. (O topo-da-hora das 19h fica de fora — aqui o
// rótulo é ":30".)
function proximaNoticia(clock: LisbonClock): { hora: string; emMin: number } {
  const nowMin = clock.minutesOfDay;
  for (const h of NOTICIAS_30_HORAS) {
    const t = h * 60 + 30;
    if (t > nowMin) return { hora: `${pad2(h)}:30`, emMin: t - nowMin };
  }
  const t0 = NOTICIAS_30_HORAS[0] * 60 + 30;
  return { hora: `${pad2(NOTICIAS_30_HORAS[0])}:30`, emMin: 24 * 60 - nowMin + t0 };
}

// Próximas entradas da grelha: arranques dos programas (+ madrugada às 23:00) e o
// próximo boletim, ordenados a partir de agora (dá a volta ao dia). Só grelha.
function proximosDaGrelha(clock: LisbonClock): PainelData["proximos"] {
  const nowMin = clock.minutesOfDay;
  type Ev = { min: number; hora: string; titulo: string; tipo: "programa" | "noticias" };
  const eventos: Ev[] = [];
  for (const p of GRELHA) {
    for (const w of p.windows) {
      eventos.push({
        min: hhmmToMin(w.inicioHHMM),
        hora: w.inicio,
        titulo: `${p.nome} · ${p.locutor}`,
        tipo: "programa",
      });
    }
  }
  eventos.push({ min: hhmmToMin(2300), hora: "23:00", titulo: "Madrugada · Rotação geral", tipo: "programa" });
  const noticia = proximaNoticia(clock);
  eventos.push({ min: hhmmToMin(Number(noticia.hora.replace(":", ""))), hora: noticia.hora, titulo: "Notícias :30", tipo: "noticias" });

  return eventos
    .map((e) => ({ ...e, sortKey: e.min > nowMin ? e.min : e.min + 24 * 60 }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, 4)
    .map(({ min: _min, sortKey: _sortKey, ...rest }) => rest);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export async function getPainelData(): Promise<PainelData> {
  const clock = lisbonNow();

  // Leituras reais em paralelo (todas memoizadas por render em azuracast-read).
  const [np, daily, manifest] = await Promise.all([
    getNowPlaying(),
    getListenerDaily(),
    getMusicManifest(),
  ]);

  const dailyYs = Array.isArray(daily) ? daily.map((d) => d.y) : null;

  // ── Ouvintes agora — valor real do nowplaying; spark/delta da série diária.
  let ouvintesAgora = MOCK.ouvintesAgora;
  if (np) {
    const value = np.listeners?.total ?? 0;
    const spark = dailyYs && dailyYs.length >= 2 ? dailyYs : [value, value];
    const delta = dailyYs && dailyYs.length >= 2 ? dailyYs[dailyYs.length - 1] - dailyYs[dailyYs.length - 2] : 0;
    ouvintesAgora = { value, delta, spark };
  }

  // ── Ouvintes hoje — série diária real (pico = dia com mais ouvintes).
  let ouvintesHoje = MOCK.ouvintesHoje;
  if (dailyYs && dailyYs.length >= 1 && daily) {
    let picoIndex = 0;
    for (let i = 1; i < dailyYs.length; i++) if (dailyYs[i] > dailyYs[picoIndex]) picoIndex = i;
    const picoHora = lisbonWeekdayShort(daily[picoIndex]?.x);
    ouvintesHoje = { serie: dailyYs, picoIndex, picoLabel: String(dailyYs[picoIndex]), picoHora };
  }

  // ── Pools de música — contagem por programa (slug) do manifest.
  let pools = MOCK.pools;
  if (manifest) {
    pools = GRELHA.map((p) => ({
      label: p.nome,
      value: manifest.music?.[p.slug]?.length ?? 0,
      cap: p.poolCap,
    }));
  }

  // ── No ar — derivado da grelha (Lisboa), sempre disponível, sem I/O.
  const { programa, locutor, ate } = noArAgora(clock.hhmm);

  return {
    ouvintesAgora,
    noAr: { programa, locutor, ate },
    ocupacaoGrelha: ocupacaoGrelhaEstatica(),
    proximoSegmento: proximoSegmento(clock),
    ouvintesHoje,
    pools,
    proximos: proximosDaGrelha(clock),
  };
}

// "Sáb" / "Ter" — dia da semana curto (Lisboa) de um epoch ms. Vazio se inválido.
function lisbonWeekdayShort(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short" })
    .format(new Date(ms))
    .replace(".", "");
}
