// Dados dos Jobs (calendário + histórico + scripts editáveis). SEAM de ligação:
// hoje devolve dados PARCIAIS — o corpo de getJobsData() sobrepõe ao MOCK os
// campos reais que já têm fonte (scripts[].conteudo lido do disco + a última
// execução de 2 jobs: news-generate e music-daily-refresh); week e resumo são
// agora COMPUTADOS dinamicamente a partir do relógio de Lisboa e sinais reais
// (news-state.json mtime, manifest.json updatedAt); runs continuam MOCK até à
// Fase B (run-log + journald). Fontes reais (apps/station):
//   jobs/week  → 3 agendadores reais: launchd (news-live.mjs, :05 nas horas
//                07/10/13/16/19/22 Lisboa), systemd timer (daily-refresh.mjs,
//                05:00 Lisboa) e GitHub Actions (autodeploy da landing).
//                Sub-jobs music-build/deploy e os scripts manuais também aqui.
//   runs       → .daily.log (journald) + news-state.json + saída dos scripts
//   scripts    → ficheiros de config/código do apps/station (ver tiers de risco)
// NB: as horas são de Lisboa (host/container em UTC → converter na ligação).

import {
  getNewsState,
  getMusicManifest,
  readStationFile,
  readStationFileHead,
  relativeFromNow,
  statStationFile,
  lisbonNow,
  lisbonDateISO,
  addDaysISO,
  pad2,
  toLisbonClock,
  toLisbonStamp,
  type LisbonClock,
  type MusicManifest,
  type NewsState,
} from "./azuracast-read";

export type JobState = "concluido" | "a_correr" | "agendado" | "falhou";
export type JobRisk = "baixo" | "medio" | "alto";
export type JobTrigger = "launchd" | "systemd" | "github" | "manual" | "sub-job";

export type JobDef = {
  key: string;
  name: string;
  descricao: string;
  trigger: JobTrigger;
  agendamento: string; // legível: "07·10·13·16·19·22" / "05:00 diário" / "on push"
  scriptPath: string;
  rerunnable: boolean;
  destrutivo: boolean;
  risk: JobRisk;
  ultimaExec: string | null; // "hoje 13:05"
  ultimoEstado: JobState | null;
  ultimoResultado: string | null;
};

export type Occurrence = {
  id: string; // aponta para um JobRun quando existe
  jobKey: string;
  nome: string;
  hora: string; // HH:MM
  estado: JobState;
};

export type CalDay = {
  weekday: string; // "Seg"
  dia: string; // "15"
  hoje: boolean;
  ocorrencias: Occurrence[];
};

export type RunStep = {
  label: string;
  estado: "concluido" | "a_correr" | "pendente" | "falhou";
  detalhe?: string;
};

export type JobRun = {
  id: string;
  jobKey: string;
  nome: string;
  estado: JobState;
  gatilho: string; // "launchd (auto)" / "manual" / "systemd (auto)"
  inicio: string; // "hoje 14:02:03"
  fim: string | null;
  duracao: string | null;
  // caso ainda não tenha corrido: detalhes do pedido (o que VAI usar)
  pedido: { label: string; valor: string }[];
  // caso tenha corrido: resultados/métricas
  resultado: { label: string; valor: string }[] | null;
  passos: RunStep[];
  log: string[]; // cauda do log
};

export type EditableScript = {
  key: string;
  name: string;
  path: string;
  formato: string; // js / json / python / liquidsoap / systemd / tsv
  risk: JobRisk;
  tier: "config" | "config-codigo" | "script";
  nota: string;
  conteudo: string; // excerto editável (mock)
};

export type JobsData = {
  resumo: { agendadosHoje: number; concluidos: number; aCorrer: number; falhas: number };
  jobs: JobDef[];
  week: CalDay[];
  runs: JobRun[];
  scripts: EditableScript[];
};

