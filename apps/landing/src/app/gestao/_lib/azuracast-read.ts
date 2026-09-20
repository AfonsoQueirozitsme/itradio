// Leituras REAIS (read-only) da estação — a fundação partilhada pelos seams do
// /gestao. É SERVER-ONLY por convenção: vive em _lib (prefixo "_" → nunca vira
// rota) e usa next/headers + node:fs; NUNCA importar a partir de um componente
// "use client" (não há pacote `server-only` instalado, por isso a convenção é a
// barreira — igual ao auth.ts/config.ts).
//
// Duas fontes, uma regra:
//   • AzuraCast HTTP — reutiliza a SESSÃO do operador (cookie SSO reencaminhado
//     cru para localhost), o mesmo mecanismo do auth.ts. Só GET, no-store,
//     redirect:"manual", timeout curto. Zero segredos no bundle (sem Bearer key).
//   • Ficheiros runtime do apps/station (manifest/rotação/injector/news-state) —
//     lidos do disco do próprio host (mesmo utilizador itradio), FORA do checkout
//     da landing.
//
// REGRA DE OURO (dados): qualquer falha → devolve null / cai no valor por defeito.
// Um seam faz `const x = await getX(); return x ? mapReal(x) : MOCK` — os dados
// NUNCA deitam a página abaixo, NUNCA fazem 500, NUNCA redirecionam. (Só o GATE
// de auth, no auth.ts, é que transforma "sem sessão" em redirect.)

import { cache } from "react";
import { headers } from "next/headers";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AZURACAST_BASE_URL,
  AZ_PROBE_TIMEOUT_MS,
  AZ_STATION_ID,
  AZ_SHORTCODE,
  ITFM_STATION_DIR,
} from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// AzuraCast HTTP (cookie-forward)
// ─────────────────────────────────────────────────────────────────────────────

// GET a uma rota da API do AzuraCast reencaminhando o cookie de sessão cru do
// browser. Só GET → a sessão basta, sem X-API-CSRF. NUNCA enviamos Authorization
// (isso saltaria para o caminho da Bearer key). redirect:"manual" para nunca
// tratar um eventual 302→login como sucesso. Exportado porque o auth.ts o usa
// como sonda de sessão (fonte única). Em falha/timeout → null (fail-closed).
export async function azProbe(apiPath: string, cookie: string): Promise<Response | null> {
  try {
    return await fetch(`${AZURACAST_BASE_URL}${apiPath}`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(AZ_PROBE_TIMEOUT_MS),
    });
  } catch {
    // AzuraCast indisponível / timeout → trata como indisponível (fail-closed).
    return null;
  }
}

// Cookie do pedido atual, memoizado por render (React cache): layout + página
// partilham uma só leitura. Sem cookie (ex.: dev sem sessão) → null.
const requestCookie = cache(async (): Promise<string | null> => {
  try {
    return (await headers()).get("cookie");
  } catch {
    return null;
  }
});

// GET+JSON a uma rota do AzuraCast com a sessão do operador. Memoizado por PATH
// por render (o AbortSignal desliga a memoização nativa do fetch, por isso a
// nossa cache() é o que evita sondar a mesma rota duas vezes num render).
// Sem cookie → null (least-privilege: sem sessão, sem leitura). Qualquer
// não-200 ou erro de parse → null. NUNCA atira.
const _azGet = cache(async (apiPath: string): Promise<unknown | null> => {
  const cookie = await requestCookie();
  if (!cookie) return null;
  const res = await azProbe(apiPath, cookie);
  if (!res || res.status !== 200) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
});

export async function azGet<T>(apiPath: string): Promise<T | null> {
  return (await _azGet(apiPath)) as T | null;
}

// ── Tipos mínimos das respostas do AzuraCast (só os campos que consumimos) ────

export type AzSong = {
  id?: string;
  text?: string;
  artist?: string;
  title?: string;
  album?: string;
  genre?: string;
  art?: string;
};

export type AzSpin = {
  sh_id?: number;
  played_at?: number; // epoch s
  cued_at?: number; // epoch s
  duration?: number; // s (pode ser fracionário)
  playlist?: string;
  is_request?: boolean;
  streamer?: string;
  elapsed?: number; // s (só now_playing)
  remaining?: number; // s (só now_playing)
  song?: AzSong;
};

