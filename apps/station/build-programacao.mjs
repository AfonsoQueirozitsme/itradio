#!/usr/bin/env node
/**
 * Prep LOCAL (Mac) da nova programação IT.FM.
 *
 * Lê:
 *   - ~/Downloads/AudioNovo/  (programas, contribuições, músicas, jingles)
 *   - apps/station/audio/beds/news_bed.mp3  (cama para os inserts)
 *
 * Produz (tudo em apps/station/build/, gitignored):
 *   - programas/<slug>/<HHMM>.mp3   blocos falados (intro→insert→final) com bed
 *                                   por baixo + jingle curto colado no fim
 *   - musica/rock/*.mp3             SoftRock com metadata limpa (sem álbum IT.FM)
 *   - musica/house/*.mp3           House/EDM com metadata limpa (sem álbum IT.FM)
 *   - jingles/jingle_short_1.mp3 · jingle_short_2.mp3
 *   - manifest.json                descrição para o deployer
 *
 * Cada bloco falado = concat(intro, insert, [intro2, insert2, …], final)
 * com a news_bed em loop por baixo (volume baixo, fades) + um jingle no fim.
 * A cada ~30 min, um bloco leva também um break de publicidade colado ao fim:
 * jingle · adspot · adspot · jingle (jingle antes e depois, nunca entre os ads).
 * Os 5 adspots (~/Downloads/AudioNovo/Ads) rodam em pares por todos os breaks.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(homedir(), "Downloads", "AudioNovo");
const BED = join(__dir, "audio", "beds", "news_bed.mp3");
const OUT = join(__dir, "build");
const BED_VOL = 0.16;

const PROGRAMS = [
  { dir: "BootMatinal_DiogoSilva",  nome: "Boot Matinal",   locutor: "Diogo Silva",   slug: "diogo_silva",   genero: "rock",  inicio: 7,  fim: 10 },
  { dir: "CtrlAltRitmo_SofiaMartins", nome: "Ctrl+Alt+Ritmo", locutor: "Sofia Martins", slug: "sofia_martins", genero: "rock",  inicio: 10, fim: 13 },
  { dir: "Pause&Play_TomasRocha",   nome: "Pause & Play",   locutor: "Tomás Rocha",   slug: "tomas_rocha",   genero: "house", inicio: 13, fim: 16 },
  { dir: "HoraDePonta_BeatrizLima", nome: "Hora de Ponta",  locutor: "Beatriz Lima",  slug: "beatriz_lima",  genero: "house", inicio: 16, fim: 20 },
  { dir: "ModoNoturno_GoncaloPires", nome: "Modo Noturno",  locutor: "Gonçalo Pires", slug: "goncalo_pires", genero: "house", inicio: 20, fim: 23 },
];

// suffix do intro -> ficheiro em Contribuicoes/ + etiqueta bonita
const INSERTS = {
  meteo:     { file: "meteo.mp3",     label: "Meteo" },
  transito:  { file: "transito.mp3",  label: "Trânsito" },
  noticias:  { file: "noticias_1.mp3", label: "Notícias" },
  noticias2: { file: "noticias_2.mp3", label: "Notícias" },
};

async function dur(p) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch { return 0; }
}

function parseTime(hhmm) {
  const s = String(hhmm);
  const hour = s.length <= 3 ? parseInt(s.slice(0, 1), 10) : parseInt(s.slice(0, 2), 10);
  const min = parseInt(s.slice(-2), 10);
  return { hour, min };
}

// Limpa nome de ficheiro de música -> { artist, title }
function cleanMusic(name) {
  let s = name.replace(/\.[^.]+$/, "");
  s = s.replace(/_/g, " ");
  s = s.replace(/\s*\[[^\]]*\]/g, ""); // [YouTube id], [4K Upgrade], [Official HD Music Video]…
  s = s.replace(/\s*\((?:official[^)]*|lyrics?|lyric video|audio|video|visualizer|hd|4k|remaster(?:ed)?|director'?s cut|radio version)\)/gi, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s*-\s*$/, "").trim();
  const i = s.indexOf(" - ");
  if (i > 0) return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() };
  return { artist: "", title: s };
}

function safeName(s) {
  return s.replace(/[\/\\:*?"<>|]/g, "").replace(/\s{2,}/g, " ").trim();
}

async function run(bin, args) {
  await exec(bin, args, { maxBuffer: 1 << 26 });
}

// Constrói um bloco falado: voz (concat) + bed por baixo + uma "cauda" no fim.
// `tail` = lista de ficheiros colados a seguir à voz. Bloco normal: [jingle].
// Bloco com publicidade: [jingle, adA, adB, jingle] (jingle antes e depois dos
// ads, nunca no meio). Cada faixa da cauda é normalizada antes do concat.
async function buildBlock(voicePaths, tail, outPath, meta) {
  const durs = await Promise.all(voicePaths.map(dur));
  const voiceDur = durs.reduce((a, b) => a + b, 0);
  const fadeOut = Math.max(0, voiceDur - 1.2);
  const N = voicePaths.length;
  const bedIdx = N;         // input do bed (com -stream_loop -1)
  const tailStart = N + 1;  // primeiro input da cauda (jingle/ads)

  const inputs = [];
  for (const p of voicePaths) inputs.push("-i", p);
  inputs.push("-stream_loop", "-1", "-i", BED);
  for (const t of tail) inputs.push("-i", t);

  const voiceLabels = voicePaths.map((_, k) => `[${k}:a]`).join("");
  const tailPrep = tail
    .map((_, k) => `[${tailStart + k}:a]aresample=44100,aformat=channel_layouts=stereo[t${k}]`)
    .join(";");
  const tailLabels = tail.map((_, k) => `[t${k}]`).join("");

  const filter =
    `${voiceLabels}concat=n=${N}:v=0:a=1,aresample=44100,aformat=channel_layouts=stereo,volume=0.92[v];` +
    `[${bedIdx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${voiceDur.toFixed(3)},` +
    `volume=${BED_VOL},afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.2[b];` +
    `[v][b]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[body];` +
    `${tailPrep};` +
    `[body]${tailLabels}concat=n=${1 + tail.length}:v=0:a=1,aresample=44100[cat];` +
    `[cat]alimiter=limit=0.95[out]`;

  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[out]",
    "-map_metadata", "-1",
    "-metadata", `title=${meta.title}`,
    "-metadata", `artist=${meta.artist}`,
    "-c:a", "libmp3lame", "-b:a", "192k",
    outPath,
  ]);
}

async function main() {
  if (!existsSync(SRC)) { console.error(`ERRO: não encontro ${SRC}`); process.exit(1); }
  if (!existsSync(BED)) { console.error(`ERRO: não encontro a bed ${BED}`); process.exit(1); }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "musica", "rock"), { recursive: true });
  await mkdir(join(OUT, "musica", "house"), { recursive: true });
  await mkdir(join(OUT, "jingles"), { recursive: true });

  const contrib = join(SRC, "Contribuicoes");
  const jingleShort1 = join(SRC, "jingle_short_1.mp3");
  const jingleShort2 = join(SRC, "jingle_short_2.mp3");
  const adsDir = join(SRC, "Ads");
  const ADS = (await readdir(adsDir)).filter((f) => /\.mp3$/i.test(f)).sort().map((f) => join(adsDir, f));

  const manifest = { music: { rock: [], house: [] }, blocks: [], jingles: {}, programs: [], ads: [] };

  // 1) Jingles (curto = troca de música; também fecham blocos e envolvem os ads)
  await copyFile(jingleShort1, join(OUT, "jingles", "jingle_short_1.mp3"));
  await copyFile(jingleShort2, join(OUT, "jingles", "jingle_short_2.mp3"));
  manifest.jingles = { short1: "jingles/jingle_short_1.mp3", short2: "jingles/jingle_short_2.mp3" };
  manifest.ads = ADS.map((p) => basename(p));

  // 2) Músicas (rock = SoftRock, house = House:EDM)
  const genreDirs = { rock: join(SRC, "Musicas", "SoftRock"), house: join(SRC, "Musicas", "House:EDM") };
  for (const [genre, gdir] of Object.entries(genreDirs)) {
    const files = (await readdir(gdir)).filter((f) => /\.mp3$/i.test(f)).sort();
    const seen = new Set();
    for (const f of files) {
      const { artist, title } = cleanMusic(f);
      let out = safeName(artist ? `${artist} - ${title}` : title) || basename(f, ".mp3");
      let candidate = `${out}.mp3`, n = 2;
      while (seen.has(candidate.toLowerCase())) { candidate = `${out} (${n++}).mp3`; }
      seen.add(candidate.toLowerCase());
      const rel = `musica/${genre}/${candidate}`;
      await run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-i", join(gdir, f),
        "-map_metadata", "-1",
        "-metadata", `title=${title}`,
        "-metadata", `artist=${artist}`,
        "-c:a", "copy", join(OUT, rel),
      ]).catch(async () => {
        // alguns ficheiros não aceitam -c copy com nova tag → re-encode leve
        await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", join(gdir, f),
          "-map_metadata", "-1", "-metadata", `title=${title}`, "-metadata", `artist=${artist}`,
          "-c:a", "libmp3lame", "-b:a", "256k", join(OUT, rel)]);
      });
      manifest.music[genre].push(rel);
    }
    console.log(`♪ ${genre}: ${files.length} músicas`);
  }

  // 3) Blocos falados — recolhe primeiro as specs de todos os programas para
  //    poder escolher os slots de publicidade globalmente (>= 30 min entre ads).
  const specs = [];
  for (const prog of PROGRAMS) {
    const pdir = join(SRC, "Programas", prog.dir);
    const files = (await readdir(pdir)).filter((f) => /\.mp3$/i.test(f));
    // agrupa por HHMM
    const groups = new Map(); // hhmm -> [{seq, part, suffix, file}]
    for (const f of files) {
      const m = f.match(/^(\d+)_(\d{3,4})(?:_(.+))?\.mp3$/i);
      if (!m) { console.warn(`  ? ignoro ${prog.dir}/${f}`); continue; }
      const [, seq, hhmm, suffix] = m;
      if (!groups.has(hhmm)) groups.set(hhmm, []);
      const partNum = /^\d+$/.test(suffix || "") ? parseInt(suffix, 10) : 0;
      groups.set(hhmm, [...groups.get(hhmm), { seq: parseInt(seq, 10), part: partNum, suffix: (suffix || "").toLowerCase(), file: join(pdir, f), base: f }]);
    }
    await mkdir(join(OUT, "programas", prog.slug), { recursive: true });
    const hhmms = [...groups.keys()].sort((a, b) => parseTime(a).hour * 60 + parseTime(a).min - (parseTime(b).hour * 60 + parseTime(b).min));

    for (const hhmm of hhmms) {
      const items = groups.get(hhmm).sort((a, b) => a.seq - b.seq || a.part - b.part || a.base.localeCompare(b.base));
      const finals = items.filter((it) => it.suffix === "final");
      const rest = items.filter((it) => it.suffix !== "final");
      const voice = [];
      const labels = new Set();
      for (const it of rest) {
        voice.push(it.file);
        if (INSERTS[it.suffix]) {
          voice.push(join(contrib, INSERTS[it.suffix].file));
          labels.add(INSERTS[it.suffix].label);
        }
      }
      for (const it of finals) voice.push(it.file);

      const { hour, min } = parseTime(hhmm);
      const HH = String(hour).padStart(2, "0"), MM = String(min).padStart(2, "0");
      const title = labels.size ? [...labels].join(" + ") : prog.locutor;
      specs.push({ prog, hour, min, hhmm: `${HH}${MM}`, title, voice, clips: voice.length });
    }
    manifest.programs.push({ nome: prog.nome, locutor: prog.locutor, slug: prog.slug, genero: prog.genero, inicio: prog.inicio, fim: prog.fim });
  }

  // 3b) Escolhe slots de publicidade: sempre no fim de um bloco falado, com um
  //     intervalo mínimo entre ads. 2 ads por break, a rodar por todos (pares).
  const AD_GAP_MIN = 30;
  specs.sort((a, b) => a.hour * 60 + a.min - (b.hour * 60 + b.min));
  let lastAd = -Infinity, adCursor = 0;
  for (const s of specs) {
    const t = s.hour * 60 + s.min;
    if (ADS.length >= 2 && t - lastAd >= AD_GAP_MIN) {
      s.ads = [ADS[adCursor % ADS.length], ADS[(adCursor + 1) % ADS.length]];
      adCursor += 2;
      lastAd = t;
    } else {
      s.ads = null;
    }
  }

  // 3c) Renderiza cada bloco. Cauda = jingle de fecho, ou jingle·ad·ad·jingle.
  for (const s of specs) {
    const outRel = `programas/${s.prog.slug}/${s.hhmm}.mp3`;
    const tail = s.ads
      ? [jingleShort1, s.ads[0], s.ads[1], jingleShort2]
      : [jingleShort1];
    await buildBlock(s.voice, tail, join(OUT, outRel), { title: s.title, artist: s.prog.nome });
    manifest.blocks.push({
      path: outRel, program: s.prog.nome, slug: s.prog.slug, hour: s.hour, min: s.min,
      hhmm: s.hhmm, title: s.title, clips: s.clips, ads: s.ads ? s.ads.map((p) => basename(p)) : null,
    });
    console.log(`  ▸ ${s.prog.nome} ${s.hhmm}  (${s.clips} clips${s.ads ? `, +ads ${s.ads.map((p) => basename(p)).join("+")}` : ""})`);
  }

  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Build pronto em ${OUT}`);
  console.log(`   ${manifest.music.rock.length} rock · ${manifest.music.house.length} house · ${manifest.blocks.length} blocos`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