// ── Registo de jobs ─────────────────────────────────────────────────────────
const JOBS: JobDef[] = [
  {
    key: "news-generate",
    name: "Notícias LIVE",
    descricao: "RSS pt-PT → guião → 2 vozes (ElevenLabs) → -16 LUFS → reescreve o boletim in-place.",
    trigger: "launchd",
    agendamento: "07·10·13·16·19·22",
    scriptPath: "apps/station/news-live.mjs",
    rerunnable: true,
    destrutivo: false,
    risk: "medio",
    ultimaExec: "hoje 13:05",
    ultimoEstado: "concluido",
    ultimoResultado: "5 manchetes · 34 s",
  },
  {
    key: "music-daily-refresh",
    name: "Refresh diário da música",
    descricao: "Para os 6 programas, em série: build (trending) + deploy (rotação com teto). Contra localhost, sem restart.",
    trigger: "systemd",
    agendamento: "05:00 diário",
    scriptPath: "apps/station/music/daily-refresh.mjs",
    rerunnable: true,
    destrutivo: false,
    risk: "alto",
    ultimaExec: "hoje 05:03",
    ultimoEstado: "concluido",
    ultimoResultado: "6 ok · 0 falhas · 1h58",
  },
  {
    key: "landing-autodeploy",
    name: "Autodeploy da landing",
    descricao: "On push a main que toque apps/landing: git reset, npm ci, build e restart do serviço.",
    trigger: "github",
    agendamento: "on push · main",
    scriptPath: ".github/workflows/deploy-landing.yml",
    rerunnable: true,
    destrutivo: false,
    risk: "medio",
    ultimaExec: "ontem 22:14",
    ultimoEstado: "concluido",
    ultimoResultado: "build ok · 2m11",
  },
  {
    key: "music-build",
    name: "Build de pool (por programa)",
    descricao: "Seleciona trending do género, baixa (yt-dlp) e normaliza. Sub-job do refresh; também manual.",
    trigger: "sub-job",
    agendamento: "via refresh / manual",
    scriptPath: "apps/station/music/music-build.mjs",
    rerunnable: true,
    destrutivo: false,
    risk: "medio",
    ultimaExec: "hoje 05:41",
    ultimoEstado: "falhou",
    ultimoResultado: "Modo Noturno: 3 downloads falharam",
  },
  {
    key: "music-deploy",
    name: "Deploy de pool (rotação)",
    descricao: "Publica a pool na playlist do programa e faz rotação com teto (apaga as mais antigas). Sub-job / manual.",
    trigger: "sub-job",
    agendamento: "via refresh / manual",
    scriptPath: "apps/station/music/music-deploy.mjs",
    rerunnable: true,
    destrutivo: true,
    risk: "alto",
    ultimaExec: "hoje 14:02",
    ultimoEstado: "a_correr",
    ultimoResultado: null,
  },
  {
    key: "deploy-segments",
    name: "Deploy do injector (segmentos)",
    descricao: "Aplica o segments_mix.liq ao custom_config do backend e reinicia. Dry-run por defeito.",
    trigger: "manual",
    agendamento: "manual",
    scriptPath: "apps/station/deploy-segments.mjs",
    rerunnable: true,
    destrutivo: false,
    risk: "alto",
    ultimaExec: "há 3 dias",
    ultimoEstado: "concluido",
    ultimoResultado: "custom_config aplicado + backup",
  },
  {
    key: "loudness-apply",
    name: "Normalização de loudness",
    descricao: "Mede EBU R128 e escreve o ganho amplify por ficheiro (sem restart). Dry-run por defeito.",
    trigger: "manual",
    agendamento: "manual",
    scriptPath: "apps/station/loudness-watcher.mjs",
    rerunnable: true,
    destrutivo: false,
    risk: "alto",
    ultimaExec: "há 5 dias",
    ultimoEstado: "concluido",
    ultimoResultado: "musica: 214 ficheiros normalizados",
  },
  {
    key: "deploy-programacao",
    name: "Deploy da programação (WIPE)",
    descricao: "Bootstrap/reset: apaga TODAS as playlists/media e recria por ordem + restart. Destrutivo.",
    trigger: "manual",
    agendamento: "manual",
    scriptPath: "apps/station/deploy-programacao.mjs",
    rerunnable: true,
    destrutivo: true,
    risk: "alto",
    ultimaExec: "há 12 dias",
    ultimoEstado: "concluido",
    ultimoResultado: "grelha recriada · restart",
  },
];

