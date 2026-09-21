#!/usr/bin/env node
/**
 * music-build.mjs — prep LOCAL (Mac) da música curada por programa.
 *
 * Pipeline (por programa, identificado por --slug):
 *   1. corre select_tracks.py (ytmusicapi, sem auth) → JSON de faixas trending do género
 *      do programa, já filtradas por duração e sem os videoIds do histórico;
 *   2. yt-dlp -f bestaudio/best de cada faixa → áudio NATIVO (sem re-encode);
 *   3. normaliza a -16 LUFS via lib/audio (SEM POLISH/TRIM — é música), único
 *      encode → mp3 192k, + tags (title/artist/genre/programa) →
 *      build-music/musica/<slug>/<id>.mp3;
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

// ── AI vibe curator (Claude via Bedrock) ────────────────────────────────────
let _bedrock = null;
let _bedrockFailed = false;

async function getBedrockClient() {
  if (_bedrock) return _bedrock;
  if (_bedrockFailed) return null;
  try {
    const mod = await import("@anthropic-ai/bedrock-sdk");
    const AnthropicBedrock = mod.default || mod.AnthropicBedrock;
    const opts = { awsRegion: process.env.AWS_REGION || "eu-west-3" };
    if (process.env.AWS_SESSION_TOKEN) opts.awsSessionToken = process.env.AWS_SESSION_TOKEN;
    _bedrock = new AnthropicBedrock(opts);
    return _bedrock;
  } catch (e) {
    console.warn(`    ⚠ Bedrock SDK init failed: ${e.message || e}`);
    _bedrockFailed = true;
    return null;
  }
}

async function curateWithAI(candidates, prog, target) {
  const client = await getBedrockClient();
  if (!client) { console.warn("    ⚠ no Bedrock client"); return null; }

  const model = process.env.MUSIC_AI_MODEL || "eu.anthropic.claude-sonnet-5";
  const trackList = candidates.map((t, i) =>
    `${i + 1}. "${t.title}" — ${t.artist} (${t.dur ? Math.round(t.dur) + "s" : "?"})`
  ).join("\n");

  const prompt = `És o diretor musical da rádio IT.FM. Tens de selecionar e ORDENAR as ${target} melhores faixas para o programa "${prog.nome}" (${prog.inicio}h–${prog.fim}h, apresentador: ${prog.locutor}).

VIBE DO PROGRAMA:
${prog.vibe || prog.ytGenre}

CANDIDATAS (${candidates.length} faixas):
${trackList}

CRITÉRIOS DE SELEÇÃO:
- Encaixe na vibe/energia do programa (o mais importante)
- Qualidade e reconhecimento da faixa (prefere originais a covers/remixes obscuros)
- Variedade de artistas (evita repetir o mesmo artista)
- Descarta compilações, mixes, "best of", podcasts, ASMR, ou conteúdo não-musical
- Descarta faixas que claramente não encaixam no género (ex: metal num programa chill)

CRITÉRIOS DE ORDENAÇÃO (a ordem no array É a ordem de emissão):
- Curva de energia: começa suave (warm-up), sobe gradualmente até ao pico (~60-70% do set), depois desce (cool-down)
- Agrupa faixas com BPM/energia semelhante para transições suaves
- Alterna artistas (nunca dois do mesmo seguidos)
- A primeira faixa deve ser acessível e convidativa; a última deve fechar o bloco com calma

Responde APENAS com um JSON array dos NÚMEROS das faixas, na ordem de emissão. Exemplo: [3, 7, 1, 12, ...]
Seleciona exatamente ${target} faixas.`;

  try {
    const r = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = r.content.find((b) => b.type === "text");
    const text = textBlock?.text ?? "";
    if (!text) {
      const types = r.content.map((b) => b.type).join(",");
      console.warn(`    ⚠ AI returned no text block (types: ${types}, blocks: ${r.content.length})`);
      return null;
    }
    const match = text.match(/\[[\d,\s]+\]/);
    if (!match) { console.warn(`    ⚠ AI response didn't contain JSON array: ${text.slice(0, 120)}`); return null; }
    const indices = JSON.parse(match[0]);
    const curated = indices
      .map((i) => candidates[i - 1])
      .filter(Boolean)
      .slice(0, target);
    return curated.length >= Math.floor(target * 0.5) ? curated : null;
  } catch (e) {
    console.warn(`    ⚠ AI curation failed: ${(e.message || e).toString().split("\n")[0]}`);
    return null;
  }
}

const ANALYZE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "analyze-bpm-key.py");

const exec = promisify(execFile);

/** Baixa o áudio de um videoId com várias tentativas. Cada tentativa é uma
 *  extração nova → normalmente um edge googlevideo diferente (no datacenter há
 *  edges inalcançáveis). Lança o último erro se todas falharem. */