export type AzNowPlaying = {
  station?: { id?: number; name?: string; shortcode?: string; timezone?: string };
  listeners?: { total?: number; unique?: number; current?: number };
  live?: { is_live?: boolean; streamer_name?: string; broadcast_start?: number | null };
  now_playing?: AzSpin;
  playing_next?: AzSpin | null;
  song_history?: AzSpin[];
};

// GET /api/station/{id}/schedule
export type AzScheduleItem = {
  id?: number;
  type?: string; // "playlist"
  name?: string;
  title?: string;
  description?: string;
  start_timestamp?: number; // epoch s
  start?: string; // ISO com offset de Lisboa (+01:00 / +00:00)
  end_timestamp?: number;
  end?: string;
  is_now?: boolean;
};

// GET /api/station/{id}/queue
export type AzQueueItem = {
  cued_at?: number;
  played_at?: number;
  duration?: number;
  playlist?: string;
  is_request?: boolean;
  song?: AzSong;
};

// GET /api/station/{id}/playlists (schedule_items em HHMM inteiro; days:[]=todos)
export type AzScheduleWindow = {
  id?: number;
  start_time?: number; // HHMM inteiro (700 = 07:00, 1302 = 13:02)
  end_time?: number;
  start_date?: string | null;
  end_date?: string | null;
  days?: number[]; // [] = todos os dias (1=Seg … 7=Dom no AzuraCast)
};

export type AzPlaylist = {
  id?: number;
  name?: string;
  is_enabled?: boolean;
  type?: string; // "default" | "once_per_hour" | "once_per_x_songs" | …
  source?: string; // "songs"
  num_songs?: number;
  schedule_items?: AzScheduleWindow[];
};

// reports/overview/charts → duas séries que consumimos:
//   • daily.metrics[0].data = [{x: epochMs, y: ouvintes}] — um ponto por dia.
//   • hourly.all.metrics[0].data = number[] — 24 valores; a HORA É o ÍNDICE (0–23),
//     com `labels` ["0:00"…"23:00"] em paralelo. NB: os pontos horários são
//     ESCALARES (não {x,y}, ao contrário do daily). Fonte: ChartsAction.php do
//     AzuraCast (categorias hourly: all + day0…day6; aqui só lemos `all`).
export type AzChartPoint = { x: number; y: number };
type AzChartMetric = { label?: string; data?: AzChartPoint[] };
type AzHourlyCategory = { labels?: string[]; metrics?: Array<{ label?: string; data?: number[] }> };
type AzOverviewCharts = {
  daily?: { metrics?: AzChartMetric[] };
  hourly?: { all?: AzHourlyCategory };
};

// ── Leitores tipados (cada um → T | null) ─────────────────────────────────────

export function getNowPlaying(): Promise<AzNowPlaying | null> {
  // Público, mas reencaminhamos a sessão à mesma (uniforme com as rotas admin).
  return azGet<AzNowPlaying>(`/api/nowplaying/${AZ_SHORTCODE}`);
}

export function getSchedule(rows = 12): Promise<AzScheduleItem[] | null> {
  return azGet<AzScheduleItem[]>(`/api/station/${AZ_STATION_ID}/schedule?rows=${rows}`);
}

export function getQueue(): Promise<AzQueueItem[] | null> {
  return azGet<AzQueueItem[]>(`/api/station/${AZ_STATION_ID}/queue`);
}

export function getPlaylists(): Promise<AzPlaylist[] | null> {
  return azGet<AzPlaylist[]>(`/api/station/${AZ_STATION_ID}/playlists`);
}