// ── Semana (calendário) — computada DINAMICAMENTE a partir do relógio de ────
// Lisboa e das definições dos JOBS agendados. Janela de 7 dias centrada em hoje
// (3 antes, hoje, 3 depois). Cada dia tem as ocorrências previstas:
//   • news-generate: 6/dia (07·10·13·16·19·22, minuto :05)
//   • music-daily-refresh: 1/dia (05:00)
//   • landing-autodeploy: ignorado (event-driven, não agendado)
//   • sub-jobs/manuais: ignorados (não aparecem no calendário)
// O estado de cada ocorrência depende do tempo de Lisboa:
//   passado → "concluido"; futuro → "agendado"; corrente → heurística com sinal
//   real (news-state.json mtime, manifest.json updatedAt).
//
// "Corrente" significa: é a ocorrência mais recente HOJE cuja hora já passou e
// para a qual temos um sinal real que confirma a execução. Sem sinal, conserva
// "concluido" se já passou e "agendado" se ainda não.

const NEWS_HOURS = [7, 10, 13, 16, 19, 22] as const;
const NEWS_MINUTE = 5;
const MUSIC_HOUR = 5;
const MUSIC_MINUTE = 0;

// Nomes de dia abreviados em pt-PT (índice 1=Seg … 7=Dom, ISO weekday).
const PT_WEEKDAYS: Record<number, string> = {
  1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom",
};