async function fetchAudio(ytdlp, videoId, rawTmpl, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await exec(ytdlp, [...YTDLP_BASE, "-o", rawTmpl, `https://www.youtube.com/watch?v=${videoId}`], { maxBuffer: 1 << 26 });
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
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

const HISTORY_KEEP = 240;   // faixas por slug a lembrar no .rotation.json (evita repetir; > pool no ar)

// Flags robustas do yt-dlp (iguais no Mac e no VPS):
//  -4                  força IPv4 — o VPS não tem saída IPv6 (evita stalls de connect);
//  --js-runtimes node  usa o Node já instalado p/ a extração JS (sem warning / formatos em falta);
//  --socket-timeout 15 + --retries 3  falha depressa em edges googlevideo inalcançáveis;
//  --no-continue --force-overwrites   cada tentativa recomeça limpa (nova extração → novo edge).
const YTDLP_BASE = ["-4", "--js-runtimes", "node", "-f", "bestaudio/best", "--no-playlist",
  "--no-progress", "--quiet", "--no-warnings", "--socket-timeout", "15", "--retries", "3",
  "--no-continue", "--force-overwrites"];

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
  const fresh = !!flags.fresh;   // substitui o pool: apaga ficheiros+histórico do slug antes de reconstruir
  const target = Number.isFinite(+flags.n) ? +flags.n : prog.poolSize;   // faixas NOVAS a obter (sucessos)
  const limit = Number.isFinite(+flags.limit) ? +flags.limit : Infinity; // teto de TENTATIVAS (p/ --dry-run/prova)
  // oversample 2x: pede o DOBRO de candidatas. A curadoria AI filtra por vibe
  // antes do download, e o oversample restante tolera downloads falhados.
  const selectN = Number.isFinite(limit) ? Math.max(limit, target) : target * 2 + Math.max(4, Math.ceil(target * 0.3));

  console.log(`▸ ${prog.nome} (${slug}) · género "${prog.ytGenre}" · alvo ${target} (seleciona ${selectN})${fresh ? " · FRESH (substitui pool)" : ""}${dryRun ? " · DRY-RUN" : ""}`);
  console.log(`  python=${PY} · yt-dlp=${YTDLP}`);

  // histórico de rotação (por slug): { [slug]: { [videoId]: {title,artist,at,path} } }
  const history = await loadJson(HISTORY, {});
  if (fresh && !dryRun) delete history[slug];   // esquece o histórico → repesca o melhor trending e re-encoda de raiz
  const slugHist = history[slug] || {};
  const excludeIds = Object.keys(slugHist);

  // 1) seleção via select_tracks.py (escreve o exclude num tmp p/ o python ler)
  await mkdir(MUSIC_BUILD, { recursive: true });
  const excludePath = join(MUSIC_BUILD, `.exclude_${slug}.json`);
  await writeFile(excludePath, JSON.stringify(excludeIds));
  const selArgs = [SELECT, "--genre", prog.ytGenre, "--alts", (prog.ytGenreAlts || []).join(","),
    "--n", String(selectN), "--min-dur", String(prog.minDur), "--max-dur", String(prog.maxDur),
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

  // 1b) AI vibe curation: filtra as candidatas por encaixe no programa.
  //     Só cura se temos mais candidatas do que o alvo (senão não há o que descartar).
  const aiTarget = Math.min(target + Math.max(4, Math.ceil(target * 0.3)), tracks.length);
  if (!flags["no-ai"] && tracks.length > target) {
    console.log(`  🎵 curadoria AI: a filtrar ${tracks.length} → ${aiTarget} por vibe…`);
    const curated = await curateWithAI(tracks, prog, aiTarget);
    if (curated) {
      console.log(`  ✓ AI selecionou ${curated.length} faixas por encaixe na vibe`);
      tracks = curated;
    } else {
      console.log(`  ⚠ curadoria AI falhou — a usar todas as ${tracks.length} candidatas`);
    }
  } else if (tracks.length <= target) {
    console.log(`  ℹ ${tracks.length} candidatas ≤ alvo ${target} — curadoria AI não aplicada`);
  }

  const outDir = join(MUSIC_BUILD, "musica", slug);
  if (fresh && !dryRun) await rm(outDir, { recursive: true, force: true });  // apaga o pool antigo (double-encode) antes de reconstruir
  await mkdir(outDir, { recursive: true });
  await mkdir(DL, { recursive: true });

  // percorre as candidatas por ordem, PARANDO ao atingir `target` sucessos (ou o
  // teto de tentativas `limit`). Downloads falhados são saltados — daí o oversample.
  const added = [];
  let attempts = 0;
  for (const t of tracks) {
    if (added.length >= target || attempts >= limit) break;
    attempts++;
    const rawTmpl = join(DL, `${t.videoId}.%(ext)s`);
    const finalRel = `musica/${slug}/${t.videoId}.mp3`;
    const finalAbs = join(MUSIC_BUILD, finalRel);
    try {
      console.log(`  ↓ ${t.artist} — ${t.title} [${t.videoId}] ${t.dur ? `(${t.dur}s)` : ""}`);
      // baixa o MELHOR áudio NATIVO (sem re-encode do yt-dlp): o único encode
      // acontece a seguir no normalize (→ mp3 192k a -16 LUFS), evitando o
      // double-encode mp3→mp3 que degradava a qualidade da fonte. fetchAudio
      // re-tenta (nova extração → outro edge) quando um edge está inalcançável.
      await fetchAudio(YTDLP, t.videoId, rawTmpl);
      // o container varia (webm/opus, m4a/aac…) → localiza pelo prefixo do id
      const raw = (await readdir(DL)).find((f) => f.startsWith(`${t.videoId}.`) && !f.endsWith(".part"));
      if (!raw) { console.warn(`    ! yt-dlp não produziu áudio p/ ${t.videoId} — salto`); continue; }
      const rawAbs = join(DL, raw);
      const loud = await normalizeMusicToMp3(rawAbs, finalAbs, {
        title: t.title, artist: t.artist, genre: prog.ytGenre, comment: `IT.FM · ${prog.nome}`,
      });
      const d = await probeDur(finalAbs);
      console.log(`    ✓ -16 LUFS (fonte I=${loud?.I?.toFixed(1) ?? "?"}) · ${d.toFixed(0)}s · ${finalRel}`);
      await rm(rawAbs, { force: true });
      added.push({ videoId: t.videoId, title: t.title, artist: t.artist, dur: d, path: finalRel });
    } catch (e) {
      console.warn(`    ! falhou ${t.videoId}: ${(e.message || e).toString().split("\n")[0]}`);
    }
  }
  await rm(DL, { recursive: true, force: true });

  if (!added.length) die("nenhuma faixa baixada com sucesso (yt-dlp instalado? YouTube acessível?)");
  console.log(`\n  ${added.length}/${target} faixas prontas (${attempts} tentativas) em ${outDir}`);

  if (dryRun) {
    console.log("  (dry-run — NÃO atualizei histórico nem manifest; ficheiros ficam p/ inspeção)");
    return;
  }

  // 4a) DJ mode: BPM/key/energy analysis for newly built tracks
  if (prog.djMode) {
    console.log(`\n  🎛  DJ mode: analyzing BPM/key/energy for ${added.length} new tracks…`);
    const filePaths = added.map((a) => join(MUSIC_BUILD, a.path));
    try {
      const { stdout, stderr } = await exec(PY, [ANALYZE_SCRIPT, ...filePaths], {
        maxBuffer: 1 << 26,
        timeout: 300_000, // 5 min max for analysis
      });
      if (stderr) process.stderr.write(stderr.split("\n").map((l) => l ? `    ${l}` : l).join("\n"));
      const results = JSON.parse(stdout.trim() || "[]");
      const byFile = Object.fromEntries(results.map((r) => [r.file, r]));
      for (const a of added) {
        const abs = join(MUSIC_BUILD, a.path);
        const r = byFile[abs];
        if (r) {
          a.bpm = r.bpm;
          a.key = r.key;
          a.energy = r.energy;
        }
      }
      const analyzed = added.filter((a) => a.bpm);
      console.log(`  ✓ ${analyzed.length}/${added.length} tracks analyzed`);
    } catch (e) {
      console.warn(`  ⚠ BPM/key analysis failed (librosa installed?): ${(e.message || e).toString().split("\n")[0]}`);
      console.warn("    → tracks will deploy without DJ ordering");
    }
  }

  // 4b) manifest (regenera a lista do slug a partir do que está em disco) + histórico
  const manifest = await loadJson(MANIFEST, { music: {}, tracks: {}, updatedAt: null });
  manifest.music = manifest.music || {};
  manifest.tracks = manifest.tracks || {};
  const onDisk = (await readdir(outDir)).filter((f) => f.endsWith(".mp3")).sort();
  manifest.music[slug] = onDisk.map((f) => `musica/${slug}/${f}`);
  for (const a of added) {
    const entry = { videoId: a.videoId, title: a.title, artist: a.artist, dur: a.dur, slug };
    if (a.bpm) entry.bpm = a.bpm;
    if (a.key) entry.key = a.key;
    if (a.energy != null) entry.energy = a.energy;
    manifest.tracks[a.path] = entry;
  }
  manifest.updatedAt = new Date().toISOString();
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  const at = new Date().toISOString();
  for (const a of added) slugHist[a.videoId] = { title: a.title, artist: a.artist, at, path: a.path };
  // teto do histórico: mantém os HISTORY_KEEP mais recentes (por `at`) → o género
  // não se esgota com o tempo; faixas muito antigas voltam a ser elegíveis. Fica
  // sempre > que a pool no ar (poolCap), logo nunca repesca algo ainda no ar.
  const kept = Object.entries(slugHist)
    .sort((a, b) => (b[1].at || "").localeCompare(a[1].at || ""))
    .slice(0, HISTORY_KEEP);
  history[slug] = Object.fromEntries(kept);
  await writeFile(HISTORY, JSON.stringify(history, null, 2));

  console.log(`  ✓ manifest atualizado (${manifest.music[slug].length} faixas no slug) · histórico ${Object.keys(history[slug]).length} (+${added.length})`);
  console.log(`\n✅ Próximo: rsync build-music/ → host, depois  node music/music-deploy.mjs --slug ${slug}  (dry-run) e  --slug ${slug} --yes`);
}

main().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });
