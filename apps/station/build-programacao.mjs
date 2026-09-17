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
 *   - jingles/jingle_short_1.mp3 · jingle_short_2.mp3 (troca de música)
 *   - jingles/jingle_long_1.mp3    (station ID — topo de cada hora)
 *   - manifest.json                descrição para o deployer
 *
 * Cada bloco falado = concat(intro, insert, [intro2, insert2, …], final) + um
 * jingle colado no fim. A voz do locutor toca SECA; a bed (news_bed) entra só
 * por baixo das notícias e da meteo, a 10% — nunca sob o locutor nem o trânsito.
 * A cada ~30 min, um bloco leva também um break de publicidade colado ao fim:
 * jingle · adspot · adspot · jingle (jingle antes e depois, nunca entre os ads).
 * Os 5 adspots (~/Downloads/AudioNovo/Ads) rodam em pares por todos os breaks.
 * O jingle longo é o station ID e toca uma vez ao topo de cada hora (deployer).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.AUDIONOVO_SRC || join(homedir(), "Downloads", "AudioNovo");
const BED = join(__dir, "audio", "beds", "news_bed.mp3");
const OUT = join(__dir, "build");
const WORK = join(OUT, ".work");    // temporários (corpo falado → WAV) — limpos no fim
const NORMDIR = join(OUT, ".norm"); // cache de jingles/ads normalizados — limpo no fim
const VOICE_VOL = 1.84; // balanço voz↔bed (o nível absoluto do bloco é fixado pelo loudnorm)
const BED_VOL = 0.20; // bed por baixo da meteo, ~10% da voz
const NEWS_BED_VOL = +(BED_VOL * 0.8).toFixed(3); // -20% durante as news (0.20 → 0.16)
const VOICE_GAP = 0.2; // pausa uniforme (s) entre segmentos falados, após cortar o silêncio morto

// Alvo de loudness broadcast (EBU R128, rádio internet): -16 LUFS, tecto -1.5 dBTP.
const NORM = { I: -16, TP: -1.5, LRA: 11 };
// Polimento de voz "rádio" — leve, feito para TTS já limpo (ElevenLabs, chão de ruído
// ~-85 dB): corta subsónicos, realça presença (~3 kHz), doma sibilância e nivela a
// dinâmica com compressão suave. Nada agressivo (voz sintética já é consistente).
const POLISH = "highpass=f=75,equalizer=f=3000:t=q:w=1.5:g=2,deesser=i=0.3:m=0.4:f=0.6,acompressor=threshold=-18dB:ratio=2:attack=10:release=150:makeup=1.5";
// Corta o silêncio morto no INÍCIO e no FIM (só nas pontas — nunca pausas internas):
// tira leading, inverte, tira o que agora é leading (o antigo trailing), volta a inverter.
// -50 dB (pico) apanha silêncio real sem comer transientes de voz/jingle. Aplica-se a
// jingles, ads e a cada clip de voz; a música NÃO é cortada (pode ter intro/fade de propósito).
const TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse";

const PROGRAMS = [
  { dir: "BootMatinal_DiogoSilva",  nome: "Boot Matinal",   locutor: "Diogo Silva",   slug: "diogo_silva",   genero: "rock",  inicio: 7,  fim: 10 },
  { dir: "CtrlAltRitmo_SofiaMartins", nome: "Ctrl+Alt+Ritmo", locutor: "Sofia Martins", slug: "sofia_martins", genero: "rock",  inicio: 10, fim: 13 },
  { dir: "Pause&Play_TomasRocha",   nome: "Pause & Play",   locutor: "Tomás Rocha",   slug: "tomas_rocha",   genero: "house", inicio: 13, fim: 16 },
  { dir: "HoraDePonta_BeatrizLima", nome: "Hora de Ponta",  locutor: "Beatriz Lima",  slug: "beatriz_lima",  genero: "house", inicio: 16, fim: 20 },
  { dir: "ModoNoturno_GoncaloPires", nome: "Modo Noturno",  locutor: "Gonçalo Pires", slug: "goncalo_pires", genero: "house", inicio: 20, fim: 23 },
];

