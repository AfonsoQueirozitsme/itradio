/**
 * lib/audio.mjs — receita de áudio partilhada da estação (extraída de
 * build-programacao.mjs + news-live.mjs, sem mudança de comportamento).
 *
 * Alvo de loudness broadcast (EBU R128, rádio internet): -16 LUFS, tecto -1.5 dBTP.
 * A MÚSICA é só normalizada a -16 (2 passagens) — NÃO leva POLISH (polimento de
 * voz) nem TRIM (corte de silêncio das pontas), igual ao build atual: uma faixa
 * pode ter intro/fade de propósito.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTAINER } from "./env.mjs";

const exec = promisify(execFile);

export const NORM = { I: -16, TP: -1.5, LRA: 11 };
// Polimento de voz "rádio" (só voz — a música não leva isto):
export const POLISH = "highpass=f=75,equalizer=f=3000:t=q:w=1.5:g=2,deesser=i=0.3:m=0.4:f=0.6,acompressor=threshold=-18dB:ratio=2:attack=10:release=150:makeup=1.5";
// Corte de silêncio morto nas pontas (só voz/jingles/ads — a música não leva isto):
export const TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse";

/** Corre um binário; buffer generoso p/ logs de ffmpeg. */
export async function run(bin, args) {
  return exec(bin, args, { maxBuffer: 1 << 26 });
}

/** Duração (s) via ffprobe local; 0 se falhar. */
export async function dur(p) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]);
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch { return 0; }
}

/** Mede loudness (JSON do loudnorm no stderr). null se não parsear. */
export async function measureLoud(input) {
  const { stderr } = await exec(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", input,
     "-af", `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:print_format=json`,
     "-f", "null", "-"],
    { maxBuffer: 1 << 26 }
  ).catch((e) => ({ stderr: (e.stderr || "") + (e.stdout || "") }));
  const s = String(stderr), a = s.lastIndexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Devolve o filtro loudnorm de 2 passagens (medido+linear) para `m` (medição),
 *  ou o dinâmico de 1 passagem se a medição falhar. */
export function loudnormFilter(m) {
  const ok = m && ["input_i", "input_tp", "input_lra", "input_thresh"].every((k) => Number.isFinite(parseFloat(m[k])));
  return ok
    ? `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    : `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}`;
}

/** Loudnorm de 2 passagens → WAV pcm 44.1k stereo (melhor qualidade, sem pumping). */
export async function normToWav(input, outWav) {
  const af = loudnormFilter(await measureLoud(input));
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input,
    "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outWav]);
}

/**
 * Normaliza MÚSICA a -16 LUFS (2 passagens) → MP3 192k com alimiter de segurança
 * e metadata limpa. SEM POLISH, SEM TRIM — igual ao tratamento de música no build.
 * Devolve { I, TP, LRA } medidos na fonte (para logging), ou null.
 */
export async function normalizeMusicToMp3(input, outMp3, meta = {}) {
  const m = await measureLoud(input);
  const af = loudnormFilter(m);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", input,
    "-af", `${af},alimiter=limit=0.95`, "-ar", "44100", "-ac", "2",
    "-map_metadata", "-1"];
  if (meta.title)   args.push("-metadata", `title=${meta.title}`);
  if (meta.artist)  args.push("-metadata", `artist=${meta.artist}`);
  if (meta.album)   args.push("-metadata", `album=${meta.album}`);
  if (meta.genre)   args.push("-metadata", `genre=${meta.genre}`);
  if (meta.comment) args.push("-metadata", `comment=${meta.comment}`);
  args.push("-c:a", "libmp3lame", "-b:a", "192k", outMp3);
  await run("ffmpeg", args);
  return m ? { I: parseFloat(m.input_i), TP: parseFloat(m.input_tp), LRA: parseFloat(m.input_lra) } : null;
}

/** Limpa nome de ficheiro de música → { artist, title }. */
export function cleanMusic(name) {
  let s = name.replace(/\.[^.]+$/, "");
  s = s.replace(/_/g, " ");
  s = s.replace(/\s*\[[^\]]*\]/g, ""); // [YouTube id], [4K], [Official HD]…
  s = s.replace(/\s*\((?:official[^)]*|lyrics?|lyric video|audio|video|visualizer|hd|4k|remaster(?:ed)?|director'?s cut|radio version)\)/gi, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s*-\s*$/, "").trim();
  const i = s.indexOf(" - ");
  if (i > 0) return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() };
  return { artist: "", title: s };
}

/** Sanitiza um nome para uso em path de ficheiro. */
export function safeName(s) {
  return String(s).replace(/[\/\\:*?"<>|]/g, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Work — corre ffmpeg/ffprobe localmente (Mac) OU via `docker exec` no container
 * azuracast (host sem ffmpeg). Copiado de news-live.mjs para o core. Auto-deteta o
 * modo se NEWS_RENDER/RENDER_MODE não forçar; usa um dir temporário local +
 * (docker) um dir espelho no container.
 */
export class Work {
  constructor(mode = null) {
    this.mode = mode || forcedRenderMode();
    this.hostDir = null;
    this.ctDir = "/tmp/itfm-work";
  }
  async init() {
    if (!this.mode) this.mode = await exec("ffmpeg", ["-version"]).then(() => "local").catch(() => "docker");
    this.hostDir = await mkdtemp(join(tmpdir(), "itfm-work-"));
    if (this.mode === "docker") await exec("docker", ["exec", CONTAINER, "sh", "-c", `rm -rf ${this.ctDir} && mkdir -p ${this.ctDir}`]);
    return this.mode;
  }
  p(name) { return this.mode === "docker" ? `${this.ctDir}/${name}` : join(this.hostDir, name); }
  async put(name, data) {
    const hp = join(this.hostDir, name);
    if (Buffer.isBuffer(data)) await writeFile(hp, data); else await copyFile(data.src, hp);
    if (this.mode === "docker") await exec("docker", ["cp", hp, `${CONTAINER}:${this.ctDir}/${name}`]);
  }
  async pull(name, destHost) {
    if (this.mode === "docker") await exec("docker", ["cp", `${CONTAINER}:${this.ctDir}/${name}`, destHost]);
    else await copyFile(join(this.hostDir, name), destHost);
  }
  async ff(args) {
    const a = ["-y", "-hide_banner", "-loglevel", "error", ...args];
    return this.mode === "docker" ? exec("docker", ["exec", CONTAINER, "ffmpeg", ...a], { maxBuffer: 1 << 26 })
                                  : exec("ffmpeg", a, { maxBuffer: 1 << 26 });
  }
  async cleanup() {
    try { await rm(this.hostDir, { recursive: true, force: true }); } catch {}
    if (this.mode === "docker") await exec("docker", ["exec", CONTAINER, "sh", "-c", `rm -rf ${this.ctDir}`]).catch(() => {});
  }
}

function forcedRenderMode() {
  const m = (process.env.RENDER_MODE || process.env.NEWS_RENDER || "").toLowerCase();
  return m === "local" || m === "docker" ? m : null;
}