export function getHistory(startISO?: string, endISO?: string): Promise<AzSpin[] | null> {
  const params: string[] = [];
  if (startISO) params.push(`start=${startISO}`);
  if (endISO) params.push(`end=${endISO}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  return azGet<AzSpin[]>(`/api/station/${AZ_STATION_ID}/history${qs}`);
}

// Normaliza um nome de playlist para casar de forma robusta com o AzuraCast:
// sem acentos, minúsculas, espaços colapsados. "Música Boot Matinal" casa com
// "musica  boot matinal". (Os nomes reais devem ser iguais aos do deployer, mas
// isto tolera divergências de acento/espaço sem partir a derivação de estado.)
export function normalizePlaylistName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Encontra uma playlist do AzuraCast por nome (match normalizado). undefined se
// a lista vier null/vazia ou não houver correspondência (→ o seam degrada).
export function findPlaylistByName(
  playlists: AzPlaylist[] | null | undefined,
  name: string,
): AzPlaylist | undefined {
  if (!Array.isArray(playlists)) return undefined;
  const alvo = normalizePlaylistName(name);
  return playlists.find(
    (p) => typeof p.name === "string" && normalizePlaylistName(p.name) === alvo,
  );
}

// Série DIÁRIA de ouvintes (últimos 7 dias) — [{x: epochMs, y}]. Com ~0 ouvintes
// vem tudo a zero (estado real honesto). null só em falha de leitura.
export async function getListenerDaily(): Promise<AzChartPoint[] | null> {
  const charts = await azGet<AzOverviewCharts>(
    `/api/station/${AZ_STATION_ID}/reports/overview/charts`,
  );
  const data = charts?.daily?.metrics?.[0]?.data;
  return Array.isArray(data) ? data : null;
}

// Série HORÁRIA de ouvintes de HOJE (Lisboa) — array de 24 números, ÍNDICE = hora
// (0–23). Pedimos explicitamente o intervalo de HOJE (start=end=dia de Lisboa): o
// AzuraCast interpreta as datas no fuso da estação (Lisboa) e expande um `end` só
// com data até ao fim do dia, por isso um único dia devolve só hoje. Sem o
// parâmetro, o endpoint agrega as últimas 2 semanas (SOMA por hora) — não é o que
// "Ouvintes hoje" quer. Horas sem ouvintes vêm 0 (zero real honesto). null só em
// falha de leitura / forma inesperada. `dateISO` permite ancorar ao MESMO instante
// de Lisboa que o resto do render (evita corrida à meia-noite); default = hoje.
export async function getListenerHourlyToday(dateISO?: string): Promise<number[] | null> {
  const iso = dateISO ?? lisbonDateISO();
  if (!iso) return null;
  const charts = await azGet<AzOverviewCharts>(
    `/api/station/${AZ_STATION_ID}/reports/overview/charts?start=${iso}&end=${iso}`,
  );
  const data = charts?.hourly?.all?.metrics?.[0]?.data;
  return Array.isArray(data) ? data : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficheiros runtime do apps/station (lidos do disco do host)
// ─────────────────────────────────────────────────────────────────────────────

// Candidatos à raiz do apps/station. itfm-web corre com cwd=apps/landing (npm
// workspace `--workspace @it-radio/landing`); no repo, os dois apps são irmãos.
// Em dev (Mac) o cwd também é apps/landing. O primeiro que exista ganha.
const STATION_DIR_CANDIDATES = [
  ITFM_STATION_DIR,
  path.resolve(process.cwd(), "../station"),
  path.resolve(process.cwd(), "apps/station"),
  "/home/itradio/itradio/apps/station",
].filter((p): p is string => typeof p === "string" && p.length > 0);

// Resolve (uma vez por render) a raiz do apps/station testando os candidatos.
const resolveStationDir = cache(async (): Promise<string | null> => {
  for (const dir of STATION_DIR_CANDIDATES) {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) return dir;
    } catch {
      // continua para o próximo candidato
    }
  }
  return null;
});

// Lê um ficheiro do apps/station por caminho relativo (ex.: "build-music/
// manifest.json"). Falha (dir/ficheiro ausente, sem permissão) → null.
export async function readStationFile(relPath: string): Promise<string | null> {
  const base = await resolveStationDir();
  if (!base) return null;
  try {
    return await fs.readFile(path.join(base, relPath), "utf8");
  } catch {
    return null;
  }
}

// Lê + faz JSON.parse de um ficheiro do apps/station. Qualquer falha → null.
export async function readStationJson<T>(relPath: string): Promise<T | null> {
  const raw = await readStationFile(relPath);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Lista ficheiros de um diretório do apps/station (nomes, não caminhos). Falha → [].
export async function listStationDir(relPath: string): Promise<string[]> {
  const base = await resolveStationDir();
  if (!base) return [];
  try {
    return await fs.readdir(path.join(base, relPath));
  } catch {
    return [];
  }
}

// stat de um ficheiro do apps/station (mtime + tamanho). Ausente/erro → null.
// Usado para "última atualização" a partir do mtime (ex.: backup do injector).
export async function statStationFile(
  relPath: string,
): Promise<{ mtimeMs: number; size: number } | null> {
  const base = await resolveStationDir();
  if (!base) return null;
  try {
    const st = await fs.stat(path.join(base, relPath));
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

// Lista um diretório do apps/station com mtime/tamanho por FICHEIRO (ignora
// subdiretórios e entradas ilegíveis). Falha → []. Útil para achar o mais
// recente de um padrão (ex.: build/custom_config.backup-*.liq do injector).
export async function listStationDirStats(
  relPath: string,
): Promise<Array<{ name: string; mtimeMs: number; size: number }>> {
  const base = await resolveStationDir();
  if (!base) return [];
  try {
    const names = await fs.readdir(path.join(base, relPath));
    const out: Array<{ name: string; mtimeMs: number; size: number }> = [];
    for (const name of names) {
      try {
        const st = await fs.stat(path.join(base, relPath, name));
        if (st.isFile()) out.push({ name, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // ignora entradas ilegíveis
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Primeiros `maxChars` de um ficheiro do apps/station — para EXCERTOS de scripts
// na UI (Jobs). São ficheiros de código/config de um repo PÚBLICO; nunca ler
// .env aqui. Ausente/erro → null; excerto truncado ganha um "…" no fim.
export async function readStationFileHead(
  relPath: string,
  maxChars = 1200,
): Promise<string | null> {
  const raw = await readStationFile(relPath);
  if (raw == null) return null;
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n…` : raw;
}

// Formas dos ficheiros runtime que consumimos ──────────────────────────────────

// build-music/manifest.json — estado do serviço de música (pools por programa).
export type MusicManifestTrack = {
  videoId?: string;
  title?: string;
  artist?: string;
  dur?: number; // segundos (fracionário)
  slug?: string;
};
export type MusicManifest = {
  music?: Record<string, string[]>; // slug → ["musica/<slug>/<videoId>.mp3", …]
  tracks?: Record<string, MusicManifestTrack>; // path → meta
  updatedAt?: string; // ISO (UTC)
};

// music/.rotation.json — recência por faixa: slug → { videoId → {title,artist,at,path} }.
export type RotationTrack = { title?: string; artist?: string; at?: string; path?: string };
export type RotationState = Record<string, Record<string, RotationTrack>>;

// build/news-state.json — último estado do gerador de notícias.
export type NewsState = { hash?: string; at?: string; count?: number; totalChars?: number };

export function getMusicManifest(): Promise<MusicManifest | null> {
  return readStationJson<MusicManifest>("build-music/manifest.json");
}

export function getRotationState(): Promise<RotationState | null> {
  return readStationJson<RotationState>("music/.rotation.json");
}

export function getNewsState(): Promise<NewsState | null> {
  return readStationJson<NewsState>("build/news-state.json");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tempo de Lisboa (DST-aware via Intl; host/container em UTC)
// ─────────────────────────────────────────────────────────────────────────────
//
// Todos os campos-relógio do contrato dos seams são de Lisboa (Europe/Lisbon).
// Computamos SEMPRE no servidor e passamos o valor já resolvido para o cliente
// (a UI recalcula "emMin" a partir desta âncora determinística) → sem mismatch
// de hidratação. Nunca usar Date.now() no cliente para isto.

const LISBON_TZ = "Europe/Lisbon";

export type LisbonClock = {
  hour: number; // 0–23
  minute: number; // 0–59
  hhmm: number; // HHMM inteiro (comparável com schedule_items do AzuraCast)
  minutesOfDay: number; // hour*60+minute
  weekday: number; // 1=Seg … 7=Dom (ISO)
  clock: string; // "HH:MM"
  ms: number; // epoch ms do instante ancorado
};

const lisbonParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LISBON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: wdMap[get("weekday")] ?? 1,
  };
};