// suffix do intro -> ficheiro em Contribuicoes/ + etiqueta bonita.
// `bed: true` = leva a news_bed por baixo (a 10%). Só notícias e meteo levam bed;
// o trânsito (como o locutor) toca seco.
const INSERTS = {
  meteo:     { file: "meteo.mp3",      label: "Meteo",    bed: true,  bedVol: BED_VOL },
  transito:  { file: "transito.mp3",   label: "Trânsito", bed: false },
  noticias:  { file: "noticias_1.mp3", label: "Notícias", bed: true,  bedVol: NEWS_BED_VOL },
  noticias2: { file: "noticias_2.mp3", label: "Notícias", bed: true,  bedVol: NEWS_BED_VOL },
};

// "Tuga Underground": programa diário 12:00–12:30. Abertura = áudio das 12h + jingle
// longo do Tuga (concatenados, cortados nas pontas e normalizados a -16, como tudo o
// resto — mas SEM o polimento de voz: é um elemento produzido). Toca uma vez às 12:00
// (playlist single_track, como os blocos). A seguir, só as 3 faixas Mind Da Gap durante
// a janela; o jingle curto entre músicas é o global da estação (rotate a cada 2 músicas).
// Pasta fora do AudioNovo (assets próprios do programa). Metadata das faixas fixada à mão
// (o nome de ficheiro não parte limpo em "artista - título").
const TUGA = {
  srcDir: process.env.TUGA_SRC || join(homedir(), "Downloads", 'Programa "TugaUnderground"'),
  slug: "tuga_underground",
  opening: "1200.mp3",
  openingJingle: "jingle_tugaundergroud_long.mp3",
  window: { start: 1200, end: 1230 },       // música do programa
  openingWindow: { start: 1200, end: 1209 }, // abertura (single_track, toca 1x)
  tracks: [
    { file: "Mind Da Gap - Bemvindo [W6zSIQd0iCM].mp3",         artist: "Mind Da Gap", title: "Bemvindo" },
    { file: "Mind da Gap - És como um Don [8Wz-hdBxGKA].mp3",   artist: "Mind Da Gap", title: "És Como Um Don" },
    { file: "Mind da gap- falsos amigos [dPNt6ElMHS0].mp3",     artist: "Mind Da Gap", title: "Falsos Amigos" },
  ],
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

// Mede loudness (I/TP/LRA/thresh) via o passo de análise do loudnorm (JSON no stderr).
async function measureLoud(input) {
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

// Loudnorm de 2 passagens (medido + linear = melhor qualidade, sem "pumping") para o
// alvo -16 LUFS / -1.5 dBTP. Escreve WAV pcm 44.1k stereo. Se a medição falhar
// (ex.: silêncio), cai para loudnorm dinâmico de 1 passagem.
async function normToWav(input, outWav) {
  const m = await measureLoud(input);
  const ok = m && ["input_i", "input_tp", "input_lra", "input_thresh"].every((k) => Number.isFinite(parseFloat(m[k])));
  const af = ok
    ? `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    : `loudnorm=I=${NORM.I}:TP=${NORM.TP}:LRA=${NORM.LRA}`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input,
    "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outWav]);
}

// Renderiza o corpo falado (voz polida + bed por baixo de meteo/news) para WAV.
// A voz leva o polimento "rádio" (POLISH) antes do volume. A bed (news_bed) entra SÓ
// nos segmentos marcados, cortada à duração, com fades — nunca sob o locutor nem o
// trânsito. O volume da bed é por segmento (`bedVol`): meteo a BED_VOL, news 20% mais
// baixa (NEWS_BED_VOL). Entre segmentos falados há uma pausa uniforme (VOICE_GAP), já
// que os clips vêm com o silêncio morto das pontas cortado. `voiceItems` = { file, bed, bedVol }.
async function renderVoiceBody(voiceItems, outWav) {
  const N = voiceItems.length;
  const segDur = await Promise.all(voiceItems.map((v) => (v.bed ? dur(v.file) : Promise.resolve(0))));
  const bedCount = voiceItems.filter((v) => v.bed).length;

  const inputs = [];
  for (const v of voiceItems) inputs.push("-i", v.file);
  for (let i = 0; i < bedCount; i++) inputs.push("-stream_loop", "-1", "-i", BED);

  const parts = [];
  const segLabels = [];
  let bedInput = N; // índice do 1.º input de bed
  for (let k = 0; k < N; k++) {
    const base = `[${k}:a]aresample=44100,aformat=channel_layouts=stereo,${POLISH},volume=${VOICE_VOL}`;
    if (voiceItems[k].bed) {
      const d = segDur[k];
      const fo = Math.max(0, d - 1.2);
      const bv = voiceItems[k].bedVol ?? BED_VOL;
      parts.push(`${base}[vv${k}]`);
      parts.push(
        `[${bedInput}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${d.toFixed(3)},` +
        `volume=${bv},afade=t=in:st=0:d=0.6,afade=t=out:st=${fo.toFixed(3)}:d=1.2[bd${k}]`
      );
      parts.push(`[vv${k}][bd${k}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[v${k}]`);
      bedInput++;
    } else {
      parts.push(`${base}[v${k}]`);
    }
    // pausa uniforme entre segmentos (não no último — o jingle da cauda segue logo)
    if (VOICE_GAP > 0 && k < N - 1) {
      parts.push(`[v${k}]apad=pad_dur=${VOICE_GAP}[v${k}g]`);
      segLabels.push(`[v${k}g]`);
    } else {
      segLabels.push(`[v${k}]`);
    }
  }

  const filter = parts.join(";") + ";" +
    `${segLabels.join("")}concat=n=${N}:v=0:a=1,aresample=44100[out]`;

  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    ...inputs, "-filter_complex", filter,
    "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outWav]);
}

// Constrói um bloco falado completo, tudo coerente a -16 LUFS sem distorcer o jingle:
//   1) corpo = voz polida (+bed) → WAV;
//   2) normaliza o corpo a -16 LUFS (2 passagens);
//   3) concatena corpo + cauda (jingle, ou jingle·ad·ad·jingle) — cada elemento da
//      cauda JÁ vem normalizado a -16 (normCache), por isso o bloco inteiro fica a
//      -16 sem o ganho único que esmagaria o jingle (~12 dB mais quente em bruto).
// Encode final único p/ MP3 192k, com alimiter de segurança.
async function buildBlock(voiceItems, tailWavs, outPath, meta, work) {
  const bodyRaw = join(work, "body_raw.wav");
  const bodyNorm = join(work, "body_norm.wav");
  await renderVoiceBody(voiceItems, bodyRaw);
  await normToWav(bodyRaw, bodyNorm);

  const inputs = ["-i", bodyNorm];
  for (const t of tailWavs) inputs.push("-i", t);
  const n = 1 + tailWavs.length;
  const prep = Array.from({ length: n }, (_, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=stereo[b${k}]`).join(";");
  const labels = Array.from({ length: n }, (_, k) => `[b${k}]`).join("");
  const filter = `${prep};${labels}concat=n=${n}:v=0:a=1,aresample=44100[cc];[cc]alimiter=limit=0.95[out]`;

  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    ...inputs, "-filter_complex", filter,
    "-map", "[out]", "-map_metadata", "-1",
    "-metadata", `title=${meta.title}`,
    "-metadata", `artist=${meta.artist}`,
    "-c:a", "libmp3lame", "-b:a", "192k", outPath]);
}

// Concatena WAVs já normalizados (-16) num MP3, com alimiter de segurança. Sem voz/bed:
// serve elementos produzidos (ex.: abertura do Tuga = áudio 12h + jingle longo do Tuga).
async function concatToMp3(wavs, outPath, meta) {
  const inputs = [];
  for (const w of wavs) inputs.push("-i", w);
  const n = wavs.length;
  const prep = Array.from({ length: n }, (_, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=stereo[b${k}]`).join(";");
  const labels = Array.from({ length: n }, (_, k) => `[b${k}]`).join("");
  const filter = `${prep};${labels}concat=n=${n}:v=0:a=1,aresample=44100[cc];[cc]alimiter=limit=0.95[out]`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    ...inputs, "-filter_complex", filter,
    "-map", "[out]", "-map_metadata", "-1",
    "-metadata", `title=${meta.title}`,
    "-metadata", `artist=${meta.artist}`,
    "-c:a", "libmp3lame", "-b:a", "192k", outPath]);
}

async function main() {
  if (!existsSync(SRC)) { console.error(`ERRO: não encontro ${SRC}`); process.exit(1); }
  if (!existsSync(BED)) { console.error(`ERRO: não encontro a bed ${BED}`); process.exit(1); }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "musica", "rock"), { recursive: true });
  await mkdir(join(OUT, "musica", "house"), { recursive: true });
  await mkdir(join(OUT, "jingles"), { recursive: true });
  await mkdir(WORK, { recursive: true });
  await mkdir(NORMDIR, { recursive: true });

  const contrib = join(SRC, "Contribuicoes");
  const jingleShort1 = join(SRC, "jingle_short_1.mp3");
  const jingleShort2 = join(SRC, "jingle_short_2.mp3");
  const jingleLong1 = join(SRC, "jingle_long_1.mp3");
  const adsDir = join(SRC, "Ads");
  const ADS = (await readdir(adsDir)).filter((f) => /\.mp3$/i.test(f)).sort().map((f) => join(adsDir, f));

  const manifest = { music: { rock: [], house: [] }, blocks: [], jingles: {}, programs: [], ads: [] };

  // Cache de corte de silêncio das pontas: fonte → WAV. Memoizado (inserts/jingles/ads
  // repetem-se por vários blocos). Corta só o silêncio morto no início/fim (TRIM).
  const trimCache = new Map();
  let trimSeq = 0;
  async function getTrimWav(src) {
    if (trimCache.has(src)) return trimCache.get(src);
    const w = join(WORK, `t${trimSeq++}_${basename(src, ".mp3")}.wav`);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src,
      "-af", TRIM, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", w]);
    trimCache.set(src, w);
    return w;
  }

  // Cache de normalização a -16 LUFS: fonte (jingle/ad) → corta silêncio → WAV (2 passagens).
  // Memoizado para reutilizar em todos os blocos sem re-normalizar o mesmo ficheiro.
  const normCache = new Map();
  let normSeq = 0;
  async function getNormWav(src) {
    if (normCache.has(src)) return normCache.get(src);
    const w = join(NORMDIR, `n${normSeq++}_${basename(src, ".mp3")}.wav`);
    const trimmed = await getTrimWav(src); // tira o silêncio das pontas ANTES de normalizar
    await normToWav(trimmed, w);
    normCache.set(src, w);
    return w;
  }

  // 1) Jingles normalizados a -16 (curto = troca/fecho de bloco+ads; longo = station ID @ topo da hora)
  for (const [name, src] of [["jingle_short_1", jingleShort1], ["jingle_short_2", jingleShort2], ["jingle_long_1", jingleLong1]]) {
    const w = await getNormWav(src);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", w,
      "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "192k", join(OUT, "jingles", `${name}.mp3`)]);
  }
  manifest.jingles = {
    short1: "jingles/jingle_short_1.mp3",
    short2: "jingles/jingle_short_2.mp3",
    long1: "jingles/jingle_long_1.mp3",
  };
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

  // 2b) Tuga Underground (12:00–12:30): abertura + faixas próprias. Só corre se a pasta
  //     existir (assets fora do AudioNovo). A abertura é normalizada+cortada e concatenada
  //     SEM polimento de voz; as faixas entram como música (metadata fixada à mão).
  if (existsSync(TUGA.srcDir)) {
    await mkdir(join(OUT, "programas", TUGA.slug), { recursive: true });
    await mkdir(join(OUT, "musica", "tuga"), { recursive: true });

    const openSrc = join(TUGA.srcDir, TUGA.opening);
    const openJingle = join(TUGA.srcDir, TUGA.openingJingle);
    if (!existsSync(openSrc) || !existsSync(openJingle)) {
      console.warn(`  ! Tuga: falta ${TUGA.opening} ou ${TUGA.openingJingle} em ${TUGA.srcDir} — salto abertura`);
    }
    const openRel = `programas/${TUGA.slug}/1200.mp3`;
    const openWavs = [await getNormWav(openSrc), await getNormWav(openJingle)];
    await concatToMp3(openWavs, join(OUT, openRel), { title: "Tuga Underground", artist: "Tuga Underground" });

    manifest.music.tuga = [];
    const tugaTracks = [];
    const seenTuga = new Set();
    for (const t of TUGA.tracks) {
      const src = join(TUGA.srcDir, "Music", t.file);
      if (!existsSync(src)) { console.warn(`  ? Tuga: não encontro ${t.file}`); continue; }
      let out = safeName(`${t.artist} - ${t.title}`);
      let candidate = `${out}.mp3`, n = 2;
      while (seenTuga.has(candidate.toLowerCase())) { candidate = `${out} (${n++}).mp3`; }
      seenTuga.add(candidate.toLowerCase());
      const rel = `musica/tuga/${candidate}`;
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src,
        "-map_metadata", "-1", "-metadata", `title=${t.title}`, "-metadata", `artist=${t.artist}`,
        "-c:a", "copy", join(OUT, rel),
      ]).catch(async () => {
        await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src,
          "-map_metadata", "-1", "-metadata", `title=${t.title}`, "-metadata", `artist=${t.artist}`,
          "-c:a", "libmp3lame", "-b:a", "256k", join(OUT, rel)]);
      });
      manifest.music.tuga.push(rel);
      tugaTracks.push(rel);
    }
    manifest.tuga = {
      slug: TUGA.slug, opening: openRel, tracks: tugaTracks,
      window: TUGA.window, openingWindow: TUGA.openingWindow,
    };
    console.log(`▸ Tuga Underground: abertura + ${tugaTracks.length} faixas (12:00–12:30)`);
  } else {
    console.warn(`  ! Tuga: pasta não encontrada (${TUGA.srcDir}) — programa não incluído`);
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
        voice.push({ file: it.file, bed: false }); // locutor: seco
        if (INSERTS[it.suffix]) {
          voice.push({ file: join(contrib, INSERTS[it.suffix].file), bed: !!INSERTS[it.suffix].bed, bedVol: INSERTS[it.suffix].bedVol });
          labels.add(INSERTS[it.suffix].label);
        }
      }
      for (const it of finals) voice.push({ file: it.file, bed: false });

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

  // 3c) Renderiza cada bloco. Cauda = jingle de fecho, ou jingle·ad·ad·jingle
  //     (cada elemento já normalizado a -16 via normCache).
  for (const s of specs) {
    const outRel = `programas/${s.prog.slug}/${s.hhmm}.mp3`;
    const tailSrc = s.ads
      ? [jingleShort1, s.ads[0], s.ads[1], jingleShort2]
      : [jingleShort1];
    const tailWavs = [];
    for (const t of tailSrc) tailWavs.push(await getNormWav(t));
    // corta o silêncio morto das pontas de cada clip de voz (voz mais justa, sem gaps mortos)
    const voiceTrimmed = [];
    for (const v of s.voice) voiceTrimmed.push({ file: await getTrimWav(v.file), bed: v.bed, bedVol: v.bedVol });
    await buildBlock(voiceTrimmed, tailWavs, join(OUT, outRel), { title: s.title, artist: s.prog.nome }, WORK);
    manifest.blocks.push({
      path: outRel, program: s.prog.nome, slug: s.prog.slug, hour: s.hour, min: s.min,
      hhmm: s.hhmm, title: s.title, clips: s.clips, ads: s.ads ? s.ads.map((p) => basename(p)) : null,
    });
    console.log(`  ▸ ${s.prog.nome} ${s.hhmm}  (${s.clips} clips${s.ads ? `, +ads ${s.ads.map((p) => basename(p)).join("+")}` : ""})`);
  }

  // limpa temporários/cache (não devem ir para o deploy)
  await rm(WORK, { recursive: true, force: true });
  await rm(NORMDIR, { recursive: true, force: true });

  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Build pronto em ${OUT}`);
  console.log(`   ${manifest.music.rock.length} rock · ${manifest.music.house.length} house · ${(manifest.music.tuga || []).length} tuga · ${manifest.blocks.length} blocos${manifest.tuga ? " · +Tuga Underground" : ""}`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
