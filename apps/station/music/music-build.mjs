#!/usr/bin/env node
/**
 * music-build.mjs — prep LOCAL (Mac) da música curada por programa.
 *
 * Pipeline (por programa, identificado por --slug):
 *   1. corre select_tracks.py (ytmusicapi, sem auth) → JSON de faixas trending do género
 *      do programa, já filtradas por duração e sem os videoIds do histórico;
 *   2. yt-dlp -x --audio-format mp3 de cada faixa → mp3 cru;
 *   3. normaliza a -16 LUFS via lib/audio (SEM POLISH/TRIM — é música) + tags
 *      (title/artist/genre/programa) → build-music/musica/<slug>/<id>.mp3;
 *   4. atualiza o manifest (build-music/manifest.json) e o histórico de rotação
 *      (music/.rotation.json — sobrevive ao wipe do build-programacao).
 *
 * NÃO faz deploy (isso é o music-deploy.mjs, no host, contra localhost). Usa um
 * root próprio (build-music/) para NUNCA colidir com o build/ da programação
 * (que é apagado por inteiro pelo build-programacao.mjs).
 *
 * Uso:
 *   node music-build.mjs --slug sofia_martins                  # pool do programa
 *   node music-build.mjs --slug sofia_martins --limit 1 --dry-run   # prova 1 faixa
 *   node music-build.mjs --slug diogo_silva --n 25             # tamanho do pool
 *
 * ENV: MUSIC_PYTHON / MUSIC_YTDLP para forçar os binários (default: .venv, senão PATH).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMusicToMp3, dur as probeDur } from "../lib/audio.mjs";
import { programBySlug, PROGRAMS } from "../lib/programs.mjs";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));       // …/apps/station/music
const STATION = dirname(__dir);                              // …/apps/station
const MUSIC_BUILD = join(STATION, "build-music");
const DL = join(MUSIC_BUILD, ".dl");
const MANIFEST = join(MUSIC_BUILD, "manifest.json");
const HISTORY = join(__dir, ".rotation.json");               // fora do build-music → sobrevive a wipes
const SELECT = join(__dir, "select_tracks.py");
const VENV = join(__dir, ".venv", "bin");

const PY = process.env.MUSIC_PYTHON || (existsSync(join(VENV, "python")) ? join(VENV, "python") : "python3");
const YTDLP = process.env.MUSIC_YTDLP || (existsSync(join(VENV, "yt-dlp")) ? join(VENV, "yt-dlp") : "yt-dlp");

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) { flags[t.slice(2, eq)] = t.slice(eq + 1); continue; }
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
    else flags[key] = true;
  }
  return flags;
}
function die(m) { console.error(`ERRO: ${m}`); process.exit(1); }

async function loadJson(p, fallback) { try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; } }

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const slug = flags.slug ? String(flags.slug) : null;
  if (!slug) die(`--slug obrigatório. Programas: ${PROGRAMS.map((p) => p.slug).join(", ")}`);
  const prog = programBySlug(slug);
  if (!prog) die(`programa "${slug}" desconhecido. Opções: ${PROGRAMS.map((p) => p.slug).join(", ")}`);

  const dryRun = !!flags["dry-run"];
  const n = Number.isFinite(+flags.n) ? +flags.n : prog.poolSize;
  const limit = Number.isFinite(+flags.limit) ? +flags.limit : Infinity;

  console.log(`▸ ${prog.nome} (${slug}) · género "${prog.ytGenre}" · pool ${n}${dryRun ? " · DRY-RUN" : ""}`);
  console.log(`  python=${PY} · yt-dlp=${YTDLP}`);

  // histórico de rotação (por slug): { [slug]: { [videoId]: {title,artist,at,path} } }
  const history = await loadJson(HISTORY, {});
  const slugHist = history[slug] || {};
  const excludeIds = Object.keys(slugHist);

  // 1) seleção via select_tracks.py (escreve o exclude num tmp p/ o python ler)
  await mkdir(MUSIC_BUILD, { recursive: true });
  const excludePath = join(MUSIC_BUILD, `.exclude_${slug}.json`);
  await writeFile(excludePath, JSON.stringify(excludeIds));
  const selArgs = [SELECT, "--genre", prog.ytGenre, "--alts", (prog.ytGenreAlts || []).join(","),
    "--n", String(n), "--min-dur", String(prog.minDur), "--max-dur", String(prog.maxDur),
    "--exclude", excludePath, "--country", process.env.MUSIC_COUNTRY || "PT"];
  console.log(`  seleção: ${PY} select_tracks.py --genre "${prog.ytGenre}" …`);
  let tracks;
  try {
    const { stdout, stderr } = await exec(PY, selArgs, { maxBuffer: 1 << 26 });
    if (stderr) process.stderr.write(stderr.split("\n").map((l) => l ? `    ${l}` : l).join("\n"));
    tracks = JSON.parse(stdout.trim() || "[]");
  } catch (e) {
    if (e.stderr) process.stderr.write(String(e.stderr));
    die(`select_tracks.py falhou (ytmusicapi instalado? rede?): ${e.message}`);
  }
  await rm(excludePath, { force: true });
  if (!tracks.length) die("select_tracks.py não devolveu faixas (histórico esgotou o género? tenta --n maior ou espera trending novo)");
  console.log(`  ${tracks.length} faixas selecionadas`);

  const toFetch = tracks.slice(0, limit === Infinity ? tracks.length : limit);
  const outDir = join(MUSIC_BUILD, "musica", slug);
  await mkdir(outDir, { recursive: true });
  await mkdir(DL, { recursive: true });

  const added = [];
  for (const t of toFetch) {
    const rawTmpl = join(DL, `${t.videoId}.%(ext)s`);
    const rawMp3 = join(DL, `${t.videoId}.mp3`);
    const finalRel = `musica/${slug}/${t.videoId}.mp3`;
    const finalAbs = join(MUSIC_BUILD, finalRel);
    try {
      console.log(`  ↓ ${t.artist} — ${t.title} [${t.videoId}] ${t.dur ? `(${t.dur}s)` : ""}`);
      await exec(YTDLP, ["-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist",
        "--no-progress", "--quiet", "--no-warnings", "-o", rawTmpl,
        `https://www.youtube.com/watch?v=${t.videoId}`], { maxBuffer: 1 << 26 });
      if (!existsSync(rawMp3)) { console.warn(`    ! yt-dlp não produziu ${rawMp3} — salto`); continue; }
      const loud = await normalizeMusicToMp3(rawMp3, finalAbs, {
        title: t.title, artist: t.artist, genre: prog.ytGenre, comment: `IT.FM · ${prog.nome}`,
      });
      const d = await probeDur(finalAbs);
      console.log(`    ✓ -16 LUFS (fonte I=${loud?.I?.toFixed(1) ?? "?"}) · ${d.toFixed(0)}s · ${finalRel}`);
      await rm(rawMp3, { force: true });
      added.push({ videoId: t.videoId, title: t.title, artist: t.artist, dur: d, path: finalRel });
    } catch (e) {
      console.warn(`    ! falhou ${t.videoId}: ${(e.message || e).toString().split("\n")[0]}`);
    }
  }
  await rm(DL, { recursive: true, force: true });

  if (!added.length) die("nenhuma faixa baixada com sucesso (yt-dlp instalado? YouTube acessível?)");
  console.log(`\n  ${added.length}/${toFetch.length} faixas prontas em ${outDir}`);

  if (dryRun) {
    console.log("  (dry-run — NÃO atualizei histórico nem manifest; ficheiros ficam p/ inspeção)");
    return;
  }

  // 4) manifest (regenera a lista do slug a partir do que está em disco) + histórico
  const manifest = await loadJson(MANIFEST, { music: {}, tracks: {}, updatedAt: null });
  manifest.music = manifest.music || {};
  manifest.tracks = manifest.tracks || {};
  const onDisk = (await readdir(outDir)).filter((f) => f.endsWith(".mp3")).sort();
  manifest.music[slug] = onDisk.map((f) => `musica/${slug}/${f}`);
  for (const a of added) manifest.tracks[a.path] = { videoId: a.videoId, title: a.title, artist: a.artist, dur: a.dur, slug };
  manifest.updatedAt = new Date().toISOString();
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  const at = new Date().toISOString();
  for (const a of added) slugHist[a.videoId] = { title: a.title, artist: a.artist, at, path: a.path };
  history[slug] = slugHist;
  await writeFile(HISTORY, JSON.stringify(history, null, 2));

  console.log(`  ✓ manifest atualizado (${manifest.music[slug].length} faixas no slug) · histórico +${added.length}`);
  console.log(`\n✅ Próximo: rsync build-music/ → host, depois  node music/music-deploy.mjs --slug ${slug}  (dry-run) e  --slug ${slug} --yes`);
}

main().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });
