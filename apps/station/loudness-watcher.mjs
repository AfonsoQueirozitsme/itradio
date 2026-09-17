#!/usr/bin/env node
/**
 * Vigia de decibéis / normalização de loudness do IT.FM.
 *
 * "Faz tudo soar claro": mede o loudness (EBU R128) de cada áudio, calcula o
 * ganho preciso para o alvo e — em modo apply — grava esse ganho como o campo
 * `amplify` (dB) de cada ficheiro no AzuraCast (aplicado por play, sem restart).
 * Também amostra o stream ao vivo para registar o que realmente vai para o ar.
 *
 * Alvo: loudness integrado alvo (LUFS) com tecto de true-peak (dBTP). O ganho é
 * limitado pelo true-peak (nunca empurra o pico acima do tecto) e por um teto
 * de segurança, com deadband para não reescrever por variações mínimas.
 *
 * MODOS
 *   node loudness-watcher.mjs scan  --dir <pasta>            (local, read-only)
 *   node loudness-watcher.mjs scan  --station               (host: mede via API + docker)
 *   node loudness-watcher.mjs apply --station [--yes]        (host: grava amplify no AzuraCast)
 *   node loudness-watcher.mjs monitor --secs 20              (host: amostra o stream ao vivo)
 *
 * ENV (host): STATION_API_URL, STATION_API_KEY, STATION_ID (via apps/station/.env)
 * Nunca imprime a API key nem segredos.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));

// ---- alvo / limites (broadcast internet: -16 LUFS, -1.5 dBTP) ----
const TARGET_I = num(process.env.TARGET_I, -16); // LUFS integrado alvo
const TARGET_TP = num(process.env.TARGET_TP, -1.5); // tecto de true-peak (dBTP)
const MAX_GAIN = num(process.env.MAX_GAIN, 12); // ganho máx (dB)
const MIN_GAIN = num(process.env.MIN_GAIN, -12); // ganho mín (dB)
const DEADBAND = num(process.env.DEADBAND, 0.5); // não reescreve se |Δ| < isto (dB)

function num(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

// Argumentos simples: modo + flags.
function parseArgs(argv) {
  const a = { mode: argv[0] || "scan", flags: {}, };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { a.flags[key] = next; i++; }
      else a.flags[key] = true;
    }
  }
  return a;
}

// Mede loudness integrado (I), true-peak (TP) e LRA de um ficheiro/URL via
// o passo de análise do loudnorm (imprime JSON no stderr). Read-only.
async function measure(input, extraInput = []) {
  const { stderr } = await exec(
    "ffmpeg",
    ["-hide_banner", "-nostats", ...extraInput, "-i", input,
     "-af", `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json`,
     "-f", "null", "-"],
    { maxBuffer: 1 << 26 }
  ).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
  // o bloco JSON é a última chaveta do stderr
  const s = String(stderr);
  const start = s.lastIndexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0 || end < start) return null;
  let j;
  try { j = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  const I = parseFloat(j.input_i), TP = parseFloat(j.input_tp), LRA = parseFloat(j.input_lra), TH = parseFloat(j.input_thresh);
  if (!Number.isFinite(I)) return null;
  return { I, TP, LRA, TH };
}

// Ganho recomendado (dB) para o alvo, limitado pelo true-peak e pelos tetos.
function recommendGain(m) {
  const byLoud = TARGET_I - m.I;              // o que faltaria para o alvo
  const byPeak = TARGET_TP - m.TP;            // o máximo antes de estourar o tecto
  let g = Math.min(byLoud, byPeak);           // nunca ultrapassa o tecto de pico
  g = Math.max(MIN_GAIN, Math.min(MAX_GAIN, g)); // tetos de segurança
  return Math.round(g * 10) / 10;
}

// ================= HOST: AzuraCast API + medição no container =================
// Corre NO SERVIDOR (contra localhost). Env via apps/station/.env:
//   AZURACAST_API_KEY (obrigatório), AZURACAST_BASE_URL (def. http://localhost),
//   STATION_SHORTCODE (def. it.fm), AZURACAST_CONTAINER (def. azuracast).
// Nunca imprime a API key.
function hostEnv() {
  const BASE = (process.env.AZURACAST_BASE_URL || process.env.STATION_API_URL || "http://localhost").replace(/\/+$/, "");
  const KEY = process.env.AZURACAST_API_KEY || process.env.STATION_API_KEY;
  const SC = process.env.STATION_SHORTCODE || "it.fm";
  const CT = process.env.AZURACAST_CONTAINER || "azuracast";
  if (!KEY) { console.error("ERRO: AZURACAST_API_KEY em falta (. ~/itradio/apps/station/.env)"); process.exit(1); }
  return { BASE, KEY, SC, CT };
}

async function api(method, path, body, raw = false) {
  const { BASE, KEY } = hostEnv();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 180)}`); e.status = res.status; throw e; }
  return raw ? text : (text ? JSON.parse(text) : null);
}

// Resolve a estação + a pasta media dentro do container.
async function resolveStation() {
  const { SC, CT } = hostEnv();
  let st = [];
  try { st = await api("GET", "/admin/stations"); } catch {}
  if (!Array.isArray(st) || !st.length) { try { st = await api("GET", "/stations"); } catch { st = []; } }
  const m = st.find((s) => s.short_name === SC || s.shortcode === SC) || st[0];
  if (!m) throw new Error(`estação ${SC} não encontrada`);
  const { stdout } = await exec("docker", ["exec", CT, "sh", "-lc", "ls -d /var/azuracast/stations/*/media 2>/dev/null"]).catch(() => ({ stdout: "" }));
  const dirs = String(stdout).trim().split("\n").filter(Boolean);
  const media = dirs.find((d) => d.includes(m.short_name || "") || d.includes(SC)) || dirs[0];
  if (!media) throw new Error("pasta media não encontrada no container");
  return { sid: m.id, media, name: m.name };
}