// Relógio de Lisboa AGORA (ou num instante dado). Server-side.
export function lisbonNow(at?: Date | number): LisbonClock {
  const d = at == null ? new Date() : typeof at === "number" ? new Date(at) : at;
  const { hour, minute, weekday } = lisbonParts(d);
  return {
    hour,
    minute,
    hhmm: hour * 100 + minute,
    minutesOfDay: hour * 60 + minute,
    weekday,
    clock: `${pad2(hour)}:${pad2(minute)}`,
    ms: d.getTime(),
  };
}

// "HH:MM" de Lisboa a partir de um epoch (s ou ms) ou ISO/Date.
// Data inválida (string não parseável, etc.) → "" (NUNCA atira → regra de ouro:
// nenhum campo derivado deste helper pode deitar um seam abaixo com um 500).
export function toLisbonClock(input: number | string | Date, unit: "s" | "ms" = "ms"): string {
  const d =
    typeof input === "number"
      ? new Date(unit === "s" ? input * 1000 : input)
      : typeof input === "string"
        ? new Date(input)
        : input;
  if (Number.isNaN(d.getTime())) return "";
  const { hour, minute } = lisbonParts(d);
  return `${pad2(hour)}:${pad2(minute)}`;
}

// "YYYY-MM-DD HH:MM" de Lisboa (para "última atualização" legível).
// Data inválida → "" (NUNCA atira — ver toLisbonClock).
export function toLisbonStamp(input: number | string | Date, unit: "s" | "ms" = "ms"): string {
  const d =
    typeof input === "number"
      ? new Date(unit === "s" ? input * 1000 : input)
      : typeof input === "string"
        ? new Date(input)
        : input;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LISBON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// "YYYY-MM-DD" (dia de Lisboa) de um instante — default AGORA. (No runtime da
// app `new Date()` é permitido; a proibição de Date.now()/new Date() é só nos
// scripts de workflow.) Base para carimbos de "próximo rebuild"/agenda.
export function lisbonDateISO(input?: number | string | Date, unit: "s" | "ms" = "ms"): string {
  const d =
    input == null
      ? new Date()
      : typeof input === "number"
        ? new Date(unit === "s" ? input * 1000 : input)
        : typeof input === "string"
          ? new Date(input)
          : input;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LISBON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Avança `days` numa data "YYYY-MM-DD" via aritmética UTC ao MEIO-DIA. Ancorar ao
// meio-dia (não à meia-noite) garante que somar N·24 h em ms nunca cruza um limite
// de dia por engano → imune ao DST de Lisboa (dias de 23 h/25 h nas mudanças de
// hora). Usar isto em vez de `now.ms + 86_400_000` para saltar de dia de calendário.
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Carimbo "YYYY-MM-DD HH:MM" (Lisboa) da PRÓXIMA ocorrência de uma hora diária
// (ex.: 05:00 do refresh de música). Se já passou hoje → amanhã. Determinístico
// a partir do relógio de Lisboa ancorado no servidor. O salto para "amanhã" é feito
// no dia de CALENDÁRIO (addDaysISO), não somando 24 h em ms → correto no DST.
export function proximaOcorrenciaDiariaStamp(hour: number, minute = 0): string {
  const now = lisbonNow();
  const alvoMin = hour * 60 + minute;
  const hoje = lisbonDateISO(now.ms);
  const dia = now.minutesOfDay < alvoMin ? hoje : addDaysISO(hoje, 1);
  return `${dia} ${pad2(hour)}:${pad2(minute)}`;
}

// "há 20 h" / "há 5 min" / "agora mesmo" a partir de um instante passado.
export function relativeFromNow(input: number | string | Date, unit: "s" | "ms" = "ms"): string {
  const then =
    typeof input === "number"
      ? unit === "s"
        ? input * 1000
        : input
      : typeof input === "string"
        ? Date.parse(input)
        : input.getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

// "mm:ss" a partir de segundos.
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