// Extrai o dia de Lisboa (1–7 ISO) de uma data "YYYY-MM-DD" usando Intl.
function weekdayFromISO(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`); // meio-dia UTC → seguro para DST
  if (Number.isNaN(d.getTime())) return 1;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    weekday: "short",
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] ?? 1;
}

// Extrai o dia do mês de um "YYYY-MM-DD".
function dayOfMonth(iso: string): string {
  return String(Number(iso.split("-")[2]) || 1);
}

type RealSignals = {
  newsRanTodayAt: number | null;  // epoch ms do último news-state.json mtime, se hoje
  musicRanTodayAt: number | null; // epoch ms do manifest updatedAt, se hoje
};

function buildWeek(now: LisbonClock, signals: RealSignals): CalDay[] {
  const todayISO = lisbonDateISO(now.ms);
  const days: CalDay[] = [];

  for (let offset = -3; offset <= 3; offset++) {
    const iso = addDaysISO(todayISO, offset);
    const isToday = offset === 0;
    const isFuture = offset > 0;
    const wd = weekdayFromISO(iso);
    const dm = dayOfMonth(iso);

    const ocorrencias: Occurrence[] = [];

    // music-daily-refresh: 1 ocorrência/dia às 05:00
    const musicMinOfDay = MUSIC_HOUR * 60 + MUSIC_MINUTE;
    let musicEstado: JobState;
    if (isFuture) {
      musicEstado = "agendado";
    } else if (isToday) {
      if (now.minutesOfDay < musicMinOfDay) {
        musicEstado = "agendado";
      } else if (signals.musicRanTodayAt) {
        musicEstado = "concluido";
      } else {
        // Hora já passou mas sem sinal real → assumimos concluido (conservador).
        musicEstado = "concluido";
      }
    } else {
      musicEstado = "concluido";
    }
    ocorrencias.push({
      id: `music-${offset + 3}-${pad2(MUSIC_HOUR)}`,
      jobKey: "music-daily-refresh",
      nome: "Refresh música",
      hora: `${pad2(MUSIC_HOUR)}:${pad2(MUSIC_MINUTE)}`,
      estado: musicEstado,
    });

    // news-generate: 6 ocorrências/dia
    for (const h of NEWS_HOURS) {
      const occMinOfDay = h * 60 + NEWS_MINUTE;
      let estado: JobState;
      if (isFuture) {
        estado = "agendado";
      } else if (isToday) {
        if (now.minutesOfDay < occMinOfDay) {
          estado = "agendado";
        } else {
          // Hora já passou. Verificar se é a ocorrência mais recente com sinal.
          estado = "concluido";
        }
      } else {
        estado = "concluido";
      }
      ocorrencias.push({
        id: `news-${offset + 3}-${h}`,
        jobKey: "news-generate",
        nome: "Notícias",
        hora: `${pad2(h)}:${pad2(NEWS_MINUTE)}`,
        estado,
      });
    }

    // Ordena por hora
    ocorrencias.sort((a, b) => a.hora.localeCompare(b.hora));

    days.push({ weekday: PT_WEEKDAYS[wd] ?? "?", dia: dm, hoje: isToday, ocorrencias });
  }

  const todayDay = days.find((d) => d.hoje);
  if (todayDay) {
    // ── News: marca ocorrências com sinal real ou "a_correr" na janela ──
    if (signals.newsRanTodayAt) {
      const signalClock = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(signals.newsRanTodayAt));
      const signalHour = Number(signalClock);

      const newsOccs = todayDay.ocorrencias.filter((o) => o.jobKey === "news-generate");
      for (const occ of newsOccs) {
        const occHour = Number(occ.hora.split(":")[0]);
        if (occHour <= signalHour && occ.estado !== "agendado") {
          occ.estado = "concluido";
        }
      }

      for (const occ of newsOccs) {
        const occHour = Number(occ.hora.split(":")[0]);
        const occMin = occHour * 60 + NEWS_MINUTE;
        if (
          now.minutesOfDay >= occMin &&
          now.minutesOfDay < occMin + 15 &&
          occHour > signalHour
        ) {
          occ.estado = "a_correr";
        }
      }
    } else {
      // Sem sinal nenhum: se estamos dentro de 15 min após uma hora agendada,
      // assume "a_correr" (geração pode estar a decorrer).
      const newsOccs = todayDay.ocorrencias.filter((o) => o.jobKey === "news-generate");
      for (const occ of newsOccs) {
        const occHour = Number(occ.hora.split(":")[0]);
        const occMin = occHour * 60 + NEWS_MINUTE;
        if (now.minutesOfDay >= occMin && now.minutesOfDay < occMin + 15) {
          occ.estado = "a_correr";
        }
      }
    }

    // ── Music: marca "a_correr" se estamos dentro de 2h após 05:00 sem sinal ──
    const musicOcc = todayDay.ocorrencias.find((o) => o.jobKey === "music-daily-refresh");
    if (musicOcc) {
      const musicMin = MUSIC_HOUR * 60 + MUSIC_MINUTE;
      if (signals.musicRanTodayAt) {
        // Sinal real confirma conclusão
        if (now.minutesOfDay >= musicMin) {
          musicOcc.estado = "concluido";
        }
      } else if (now.minutesOfDay >= musicMin && now.minutesOfDay < musicMin + 120) {
        // Dentro de 2h após a hora (refresh leva ~2h), sem sinal → a_correr
        musicOcc.estado = "a_correr";
      }
    }
  }

  return days;
}

function buildResumo(week: CalDay[]): JobsData["resumo"] {
  const today = week.find((d) => d.hoje);
  if (!today) return { agendadosHoje: 0, concluidos: 0, aCorrer: 0, falhas: 0 };
  const ocs = today.ocorrencias;
  return {
    agendadosHoje: ocs.filter((o) => o.estado === "agendado").length,
    concluidos: ocs.filter((o) => o.estado === "concluido").length,
    aCorrer: ocs.filter((o) => o.estado === "a_correr").length,
    falhas: ocs.filter((o) => o.estado === "falhou").length,
  };
}

// ── Execuções — construídas a partir de sinais reais + agendadas previstas ──
// As runs são DINÂMICAS: construídas a partir de news-state.json (última geração),
// manifest.json (último refresh) e .daily.log (se existir), mais as PRÓXIMAS
// ocorrências agendadas de cada job. O MOCK só é usado como fallback total.

function buildRealRuns(
  news: { hash?: string; at?: string; count?: number; totalChars?: number } | null,
  manifest: { updatedAt?: string; music?: Record<string, string[]>; tracks?: Record<string, unknown> } | null,
  dailyLog: string | null,
  now: LisbonClock,
): JobRun[] {
  const runs: JobRun[] = [];

  // 1. Última geração de notícias (real de news-state.json)
  if (news?.at) {
    const atDate = new Date(news.at);
    const newsLisbonStamp = toLisbonStamp(atDate);
    const newsLisbonClock = toLisbonClock(atDate);
    const newsHour = Number(newsLisbonClock.split(":")[0]);
    const diffMin = Math.round((now.ms - atDate.getTime()) / 60000);
    const durLabel = diffMin < 2 ? "<1 min" : diffMin < 60 ? `~${diffMin} min` : null;

    runs.push({
      id: `news-real-${news.hash ?? "last"}`,
      jobKey: "news-generate",
      nome: `Notícias LIVE · ${newsLisbonClock}`,
      estado: "concluido",
      gatilho: "launchd (auto)",
      inicio: newsLisbonStamp,
      fim: newsLisbonStamp,
      duracao: durLabel,
      pedido: [
        { label: "Feeds", valor: "RTP País/Mundo/Economia/Desporto/Cultura + Euronews" },
        { label: "Manchetes", valor: `top ${news.count ?? "?"} · orçamento ~700 car.` },
        { label: "Vozes", valor: "Ruben Mateus + Mariana Serrano" },
      ],
      resultado: [
        { label: "Manchetes", valor: String(news.count ?? "?") },
        { label: "Caracteres", valor: String(news.totalChars ?? "?") },
        { label: "Loudness", valor: "-16.0 LUFS" },
        { label: "Ficheiro", valor: "programas/noticias_live.mp3 (in-place)" },
      ],
      passos: [
        { label: "Buscar feeds RSS", estado: "concluido" },
        { label: "Montar guião", estado: "concluido", detalhe: `${news.count ?? "?"} manchetes` },
        { label: "TTS 2 vozes + mistura na bed", estado: "concluido" },
        { label: "Normalizar -16 LUFS + upload in-place", estado: "concluido" },
      ],
      log: [
        `${newsLisbonClock}  generate — gate GEN_HOURS ok (${newsHour}h)`,
        `${newsLisbonClock}  ${news.count ?? "?"} manchetes · ${news.totalChars ?? "?"} car.`,
        `${newsLisbonClock}  concluído`,
      ],
    });
  }

  // 2. Último refresh de música (real de manifest.json)
  if (manifest?.updatedAt) {
    const mDate = new Date(manifest.updatedAt);
    const mStamp = toLisbonStamp(mDate);
    const slugs = manifest.music ? Object.keys(manifest.music) : [];
    const totalTracks = manifest.music
      ? Object.values(manifest.music).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0)
      : 0;

    const logLines: string[] = [];
    if (dailyLog) {
      const lines = dailyLog.split("\n").filter(Boolean);
      logLines.push(...lines.slice(-10));
    } else {
      logLines.push(`${mStamp}  daily-refresh — ${slugs.length} programas`);
      logLines.push(`${mStamp}  concluído — ${totalTracks} faixas total`);
    }

    runs.push({
      id: `music-real-${manifest.updatedAt}`,
      jobKey: "music-daily-refresh",
      nome: "Refresh diário da música",
      estado: "concluido",
      gatilho: "systemd (auto)",
      inicio: mStamp,
      fim: mStamp,
      duracao: null,
      pedido: [
        { label: "Programas", valor: `${slugs.length} (ordem de janela)` },
        { label: "Alvo", valor: "AzuraCast localhost · in-place" },
      ],
      resultado: [
        { label: "Programas", valor: `${slugs.length}` },
        { label: "Faixas total", valor: String(totalTracks) },
        { label: "Restart", valor: "não (refresco in-place)" },
      ],
      passos: slugs.map((s) => ({
        label: `${s} · build+deploy`,
        estado: "concluido" as const,
        detalhe: `${manifest.music?.[s]?.length ?? 0} faixas`,
      })),
      log: logLines,
    });
  }

  // 3. Próximas ocorrências agendadas (news-generate)
  const nextNewsHour = NEWS_HOURS.find((h) => h * 60 + NEWS_MINUTE > now.minutesOfDay);
  if (nextNewsHour !== undefined) {
    runs.push({
      id: `news-next-${nextNewsHour}`,
      jobKey: "news-generate",
      nome: `Notícias LIVE · ${pad2(nextNewsHour)}:${pad2(NEWS_MINUTE)}`,
      estado: "agendado",
      gatilho: "launchd (auto)",
      inicio: `hoje ${pad2(nextNewsHour)}:${pad2(NEWS_MINUTE)} (previsto)`,
      fim: null,
      duracao: null,
      pedido: [
        { label: "Gate", valor: `GEN_HOURS ${NEWS_HOURS.join("·")} (Lisboa)` },
        { label: "Feeds", valor: "6 RSS pt-PT" },
        { label: "Manchetes", valor: "top 5 · ~700 car." },
        { label: "Guarda de quota", valor: "salta se EL < necessário + 50" },
      ],
      resultado: null,
      passos: [
        { label: `Aguardar janela ${pad2(nextNewsHour)}:${pad2(NEWS_MINUTE)}`, estado: "pendente" },
        { label: "Buscar feeds + montar guião", estado: "pendente" },
        { label: "TTS + normalizar + upload", estado: "pendente" },
      ],
      log: [`(agendado para as ${pad2(nextNewsHour)}:${pad2(NEWS_MINUTE)} · launchd)`],
    });
  }

  // Ordena: a_correr primeiro, agendados último, mais recentes primeiro para o resto
  runs.sort((a, b) => {
    const order: Record<JobState, number> = { a_correr: 0, agendado: 3, concluido: 1, falhou: 2 };
    return (order[a.estado] ?? 1) - (order[b.estado] ?? 1);
  });

  return runs;
}

// MOCK fallback — usado quando não há sinais reais nenhuns.
const MOCK_RUNS: JobRun[] = [
  {
    id: "news-3-13",
    jobKey: "news-generate",
    nome: "Notícias LIVE · 13:05",
    estado: "concluido",
    gatilho: "launchd (auto)",
    inicio: "hoje 13:05:01",
    fim: "hoje 13:05:35",
    duracao: "34 s",
    pedido: [
      { label: "Feeds", valor: "RTP País/Mundo/Economia/Desporto/Cultura + Euronews" },
      { label: "Manchetes", valor: "top 5 · orçamento ~700 car." },
      { label: "Vozes", valor: "Ruben Mateus + Mariana Serrano" },
    ],
    resultado: [
      { label: "Manchetes", valor: "5" },
      { label: "Caracteres", valor: "692" },
      { label: "Loudness", valor: "-16.0 LUFS" },
      { label: "Ficheiro", valor: "programas/noticias_live.mp3 (in-place)" },
      { label: "Quota EL", valor: "18% restante" },
    ],
    passos: [
      { label: "Buscar feeds RSS", estado: "concluido", detalhe: "6 feeds · 41 itens" },
      { label: "Montar guião (top 5)", estado: "concluido" },
      { label: "TTS 2 vozes + mistura na bed", estado: "concluido" },
      { label: "Normalizar -16 LUFS + upload in-place", estado: "concluido" },
    ],
    log: [
      "13:05:01  generate — gate GEN_HOURS ok (13h)",
      "13:05:03  feeds ok — 41 itens → 5 manchetes",
      "13:05:12  hash mudou → TTS (2 vozes)",
      "13:05:30  loudnorm -16 LUFS · 192k",
      "13:05:35  upload programas/noticias_live.mp3 ok (sem restart)",
    ],
  },
];

// ── Scripts / configuração editáveis ────────────────────────────────────────
const SCRIPTS: EditableScript[] = [
  {
    key: "programs",
    name: "Programas (janelas · géneros · pools)",
    path: "apps/station/lib/programs.mjs",
    formato: "js",
    risk: "alto",
    tier: "config-codigo",
    nota: "Fonte única dos programas: janelas (Lisboa), género de trending, poolSize e poolCap. Um erro de sintaxe quebra o refresh diário; baixar o poolCap apaga faixas ao vivo.",
    conteudo: `export const PROGRAMS = [
  {
    slug: "tomas_rocha",
    nome: "Pause & Play",
    locutor: "Tomás Rocha",
    inicio: "13:00", fim: "16:00",   // Lisboa
    ytGenre: "indie & alternative",
    ytGenreAlts: ["chill", "indie", "focus"],
    poolSize: 20,   // novas por refresh
    poolCap: 60,    // teto on-air (deploy apaga acima disto)
    minDur: 120, maxDur: 360,
  },
  // … outros 5 programas
];
`,
  },
  {
    key: "segments",
    name: "Injector de segmentos (Liquidsoap)",
    path: "apps/station/liquidsoap/segments_mix.liq",
    formato: "liquidsoap",
    risk: "alto",
    tier: "config-codigo",
    nota: "Config do backend AO VIVO (aplicado no restart via deploy-segments). Grelha :30, notícias ao topo da hora e ducking. Uma má edição = dead air no próximo restart.",
    conteudo: `# grelha :30 — que clip toca a cada meia-hora
def seg_file_for_hour(h) =
  if list.mem(h, [7, 9])        then "transito"
  elsif list.mem(h, [8, 11, 15]) then "meteo"
  else "noticias" end
end

# notícias ao topo da hora (:00)
def news_top_of_hour(h) = list.mem(h, [19]) end

music_vol = 0.5   # ducking da música durante o segmento
seg_gain  = 1.0
`,
  },
  {
    key: "news-feeds",
    name: "Notícias · feeds e cadência",
    path: "apps/station/news-live.mjs",
    formato: "js",
    risk: "alto",
    tier: "script",
    nota: "Gerador on-air. Editar FEEDS muda as fontes; GEN_HOURS/TOPN mudam cadência e custo de quota ElevenLabs. Idealmente extrair estas constantes para config validada.",
    conteudo: `const FEEDS = [
  "https://www.rtp.pt/…/pais.rss",
  "https://www.rtp.pt/…/mundo.rss",
  "https://www.rtp.pt/…/economia.rss",
  "https://www.rtp.pt/…/desporto.rss",
  "https://www.rtp.pt/…/cultura.rss",
  "https://feeds.euronews.com/pt",
];
const GEN_HOURS = [7, 10, 13, 16, 19, 22]; // Lisboa
const NEWS_TOPN = 5;
const NEWS_CHAR_BUDGET = 700;
`,
  },
  {
    key: "rotation",
    name: "Histórico de rotação",
    path: "apps/station/music/.rotation.json",
    formato: "json",
    risk: "medio",
    tier: "config",
    nota: "Estado persistente: dedup (videoIds recentes) + recência que decide que faixas o deploy retira ao passar o teto. Editar à mão pode causar repetições ou remoções erradas.",
    conteudo: `{
  "tomas_rocha": {
    "kGx1...": { "title": "Heat Waves", "artist": "Glass Animals", "at": "2026-09-19T05:12:00Z" },
    "9aQ2...": { "title": "The Less I Know…", "artist": "Tame Impala", "at": "2026-09-17T05:10:00Z" }
  }
}
`,
  },
  {
    key: "music-timer",
    name: "Timer diário da música (systemd)",
    path: "apps/station/systemd/itfm-music-daily.timer",
    formato: "systemd",
    risk: "medio",
    tier: "config",
    nota: "Agenda declarativa. Editar aqui não tem efeito até copiar para /etc/systemd/system e daemon-reload (sudo). OnCalendar malformado impede o disparo.",
    conteudo: `[Unit]
Description=IT.FM — refresh diário da música

[Timer]
OnCalendar=*-*-* 05:00:00 Europe/Lisbon
RandomizedDelaySec=180
Persistent=true

[Install]
WantedBy=timers.target
`,
  },
  {
    key: "select-tracks",
    name: "Seleção de trending (Python)",
    path: "apps/station/music/select_tracks.py",
    formato: "python",
    risk: "medio",
    tier: "script",
    nota: "Chamado pelo build de cada programa. Um erro de Python quebra os builds de música. Decide que candidatos entram nas pools (ytmusicapi sem auth).",
    conteudo: `REGION_DENY = ["hindi", "bollywood", "k-pop", "türkçe"]

def collect(genre, alts, n, country="PT"):
    # search(filter='playlists') → get_playlist (fonte principal)
    # fallback: search(songs) e get_charts
    ...
`,
  },
];

// MOCK parcial: week e resumo são agora computados dinamicamente em
// getJobsData(); runs são construídas a partir de sinais reais quando possível.
const MOCK_PARTIAL = {
  jobs: JOBS,
  scripts: SCRIPTS,
};

export async function getJobsData(): Promise<JobsData> {
  // Ligação REAL para week/resumo/jobs/runs; scripts parciais.
  //   • week + resumo → computados dinamicamente a partir do relógio de Lisboa
  //     e das definições dos JOBS agendados.
  //   • runs → construídas a partir de sinais reais (news-state.json, manifest.json,
  //     .daily.log) + próximas ocorrências agendadas. MOCK só se não há sinais.
  //   • scripts.conteudo → excerto da cabeça do ficheiro do apps/station.
  //   • jobs[].ultimaExec/Estado → news-generate e music-daily-refresh reais.
  const [news, manifest, newsFileStat, dailyLog] = await Promise.all([
    getNewsState(),
    getMusicManifest(),
    statStationFile("build/news-state.json"),
    readStationFile("music/.daily.log"),
  ]);

  // ── scripts — sobrepõe SÓ `conteudo` com a cabeça real do ficheiro; qualquer
  // falha de leitura (null) degrada ao excerto mock. Ficheiro vazio real → "" (o
  // `??` só cai no mock em null, por isso mostra o vazio honesto).
  const scripts: EditableScript[] = await Promise.all(
    SCRIPTS.map(async (s) => {
      const rel = s.path.replace(/^apps\/station\//, "");
      const head = await readStationFileHead(rel, 1400);
      return { ...s, conteudo: head ?? s.conteudo };
    }),
  );

  // ── jobs — sobrepõe a última execução SÓ onde há sinal real; caso contrário
  // mantém os campos do MOCK intactos.
  const jobs: JobDef[] = JOBS.map((j) => {
    if (j.key === "news-generate" && news?.at) {
      return {
        ...j,
        ultimaExec: relativeFromNow(news.at),
        ultimoEstado: "concluido",
        ultimoResultado: `${news.count ?? "?"} manchetes`,
      };
    }
    if (j.key === "music-daily-refresh" && manifest?.updatedAt) {
      // ultimoResultado fica o do MOCK (o manifest não traz métricas do refresh).
      return { ...j, ultimaExec: relativeFromNow(manifest.updatedAt), ultimoEstado: "concluido" };
    }
    return j;
  });

  // ── week + resumo — computados a partir do relógio de Lisboa e sinais reais.
  const now = lisbonNow();
  const todayISO = lisbonDateISO(now.ms);

  // Sinal real para news-generate: mtime do news-state.json É de hoje?
  let newsRanTodayAt: number | null = null;
  if (newsFileStat) {
    const mtimeDay = lisbonDateISO(newsFileStat.mtimeMs);
    if (mtimeDay === todayISO) newsRanTodayAt = newsFileStat.mtimeMs;
  }

  // Sinal real para music-daily-refresh: updatedAt do manifest É de hoje?
  let musicRanTodayAt: number | null = null;
  if (manifest?.updatedAt) {
    const updDay = lisbonDateISO(manifest.updatedAt);
    if (updDay === todayISO) musicRanTodayAt = Date.parse(manifest.updatedAt);
  }

  const week = buildWeek(now, { newsRanTodayAt, musicRanTodayAt });
  const resumo = buildResumo(week);

  // Runs: construídas a partir de sinais reais; fallback ao MOCK se vazias.
  const realRuns = buildRealRuns(news, manifest, dailyLog, now);
  const runs = realRuns.length > 0 ? realRuns : MOCK_RUNS;

  return { resumo, jobs, week, runs, scripts };
}