// Mede um ficheiro DENTRO do container (docker exec ffmpeg), single-thread p/ não
// perturbar o stream. Devolve {I,TP,LRA,TH} ou null.
async function measureContainer(absPath) {
  const { CT } = hostEnv();
  const { stderr } = await exec(
    "docker",
    ["exec", CT, "ffmpeg", "-hide_banner", "-nostats", "-threads", "1", "-i", absPath,
     "-af", `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json`, "-f", "null", "-"],
    { maxBuffer: 1 << 26 }
  ).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
  const s = String(stderr), a = s.lastIndexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0 || b < a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const I = parseFloat(j.input_i), TP = parseFloat(j.input_tp), LRA = parseFloat(j.input_lra), TH = parseFloat(j.input_thresh);
  if (!Number.isFinite(I)) return null;
  return { I, TP, LRA, TH };
}

// blocos falados (programas/*) já vêm normalizados a -16 do build → amplify fica nulo.
const isBlock = (p) => /^programas\//i.test(p);

// Mede a media da estação. `skipBlocks` salta os blocos falados (já normalizados);
// `only` (substring, ci) limita a medição a paths que a contêm (ex.: "musica/tuga").
async function stationRows(files, media, { skipBlocks = false, only = null } = {}) {
  const rows = [];
  const keep = (f) => !(skipBlocks && isBlock(f.path)) && (!only || f.path.toLowerCase().includes(only.toLowerCase()));
  let i = 0, total = files.filter(keep).length;
  for (const f of files) {
    if (!keep(f)) continue;
    const m = await measureContainer(`${media}/${f.path}`);
    i++;
    process.stdout.write(`\r  medidos ${i}/${total} …   `);
    if (!m) { console.warn(`\n  ? falhou medir ${f.path}`); continue; }
    const emRaw = f.extra_metadata || {};
    const cur = emRaw.amplify != null && emRaw.amplify !== "" ? parseFloat(emRaw.amplify) : null;
    rows.push({ id: f.id ?? f.unique_id, path: f.path, I: m.I, TP: m.TP, LRA: m.LRA, gain: recommendGain(m), cur, em: emRaw });
  }
  process.stdout.write("\n");
  return rows;
}

// ---------- modo: scan --station (read-only) ----------
async function scanStation(only = null) {
  const { sid, media, name } = await resolveStation();
  console.log(`estação ${name} (id ${sid}) · media ${media}`);
  const files = await api("GET", `/station/${sid}/files`);
  console.log(`a medir ${files.length} ficheiros no container (single-thread)${only ? ` — só «${only}»` : ""} …`);
  const rows = await stationRows(files, media, { only });
  report(rows.map((r) => ({ file: r.path, I: r.I, TP: r.TP, LRA: r.LRA, gain: r.gain })), `estação ${name}`);
  return { sid, media, rows };
}

