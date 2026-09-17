#!/usr/bin/env node
/**
 * Notícias LIVE automáticas da IT.FM.
 *
 * Gera um boletim de manchetes a partir de vários RSS pt-PT, com as DUAS vozes
 * clonadas da estação em co-locução (Ruben Mateus + Mariana Serrano), sobre a
 * news_bed, normalizado a -16 LUFS — e reescreve o mesmo media in-place no
 * AzuraCast (sem restart). Uma playlist "Notícias (live)" toca esse ficheiro de
 * hora a hora ao :30 durante o dia; a geração corre de 3 em 3h (cron) e o mesmo
 * ficheiro é reaproveitado por replay entre gerações — o guião é agnóstico à
 * hora exata (só usa manhã/tarde/noite). Poupa quota do ElevenLabs (plano tight).
 *
 * A receita de áudio (constantes, POLISH, TRIM, loudnorm 2-passagens, alimiter,
 * mp3 192k) é clonada de build-programacao.mjs para soar igual ao resto da estação.
 * O ffmpeg corre localmente (Mac) ou, no host (sem ffmpeg), via `docker exec` no
 * container azuracast.
 *
 * SUBCOMANDOS
 *   node news-live.mjs probe                 read-only: estação, media, playlists, feeds
 *   node news-live.mjs feeds                 read-only: monta o guião e mostra-o + projeção de quota (sem TTS)
 *   node news-live.mjs generate [--force] [--dry-run] [--out=f.mp3] [--stub]
 *                                            gera o boletim e reescreve o media (cron)
 *   node news-live.mjs setup [--yes]         cria/atualiza a playlist horária (:30) + 1 restart
 *
 * FLAGS
 *   --force     ignora o gate de hora (gera fora das horas de geração)
 *   --dry-run   monta + renderiza mas NÃO faz upload
 *   --out=PATH  grava uma cópia local do mp3
 *   --stub      não chama o ElevenLabs — sintetiza voz-placeholder (testa o áudio sem gastar quota)
 *   --slot=HH   força a parte-do-dia da saudação (default: hora de Lisboa atual)
 *
 * ENV (host, via apps/station/.env — NUNCA imprimir):
 *   AZURACAST_API_KEY (obrig.), AZURACAST_BASE_URL (def http://localhost),
 *   STATION_SHORTCODE (def it.fm), AZURACAST_CONTAINER (def azuracast),
 *   ELEVENLABS_API_KEY (obrig. p/ TTS), NEWS_VOICE_A/NEWS_VOICE_B (ids das vozes),
 *   NEWS_TTS_MODEL (def eleven_turbo_v2_5), NEWS_TOPN, NEWS_CHAR_BUDGET, NEWS_RENDER (local|docker).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, copyFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanItem, dedupe, selectItems, assembleScript, daypart } from "./format-news.mjs";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));

// ---------- receita de áudio (clonada de build-programacao.mjs) ----------
const BED = join(__dir, "audio", "beds", "news_bed.mp3");
const VOICE_VOL = 1.84;
const BED_VOL = 0.20;
const NEWS_BED_VOL = +(BED_VOL * 0.8).toFixed(3); // 0.16
const VOICE_GAP = 0.2;
const INTRO = 1.0;  // s de bed só, antes da voz (arranque musical)
const OUTRO = 1.6;  // s de bed só, no fim
const NORM = { I: -16, TP: -1.5, LRA: 11 };
const POLISH = "highpass=f=75,equalizer=f=3000:t=q:w=1.5:g=2,deesser=i=0.3:m=0.4:f=0.6,acompressor=threshold=-18dB:ratio=2:attack=10:release=150:makeup=1.5";
const TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse";

// ---------- config da estação/notícias ----------
const BASE = (process.env.AZURACAST_BASE_URL || process.env.STATION_API_URL || "http://localhost").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY || process.env.STATION_API_KEY;
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
const CT = process.env.AZURACAST_CONTAINER || "azuracast";

const EL_BASE = "https://api.elevenlabs.io";
const EL_KEY = process.env.ELEVENLABS_API_KEY;
const EL_MODEL = process.env.NEWS_TTS_MODEL || "eleven_turbo_v2_5";
const EL_OUTPUT = process.env.NEWS_EL_OUTPUT || "mp3_44100_128";
const EL_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true };
const VOICE_A = process.env.NEWS_VOICE_A || "6iLyA3NM0rJOTqGUUOHD"; // Ruben Mateus
const VOICE_B = process.env.NEWS_VOICE_B || "r5DKSFdPtvwu56hpUE0Z"; // Mariana Serrano
const modelCost = () => (/flash|turbo/i.test(EL_MODEL) ? 0.5 : 1);

const TOPN = intEnv("NEWS_TOPN", 5);
const CHAR_BUDGET = intEnv("NEWS_CHAR_BUDGET", 700);
const WITH_SUMMARY = /^(1|true|yes)$/i.test(process.env.NEWS_WITH_SUMMARY || "");

const MEDIA_PATH = "programas/noticias_live.mp3";
const PLAYLIST_NAME = "Notícias (live)";
const STATE = join(__dir, "build", "news-state.json");
const UA = "Mozilla/5.0 (compatible; ITFM-NewsBot/1.0; +https://itfm.live)";

// Geração de 3 em 3h; airing de hora a hora ao :30 (Lisboa), só de dia.
const GEN_HOURS = [7, 10, 13, 16, 19, 22];
const AIR_MINUTE = 30;
const AIR_HOURS = Array.from({ length: 22 - 7 + 1 }, (_, i) => 7 + i); // 7..22
const AIR_WINDOWS = AIR_HOURS.map((h) => [h * 100 + AIR_MINUTE, h * 100 + AIR_MINUTE + 9]);

// Fontes RSS pt-PT (rank = preferência p/ dedup; RTP é canónico).
const FEEDS = [
  { url: "https://www.rtp.pt/noticias/rss/pais",     source: "RTP País",     rank: 1 },
  { url: "https://www.rtp.pt/noticias/rss/mundo",    source: "RTP Mundo",    rank: 1 },
  { url: "https://www.rtp.pt/noticias/rss/economia", source: "RTP Economia", rank: 2 },
  { url: "https://www.rtp.pt/noticias/rss/desporto", source: "RTP Desporto", rank: 3 },
  { url: "https://www.rtp.pt/noticias/rss/cultura",  source: "RTP Cultura",  rank: 3 },
  { url: "https://pt.euronews.com/rss",              source: "Euronews",     rank: 2 },
];

function intEnv(k, d) { const n = parseInt(process.env[k] || "", 10); return Number.isFinite(n) ? n : d; }
function die(msg) { console.error(`ERRO: ${msg}`); process.exit(1); }
function needKey() { if (!KEY) die("AZURACAST_API_KEY em falta (. ~/itradio/apps/station/.env)"); }

// ---------- AzuraCast API ----------
const sched = (start, end) => ({ start_time: start, end_time: end, start_date: null, end_date: null, days: [], loop_once: false });

async function api(method, path, body, raw = false) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return raw ? text : (text ? JSON.parse(text) : null);
}
async function resolveSid() {
  let st = [];
  try { st = await api("GET", "/admin/stations"); } catch {}
  if (!Array.isArray(st) || !st.length) { try { st = await api("GET", "/stations"); } catch { st = []; } }
  const m = st.find((s) => s.short_name === SHORTCODE || s.shortcode === SHORTCODE) || st[0];
  if (!m) throw new Error(`estação ${SHORTCODE} não encontrada`);
  return m.id;
}
async function uploadInPlace(sid, rel, absMp3) {
  const b64 = (await readFile(absMp3)).toString("base64");
  await api("POST", `/station/${sid}/files`, { path: rel, file: b64 });
}

// ---------- feeds ----------
function unCdata(s) { const m = String(s).match(/<!\[CDATA\[([\s\S]*?)\]\]>/); return (m ? m[1] : s).trim(); }
function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? unCdata(m[1]) : "";
}
function parseFeed(xml, f) {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  return blocks.map((b) => ({
    title: tag(b, "title"),
    description: tag(b, "description") || tag(b, "content:encoded") || tag(b, "summary"),
    content: tag(b, "content:encoded"),
    category: tag(b, "category"),
    pubDate: tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published"),
    source: f.source, sourceRank: f.rank,
  }));
}
function detectEnc(buf, ct) {
  const head = buf.subarray(0, 200).toString("latin1").toLowerCase();
  const m = head.match(/encoding=["']([^"']+)["']/) || String(ct).toLowerCase().match(/charset=([^;]+)/);
  let e = (m ? m[1] : "utf-8").trim();
  if (["iso-8859-1", "latin1", "windows-1252", "iso8859-1"].includes(e)) e = "windows-1252";
  try { new TextDecoder(e); return e; } catch { return "utf-8"; }
}
async function fetchFeed(f) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(f.url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const xml = new TextDecoder(detectEnc(buf, res.headers.get("content-type") || "")).decode(buf);
    return parseFeed(xml, f);
  } finally { clearTimeout(t); }
}
async function gatherItems() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const raw = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else console.warn(`  ! feed falhou (${FEEDS[i].source}): ${r.reason?.message || r.reason}`);
  });
  const cleaned = raw.map(cleanItem).filter((it) => it.title && it.title.length >= 12);
  return dedupe(cleaned);
}

// ---------- ElevenLabs ----------
async function elQuota() {
  if (!EL_KEY) return null;
  try {
    const res = await fetch(`${EL_BASE}/v1/user/subscription`, { headers: { "xi-api-key": EL_KEY } });
    if (!res.ok) return null;
    const j = await res.json();
    return { used: j.character_count, limit: j.character_limit, remaining: j.character_limit - j.character_count };
  } catch { return null; }
}
async function tts(text, voiceId) {
  const res = await fetch(`${EL_BASE}/v1/text-to-speech/${voiceId}?output_format=${EL_OUTPUT}`, {
    method: "POST",
    headers: { "xi-api-key": EL_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: EL_SETTINGS, apply_text_normalization: "on" }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 200)}`); }
  return Buffer.from(await res.arrayBuffer());
}

// ---------- render (local ffmpeg OU docker exec) ----------
function renderMode() {
  const m = (process.env.NEWS_RENDER || "").toLowerCase();
  if (m === "local" || m === "docker") return m;
  return null; // auto (decidido em Work.init)
}
class Work {
  constructor() { this.mode = renderMode(); this.hostDir = null; this.ctDir = "/tmp/itfm-news"; }
  async init() {
    if (!this.mode) {
      this.mode = await exec("ffmpeg", ["-version"]).then(() => "local").catch(() => "docker");
    }
    this.hostDir = await mkdtemp(join(tmpdir(), "itfm-news-"));
    if (this.mode === "docker") await exec("docker", ["exec", CT, "sh", "-lc", `rm -rf ${this.ctDir} && mkdir -p ${this.ctDir}`]);
    return this.mode;
  }
  p(name) { return this.mode === "docker" ? `${this.ctDir}/${name}` : join(this.hostDir, name); }
  async put(name, data) {
    const hp = join(this.hostDir, name);
    if (Buffer.isBuffer(data)) await writeFile(hp, data); else await copyFile(data.src, hp);
    if (this.mode === "docker") await exec("docker", ["cp", hp, `${CT}:${this.ctDir}/${name}`]);
  }
  async pull(name, destHost) {
    if (this.mode === "docker") await exec("docker", ["cp", `${CT}:${this.ctDir}/${name}`, destHost]);
    else await copyFile(join(this.hostDir, name), destHost);
  }
  async ff(args) {
    const a = ["-y", "-hide_banner", "-loglevel", "error", ...args];
    return this.mode === "docker" ? exec("docker", ["exec", CT, "ffmpeg", ...a], { maxBuffer: 1 << 26 })
                                  : exec("ffmpeg", a, { maxBuffer: 1 << 26 });
  }
  async probeDur(name) {
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", this.p(name)];
    const { stdout } = this.mode === "docker"
      ? await exec("docker", ["exec", CT, "ffprobe", ...args]).catch(() => ({ stdout: "" }))
      : await exec("ffprobe", args).catch(() => ({ stdout: "" }));
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  async measureLoud(name) {
    const args = ["-hide_banner", "-nostats", "-i", this.p(name), "-af", `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:print_format=json`, "-f", "null", "-"];
    const { stderr } = this.mode === "docker"
      ? await exec("docker", ["exec", CT, "ffmpeg", ...args], { maxBuffer: 1 << 26 }).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }))
      : await exec("ffmpeg", args, { maxBuffer: 1 << 26 }).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
    const s = String(stderr), a = s.lastIndexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b < 0 || b < a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  }
  async normToWav(inName, outName) {
    const m = await this.measureLoud(inName);
    const ok = m && ["input_i", "input_tp", "input_lra", "input_thresh"].every((k) => Number.isFinite(parseFloat(m[k])));
    const af = ok
      ? `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      : `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}`;
    await this.ff(["-i", this.p(inName), "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", this.p(outName)]);
  }
  async cleanup() {
    try { await rm(this.hostDir, { recursive: true, force: true }); } catch {}
    if (this.mode === "docker") await exec("docker", ["exec", CT, "sh", "-lc", `rm -rf ${this.ctDir}`]).catch(() => {});
  }
}

// Renderiza o boletim: N clips de voz (já mp3) → trim → concat polido → bed contínua
// por baixo com intro/outro → -16 LUFS → alimiter → mp3 192k. Devolve o caminho local.
async function renderBulletin(segMp3s, outAbs) {
  const w = new Work();
  const mode = await w.init();
  try {
    await w.put("bed.mp3", { src: BED });
    // 1) stage + trim de cada clip de voz
    for (let i = 0; i < segMp3s.length; i++) {
      await w.put(`raw${i}.mp3`, segMp3s[i]);
      await w.ff(["-i", w.p(`raw${i}.mp3`), "-af", TRIM, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", w.p(`v${i}.wav`)]);
    }
    // 2) concat da voz (POLISH + volume + pausa uniforme entre segmentos)
    const N = segMp3s.length;
    const inputs = [];
    for (let i = 0; i < N; i++) inputs.push("-i", w.p(`v${i}.wav`));
    const parts = [], labels = [];
    for (let k = 0; k < N; k++) {
      const base = `[${k}:a]aresample=44100,aformat=channel_layouts=stereo,${POLISH},volume=${VOICE_VOL}`;
      if (VOICE_GAP > 0 && k < N - 1) { parts.push(`${base},apad=pad_dur=${VOICE_GAP}[v${k}]`); }
      else parts.push(`${base}[v${k}]`);
      labels.push(`[v${k}]`);
    }
    const voiceFilter = parts.join(";") + ";" + `${labels.join("")}concat=n=${N}:v=0:a=1,aresample=44100[out]`;
    await w.ff([...inputs, "-filter_complex", voiceFilter, "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", w.p("voice.wav")]);

    // 3) bed contínua por baixo, com intro/outro só-bed
    const D = await w.probeDur("voice.wav");
    const total = +(INTRO + D + OUTRO).toFixed(3);
    const introMs = Math.round(INTRO * 1000);
    const fo = Math.max(0, total - 1.4).toFixed(3);
    const bedFilter =
      `[0:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${introMs}|${introMs}[vd];` +
      `[1:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total},volume=${NEWS_BED_VOL},` +
      `afade=t=in:st=0:d=0.8,afade=t=out:st=${fo}:d=1.4[bd];` +
      `[vd][bd]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[out]`;
    await w.ff(["-i", w.p("voice.wav"), "-stream_loop", "-1", "-i", w.p("bed.mp3"),
      "-filter_complex", bedFilter, "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", w.p("body_raw.wav")]);

    // 4) normaliza a -16 LUFS
    await w.normToWav("body_raw.wav", "body_norm.wav");

    // 5) finaliza: alimiter de segurança + mp3 192k com metadata
    const fin = `[0:a]aresample=44100,aformat=channel_layouts=stereo[b0];[b0]concat=n=1:v=0:a=1,aresample=44100[cc];[cc]alimiter=limit=0.95[out]`;
    await w.ff(["-i", w.p("body_norm.wav"), "-filter_complex", fin, "-map", "[out]", "-map_metadata", "-1",
      "-metadata", "title=Notícias", "-metadata", "artist=IT.FM", "-c:a", "libmp3lame", "-b:a", "192k", w.p("out.mp3")]);

    await mkdir(dirname(outAbs), { recursive: true });
    await w.pull("out.mp3", outAbs);
    return { outAbs, durVoice: D, mode };
  } finally { await w.cleanup(); }
}

// voz-placeholder p/ testar o áudio sem gastar quota (--stub): ruído rosa suave.
async function stubVoice(seconds) {
  const w = new Work(); await w.init();
  try {
    const d = Math.max(1.2, Math.min(8, seconds));
    await w.ff(["-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.25:duration=${d.toFixed(2)}`,
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", w.p("stub.mp3")]);
    const tmp = join(tmpdir(), `itfm-stub-${Math.round(seconds * 1000)}-${process.pid}.mp3`);
    await w.pull("stub.mp3", tmp);
    return await readFile(tmp);
  } finally { await w.cleanup(); }
}

// ---------- estado (evita re-TTS quando o guião não mudou) ----------
async function loadState() { try { return JSON.parse(await readFile(STATE, "utf8")); } catch { return {}; } }
async function saveState(o) { await mkdir(dirname(STATE), { recursive: true }); await writeFile(STATE, JSON.stringify(o, null, 2)); }
async function sha(text) { const { createHash } = await import("node:crypto"); return createHash("sha256").update(text).digest("hex").slice(0, 16); }

function lisbonHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour12: false, hour: "2-digit" }).format(new Date()));
}

// ---------- monta o guião ----------
async function buildScript(hourLisbon) {
  const items = await gatherItems();
  const sel = selectItems(items, { topN: TOPN, maxPerCategory: 2, recencyHours: 12, nowMs: Date.now() });
  const variant = new Date().getUTCDate() % 2; // roda opener/closer por dia
  const scriptObj = assembleScript(sel, { hourLisbon, voiceA: VOICE_A, voiceB: VOICE_B, charBudget: CHAR_BUDGET, withSummary: WITH_SUMMARY, variant });
  return { items, sel, ...scriptObj };
}

function projectQuota(totalChars) {
  const cost = modelCost();
  const perGen = totalChars * cost;
  const monthly = perGen * GEN_HOURS.length * 30;
  return { cost, perGen, perDay: perGen * GEN_HOURS.length, monthly };
}

// ---------- subcomando: probe (read-only) ----------
async function cmdProbe() {
  needKey();
  const sid = await resolveSid();
  console.log(`estação id ${sid} · ${BASE} · Lisboa ${lisbonHour()}h · render=${renderMode() || "auto"}`);
  const files = await api("GET", `/station/${sid}/files`);
  const news = files.find((f) => f.path === MEDIA_PATH);
  console.log(`media "${MEDIA_PATH}": ${news ? `existe (id ${news.id ?? news.unique_id}, ${news.length || "?"}s)` : "NÃO existe (correr generate primeiro)"}`);
  const pls = await api("GET", `/station/${sid}/playlists`);
  const mine = pls.find((p) => p.name.toLowerCase() === PLAYLIST_NAME.toLowerCase());
  console.log(`playlist "${PLAYLIST_NAME}": ${mine ? `existe (id ${mine.id}, enabled=${mine.is_enabled})` : "NÃO existe"}`);
  console.log(`\nfeeds (${FEEDS.length}):`);
  const items = await gatherItems();
  console.log(`  → ${items.length} itens únicos após dedup`);
  const el = await elQuota();
  if (el) console.log(`\nElevenLabs: usados ${el.used}/${el.limit}  (restam ${el.remaining} créditos) · modelo ${EL_MODEL} (${modelCost()}/char)`);
  else console.log(`\nElevenLabs: quota indisponível (sem chave? só afeta TTS)`);
}

// ---------- subcomando: feeds (read-only preview do guião) ----------
async function cmdFeeds(argSlot) {
  const h = Number.isFinite(argSlot) ? argSlot : lisbonHour();
  const { sel, segments, text, totalChars, count } = await buildScript(h);
  console.log(`parte do dia: ${daypart(h)} · itens: ${count} (de ${sel.length} selecionados) · ${totalChars} chars\n`);
  const nameOf = (v) => (v === VOICE_A ? "Ruben " : v === VOICE_B ? "Mariana" : "??????");
  for (const s of segments) console.log(`  [${nameOf(s.voice)}] ${s.text}`);
  const q = projectQuota(totalChars);
  console.log(`\nquota: ${q.perGen} créditos/geração · ~${Math.round(q.perDay)}/dia · ~${Math.round(q.monthly)}/mês (${GEN_HOURS.length} gerações/dia, modelo ${EL_MODEL})`);
  const el = await elQuota();
  if (el) console.log(`plafond ElevenLabs: ${el.limit} créditos/mês · restam ${el.remaining} neste ciclo` + (q.monthly > el.limit ? `  ⚠️ projeção ACIMA do plafond` : `  ✅ dentro do plafond`));
}

// ---------- subcomando: generate ----------
async function cmdGenerate(flags) {
  const force = !!flags.force, dryRun = !!flags["dry-run"], stub = !!flags.stub;
  const outCopy = flags.out ? String(flags.out) : null;
  const h = Number.isFinite(+flags.slot) ? +flags.slot : lisbonHour();
  if (!dryRun) needKey();

  if (!force && !GEN_HOURS.includes(lisbonHour())) {
    console.log(`(${lisbonHour()}h Lisboa não é hora de geração ${JSON.stringify(GEN_HOURS)} — nada a fazer; usa --force para forçar)`);
    return;
  }

  console.log(`a montar guião (parte do dia: ${daypart(h)}) …`);
  const { sel, segments, text, totalChars, count } = await buildScript(h);
  if (!count) die("sem itens de notícias (feeds vazios?) — mantém o ficheiro atual");
  console.log(`  ${count} manchetes · ${totalChars} chars · ${segments.length} segmentos (2 vozes)`);

  // salta re-TTS se o guião não mudou
  const hash = await sha(text);
  const st = await loadState();
  const sid = await (dryRun ? Promise.resolve(null) : resolveSid());
  if (!force && st.hash === hash && !outCopy) {
    console.log(`  guião idêntico ao último (${hash}) — salta TTS (ficheiro no ar mantém-se)`);
    return;
  }

  // guarda de quota
  if (!stub) {
    if (!EL_KEY) die("ELEVENLABS_API_KEY em falta (necessária p/ TTS; usa --stub p/ testar só o áudio)");
    const el = await elQuota();
    const need = Math.ceil(totalChars * modelCost());
    if (el && el.remaining < need + 50) {
      console.warn(`  ⚠️ quota insuficiente: precisa ~${need}, restam ${el.remaining} — NÃO gera (mantém o ficheiro atual)`);
      return;
    }
    if (el) console.log(`  quota ok: ~${need} créditos, restam ${el.remaining}`);
  }

  // TTS por segmento (co-locução), ou stub
  console.log(`  ${stub ? "stub (sem TTS)" : `TTS ${EL_MODEL}`} …`);
  const clips = [];
  for (const s of segments) {
    if (stub) clips.push(await stubVoice(s.text.length / 14));
    else clips.push(await tts(s.text, s.voice));
  }

  // render
  const outAbs = outCopy || join(__dir, "build", "noticias_live.mp3");
  console.log(`  render (${renderMode() || "auto"}) → ${outAbs}`);
  const { durVoice, mode } = await renderBulletin(clips, outAbs);
  const loud = await measureFile(outAbs, mode);
  console.log(`  ✓ boletim: voz ~${durVoice.toFixed(1)}s · I=${loud?.I ?? "?"} LUFS · TP=${loud?.TP ?? "?"} dBTP`);

  if (dryRun) { console.log("  (dry-run — sem upload)"); return; }

  await uploadInPlace(sid, MEDIA_PATH, outAbs);
  // verifica
  const files = await api("GET", `/station/${sid}/files`);
  const f = files.find((x) => x.path === MEDIA_PATH);
  console.log(`  ✓ upload in-place: ${MEDIA_PATH}${f ? ` (id ${f.id ?? f.unique_id})` : ""} — sem restart`);
  await saveState({ hash, at: new Date().toISOString(), count, totalChars });
}

// mede loudness de um mp3 local (mac) ou copia p/ container? — usamos ffmpeg do mesmo modo do render.
async function measureFile(absMp3, mode) {
  const args = ["-hide_banner", "-nostats", "-i", absMp3, "-af", `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:print_format=json`, "-f", "null", "-"];
  let stderr = "";
  if (mode === "docker") {
    // copia o resultado p/ o container só p/ medir
    const dst = `/tmp/itfm-measure-${process.pid}.mp3`;
    await exec("docker", ["cp", absMp3, `${CT}:${dst}`]).catch(() => {});
    const r = await exec("docker", ["exec", CT, "ffmpeg", "-hide_banner", "-nostats", "-i", dst, "-af", `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:print_format=json`, "-f", "null", "-"], { maxBuffer: 1 << 26 }).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
    stderr = String(r.stderr || "");
    await exec("docker", ["exec", CT, "rm", "-f", dst]).catch(() => {});
  } else {
    const r = await exec("ffmpeg", args, { maxBuffer: 1 << 26 }).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
    stderr = String(r.stderr || "");
  }
  const a = stderr.lastIndexOf("{"), b = stderr.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try { const j = JSON.parse(stderr.slice(a, b + 1)); return { I: parseFloat(j.input_i), TP: parseFloat(j.input_tp), LRA: parseFloat(j.input_lra) }; } catch { return null; }
}

// ---------- subcomando: setup (cria a playlist horária + 1 restart) ----------
async function cmdSetup(yes) {
  needKey();
  const sid = await resolveSid();
  console.log(`estação id ${sid} · ${BASE}${yes ? "" : "  (DRY-RUN — usa --yes para aplicar + restart)"}`);
  const files = await api("GET", `/station/${sid}/files`);
  if (!files.find((f) => f.path === MEDIA_PATH)) die(`media "${MEDIA_PATH}" não existe — corre primeiro: node news-live.mjs generate --force`);

  const pls = await api("GET", `/station/${sid}/playlists`);
  const existing = pls.find((p) => p.name.toLowerCase() === PLAYLIST_NAME.toLowerCase());
  const winList = AIR_WINDOWS.map((w) => sched(w[0], w[1]));

  // avisa colisões :30 com outras playlists agendadas
  const collide = [];
  for (const p of pls) {
    if (existing && p.id === existing.id) continue;
    for (const si of p.schedule_items || []) {
      if (si.start_time % 100 === AIR_MINUTE && AIR_HOURS.includes(Math.floor(si.start_time / 100))) collide.push(`${p.name} @ ${si.start_time}`);
    }
  }
  console.log("\nplano:");
  console.log(`  · playlist "${PLAYLIST_NAME}" (single_track) — ${winList.length} janelas ${AIR_HOURS[0]}:${AIR_MINUTE}–${AIR_HOURS[AIR_HOURS.length - 1]}:${AIR_MINUTE}${existing ? ` [existe→atualiza id ${existing.id}]` : " [nova]"}`);
  console.log(`  · atribui "${MEDIA_PATH}" à playlist`);
  console.log(`  · restart do backend (liquidsoap) — necessário p/ a nova agenda`);
  if (collide.length) console.log(`  ⚠️ colisões :${AIR_MINUTE} com: ${collide.join(", ")}`);
  if (!yes) { console.log("\n(dry-run — nada alterado)"); return; }

  let plId = existing?.id;
  if (!plId) {
    const pl = await api("POST", `/station/${sid}/playlists`, {
      name: PLAYLIST_NAME, type: "default", source: "songs", order: "sequential",
      is_jingle: false, is_enabled: true, backend_options: ["single_track"], avoid_duplicates: false,
      schedule_items: winList,
    });
    plId = pl.id;
    console.log(`\n  + "${PLAYLIST_NAME}" (id ${plId})`);
  } else {
    await api("PUT", `/station/${sid}/playlist/${plId}`, { is_enabled: true, backend_options: ["single_track"], schedule_items: winList });
    console.log(`\n  ~ "${PLAYLIST_NAME}" (id ${plId}) atualizada`);
  }
  await api("PUT", `/station/${sid}/files/batch`, { do: "playlist", playlists: [String(plId)], files: [MEDIA_PATH], dir: "" });
  console.log(`  ✓ "${MEDIA_PATH}" → "${PLAYLIST_NAME}"`);
  console.log("\n  restart do backend…");
  await api("POST", `/station/${sid}/restart`);
  console.log("  ✓ backend reiniciado — notícias live ao :30, de hora a hora, durante o dia.");
}

// ---------- main ----------
function parseArgs(argv) {
  const mode = argv[0] || "probe";
  const flags = {};
  for (const t of argv.slice(1)) {
    if (t.startsWith("--")) { const [k, v] = t.slice(2).split("="); flags[k] = v === undefined ? true : v; }
  }
  return { mode, flags };
}
async function main() {
  const { mode, flags } = parseArgs(process.argv.slice(2));
  if (!existsSync(BED)) die(`bed não encontrada: ${BED}`);
  if (mode === "probe") return cmdProbe();
  if (mode === "feeds") return cmdFeeds(+flags.slot);
  if (mode === "generate") return cmdGenerate(flags);
  if (mode === "setup") return cmdSetup(!!flags.yes);
  console.error("Uso: node news-live.mjs <probe|feeds|generate|setup> [flags]  (ver cabeçalho)");
  process.exit(2);
}
main().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });
