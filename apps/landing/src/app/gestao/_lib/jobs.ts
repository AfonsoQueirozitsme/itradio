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
  readStationFileHead,
  relativeFromNow,
  statStationFile,
  lisbonNow,
  lisbonDateISO,
  addDaysISO,
  pad2,
  type LisbonClock,
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

  // Se temos sinal real de news hoje, marca a última ocorrência passada como
  // "concluido" explicitamente (o sinal confirma que o job correu). Se o sinal
  // NÃO existe para a hora corrente (dentro de ~15 min após a hora agendada),
  // essa ocorrência fica "a_correr" em vez de "concluido".
  if (signals.newsRanTodayAt) {
    const todayDay = days.find((d) => d.hoje);
    if (todayDay) {
      // Encontra a hora do sinal no horário de Lisboa
      const signalClock = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(signals.newsRanTodayAt));
      const signalHour = Number(signalClock);

      // A ocorrência de news mais recente cujo sinal confirma
      const newsOccs = todayDay.ocorrencias.filter((o) => o.jobKey === "news-generate");
      for (const occ of newsOccs) {
        const occHour = Number(occ.hora.split(":")[0]);
        if (occHour <= signalHour && occ.estado !== "agendado") {
          occ.estado = "concluido";
        }
      }

      // Se existe uma ocorrência de news cuja hora JA PASSOU mas cujo sinal
      // de hora exacta nao bate (i.e. entre a hora agendada e a hora agendada
      // +15 min, e o sinal nao cobriu esta hora), marca como "a_correr".
      for (const occ of newsOccs) {
        const occHour = Number(occ.hora.split(":")[0]);
        const occMin = occHour * 60 + NEWS_MINUTE;
        // Janela: se estamos dentro de 15 min apos a hora e o sinal nao cobre
        if (
          now.minutesOfDay >= occMin &&
          now.minutesOfDay < occMin + 15 &&
          occHour > signalHour
        ) {
          occ.estado = "a_correr";
        }
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

// ── Execuções (histórico + a decorrer + agendadas) ──────────────────────────
const RUNS: JobRun[] = [
  {
    id: "run-deploy-tarde",
    jobKey: "music-deploy",
    nome: "Deploy de pool · Pause & Play",
    estado: "a_correr",
    gatilho: "manual",
    inicio: "hoje 14:02:03",
    fim: null,
    duracao: null,
    pedido: [
      { label: "Programa", valor: "Pause & Play (tomas_rocha)" },
      { label: "Faixas novas", valor: "6" },
      { label: "Teto (poolCap)", valor: "60" },
      { label: "Modo", valor: "--yes (aplicar)" },
    ],
    resultado: null,
    passos: [
      { label: "Upload das 6 faixas novas", estado: "concluido", detalhe: "in-place · md5 verificado" },
      { label: "Atribuir à playlist 'Música Pause & Play'", estado: "a_correr" },
      { label: "Rotação com teto (retirar 6 antigas)", estado: "pendente" },
      { label: "Concluir (sem restart)", estado: "pendente" },
    ],
    log: [
      "14:02:03  deploy tomas_rocha — manifest: 60 faixas",
      "14:02:05  upload 1/6  heat-waves.mp3  ok",
      "14:02:07  upload 6/6  the-less-i-know.mp3  ok",
      "14:02:08  assign → playlist 'Música Pause & Play' …",
    ],
  },
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
  {
    id: "music-3-05",
    jobKey: "music-daily-refresh",
    nome: "Refresh diário da música",
    estado: "concluido",
    gatilho: "systemd (auto)",
    inicio: "hoje 05:03:00",
    fim: "hoje 07:01:12",
    duracao: "1h58",
    pedido: [
      { label: "Programas", valor: "6 (ordem de janela)" },
      { label: "Alvo", valor: "AzuraCast localhost · in-place" },
    ],
    resultado: [
      { label: "Programas ok", valor: "6 / 6" },
      { label: "Falhas", valor: "0" },
      { label: "Faixas novas", valor: "36" },
      { label: "Restart", valor: "não (refresco in-place)" },
    ],
    passos: [
      { label: "Boot Matinal · build+deploy", estado: "concluido" },
      { label: "Ctrl+Alt+Ritmo · build+deploy", estado: "concluido" },
      { label: "Tuga Underground · build+deploy", estado: "concluido" },
      { label: "Pause & Play · build+deploy", estado: "concluido" },
      { label: "Hora de Ponta · build+deploy", estado: "concluido" },
      { label: "Modo Noturno · build+deploy", estado: "concluido" },
    ],
    log: [
      "05:03:00  daily-refresh — 6 programas",
      "05:41:00  goncalo_pires build: 3 downloads falharam (oversample cobriu)",
      "07:01:12  concluído — 6 ok, 0 falhas",
    ],
  },
  {
    id: "run-build-noite",
    jobKey: "music-build",
    nome: "Build de pool · Modo Noturno",
    estado: "falhou",
    gatilho: "sub-job (refresh)",
    inicio: "hoje 05:41:02",
    fim: "hoje 05:49:40",
    duracao: "8m38",
    pedido: [
      { label: "Programa", valor: "Modo Noturno (goncalo_pires)" },
      { label: "Género", valor: "R&B & soul / chill" },
      { label: "Alvo", valor: "poolSize 12 novas" },
    ],
    resultado: [
      { label: "Baixadas", valor: "9 / 12" },
      { label: "Falhas", valor: "3 (edge morto)" },
      { label: "Impacto", valor: "pool manteve tamanho (oversample)" },
    ],
    passos: [
      { label: "Selecionar trending (ytmusicapi)", estado: "concluido", detalhe: "12 candidatos" },
      { label: "Download yt-dlp", estado: "falhou", detalhe: "3× HTTP 403 / edge morto" },
      { label: "Normalizar -16 LUFS", estado: "concluido", detalhe: "9 faixas" },
    ],
    log: [
      "05:41:02  build goncalo_pires — 12 candidatos",
      "05:44:10  ERRO yt-dlp: 403 (candidato 4)",
      "05:46:22  ERRO yt-dlp: edge morto (candidato 7)",
      "05:49:40  build terminou com 9/12 (oversample cobriu o teto)",
    ],
  },
  {
    id: "news-3-16",
    jobKey: "news-generate",
    nome: "Notícias LIVE · 16:05",
    estado: "agendado",
    gatilho: "launchd (auto)",
    inicio: "hoje 16:05 (previsto)",
    fim: null,
    duracao: null,
    pedido: [
      { label: "Gate", valor: "GEN_HOURS 07·10·13·16·19·22 (Lisboa)" },
      { label: "Feeds", valor: "6 RSS pt-PT" },
      { label: "Manchetes", valor: "top 5 · ~700 car." },
      { label: "Guarda de quota", valor: "salta se EL < necessário + 50" },
    ],
    resultado: null,
    passos: [
      { label: "Aguardar janela 16:05", estado: "pendente" },
      { label: "Buscar feeds + montar guião", estado: "pendente" },
      { label: "TTS + normalizar + upload", estado: "pendente" },
    ],
    log: ["(ainda não corário — agendado para as 16:05 · launchd)"],
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
// getJobsData(); runs e scripts mantêm-se MOCK até à Fase B.
const MOCK_PARTIAL = {
  jobs: JOBS,
  runs: RUNS,
  scripts: SCRIPTS,
};

export async function getJobsData(): Promise<JobsData> {
  // Ligação PARCIAL → REAL para week/resumo/jobs; runs e scripts parciais.
  //   • week + resumo → computados dinamicamente a partir do relógio de Lisboa
  //     e das definições dos JOBS agendados; o sinal real (news-state.json mtime,
  //     manifest.json updatedAt) marca as últimas ocorrências como confirmadas.
  //   • scripts.conteudo → excerto da cabeça do ficheiro do apps/station (código
  //     /config de repo PÚBLICO — nunca .env; .rotation.json é estado, não segredo).
  //   • jobs[].ultimaExec/Estado → só news-generate (build/news-state.json) e
  //     music-daily-refresh (build-music/manifest.json → updatedAt). Os outros
  //     jobs ficam no MOCK.
  //   • runs → aguardam a FASE B (run-log dos scripts + journald).
  const [news, manifest, newsFileStat] = await Promise.all([
    getNewsState(),
    getMusicManifest(),
    statStationFile("build/news-state.json"),
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

  return { resumo, jobs, week, runs: MOCK_PARTIAL.runs, scripts };
}