// ---------- modo: apply --station [--yes] ----------
// Escreve `amplify` (dB) em cada ficheiro (exceto blocos) para o alvo, preservando o
// restante extra_metadata (ex.: fade_in/out=0 dos jingles). Só reescreve se |Δ| >=
// DEADBAND. Aplica-se por play (nextsong) — sem restart, sem dead air. --yes = aplica.
async function applyStation(yes, only = null) {
  const { sid, media, name } = await resolveStation();
  const files = await api("GET", `/station/${sid}/files`);
  console.log(`estação ${name} (id ${sid}) · ${files.length} ficheiros · a medir (${only ? `só «${only}»` : "exceto blocos programas/*"}) …`);
  const rows = await stationRows(files, media, { skipBlocks: !only, only });
  const changes = rows.filter((r) => Math.abs(r.gain - (r.cur == null ? 0 : r.cur)) >= DEADBAND);
  console.log(`\nalterações propostas: ${changes.length}/${rows.length}  (deadband ${DEADBAND} dB)`);
  for (const r of changes) console.log(`  ${pad(r.cur == null ? 0 : r.cur, 6)} → ${pad(r.gain, 6)} dB   ${r.path}`);
  if (!changes.length) { console.log("nada a fazer (tudo dentro do deadband)."); return; }
  if (!yes) { console.log("\n(dry-run — usa --yes para aplicar)"); return; }
  let n = 0;
  for (const r of changes) {
    await api("PUT", `/station/${sid}/file/${r.id}`, { extra_metadata: { ...(r.em || {}), amplify: r.gain } });
    process.stdout.write(`\r  aplicados ${++n}/${changes.length} …`);
  }
  process.stdout.write("\n");
  console.log(`✅ amplify escrito em ${n} ficheiros (aplica-se por play, sem restart).`);
}

// Recolhe todos os mp3 de uma árvore local.
async function walkMp3(root) {
  const out = [];
  async function rec(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await rec(p);
      else if (/\.mp3$/i.test(e.name)) out.push(p);
    }
  }
  await rec(root);
  return out.sort();
}

// ---------- modo: scan local de uma pasta ----------
async function scanDir(dir) {
  if (!existsSync(dir)) { console.error(`ERRO: não encontro ${dir}`); process.exit(1); }
  const files = await walkMp3(dir);
  console.log(`A medir ${files.length} ficheiros em ${dir} …\n`);
  const rows = [];
  for (const f of files) {
    const m = await measure(f);
    if (!m) { console.warn(`  ? falhou medir ${basename(f)}`); continue; }
    const g = recommendGain(m);
    rows.push({ file: f.replace(dir, "").replace(/^\//, ""), I: m.I, TP: m.TP, LRA: m.LRA, gain: g });
  }
  report(rows, dir);
  return rows;
}

function report(rows, label) {
  rows.sort((a, b) => a.I - b.I);
  const mean = rows.reduce((s, r) => s + r.I, 0) / (rows.length || 1);
  const maxTP = Math.max(...rows.map((r) => r.TP));
  const off = rows.filter((r) => Math.abs(TARGET_I - r.I) > 1);
  console.log(`── ${label} ──`);
  console.log(`ficheiros=${rows.length}  I médio=${mean.toFixed(1)} LUFS  TP máx=${maxTP.toFixed(1)} dBTP  alvo=${TARGET_I} LUFS / ${TARGET_TP} dBTP`);
  console.log(`fora de ±1 LUFS do alvo: ${off.length}\n`);
  console.log("I(LUFS)  TP(dBTP)  LRA   ganho→alvo  ficheiro");
  for (const r of rows) {
    console.log(
      `${pad(r.I, 7)}  ${pad(r.TP, 7)}  ${pad(r.LRA, 4)}  ${pad(r.gain, 6)} dB   ${r.file}`
    );
  }
}
function pad(v, w) { const s = (typeof v === "number" ? v.toFixed(1) : String(v)); return s.padStart(w); }

async function writeReport(rows, name) {
  const dir = join(__dir, "loudness-reports");
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, JSON.stringify({ target: { I: TARGET_I, TP: TARGET_TP }, rows }, null, 2));
  console.log(`\nrelatório: ${p}`);
}

async function main() {
  const { mode, flags } = parseArgs(process.argv.slice(2));
  if (mode === "scan" && flags.dir) {
    const rows = await scanDir(String(flags.dir));
    if (flags.out) await writeReport(rows, String(flags.out));
    return;
  }
  if (mode === "scan" && flags.station) { await scanStation(flags.only ? String(flags.only) : null); return; }
  if (mode === "apply" && flags.station) { await applyStation(!!flags.yes, flags.only ? String(flags.only) : null); return; }
  console.error(
    "Uso:\n" +
    "  node loudness-watcher.mjs scan  --dir <pasta> [--out relatorio.json]   (local, read-only)\n" +
    "  node loudness-watcher.mjs scan  --station [--only <substr>]            (host: mede via API + docker)\n" +
    "  node loudness-watcher.mjs apply --station [--only <substr>] [--yes]    (host: escreve amplify; sem --yes = dry-run)"
  );
  process.exit(2);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
