#!/usr/bin/env node
/**
 * Deploy da nova programação IT.FM no AzuraCast (corre NO SERVIDOR, contra localhost).
 *
 * Lê apps/station/build/ (produzido por build-programacao.mjs) + manifest.json e:
 *   1. (WIPE=1) apaga TODAS as playlists e media antigas da estação
 *   2. sobe músicas (rock/house), jingles e blocos falados
 *   3. cria playlists:
 *        · Rock        default shuffle, agendada 07:00–13:00
 *        · House/EDM   default shuffle, agendada 13:00–23:00
 *        · Madrugada   default shuffle (tudo), agendada 23:00–07:00
 *        · Jingles     once_per_x_songs=2, sequencial [short_1, short_2], sem interrupt
 *        · Station ID  once_per_hour @minuto 0, jingle longo, 24/7, sem interrupt
 *        · <Programa HHMM>  once_per_hour @minuto, janela = a hora, single (sem interrupt)
 *      (os blocos já trazem, a cada ~30 min, o break de publicidade colado ao fim)
 *   4. força fade_in=0/fade_out=0 nos jingles (tocam secos, sem o crossfade)
 *   5. limpa o custom_config antigo do Liquidsoap
 *   6. reinicia a estação
 *
 * Uso (no servidor):
 *   set -a; . ~/itradio/apps/station/.env; set +a
 *   WIPE=1 node ~/itradio/apps/station/deploy-programacao.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dir, "build");
const BASE = (process.env.AZURACAST_BASE_URL || "http://localhost").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY;
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
const WIPE = process.env.WIPE === "1";

if (!KEY) { console.error("ERRO: AZURACAST_API_KEY em falta"); process.exit(1); }
if (!existsSync(join(BUILD, "manifest.json"))) { console.error(`ERRO: falta ${BUILD}/manifest.json (corre build-programacao.mjs e rsync)`); process.exit(1); }

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

async function resolveStationId() {
  let stations = [];
  try { stations = await api("GET", "/admin/stations"); } catch {}
  if (!Array.isArray(stations) || !stations.length) { try { stations = await api("GET", "/stations"); } catch { stations = []; } }
  const m = stations.find((s) => s.short_name === SHORTCODE || s.shortcode === SHORTCODE);
  if (!m) throw new Error(`estação ${SHORTCODE} não encontrada`);
  return m.id;
}

async function wipe(sid) {
  console.log("\n[WIPE] a apagar programação antiga…");
  const pls = await api("GET", `/station/${sid}/playlists`);
  for (const p of pls) { await api("DELETE", `/station/${sid}/playlist/${p.id}`).catch((e) => console.log(`  ! playlist ${p.name}: ${e.message}`)); }
  console.log(`  ${pls.length} playlists apagadas`);
  let files = [];
  try { files = await api("GET", `/station/${sid}/files`); } catch {}
  let n = 0;
  for (const f of (Array.isArray(files) ? files : [])) {
    const id = f.id ?? f.unique_id;
    try { await api("DELETE", `/station/${sid}/file/${id}`); n++; }
    catch { try { await api("DELETE", `/station/${sid}/files`, { files: [f.path] }); n++; } catch (e) { console.log(`  ! media ${f.path}: ${e.message}`); } }
  }
  console.log(`  ${n} media apagadas`);
}

async function upload(sid, rel) {
  const b64 = (await readFile(join(BUILD, rel))).toString("base64");
  await api("POST", `/station/${sid}/files`, { path: rel, file: b64 });
}

async function mkPlaylist(sid, body) {
  const pl = await api("POST", `/station/${sid}/playlists`, body);
  console.log(`  + playlist "${body.name}" (id ${pl.id})`);
  return pl.id;
}

// adiciona ficheiros a uma ou mais playlists (mantém pertença múltipla)
async function assign(sid, relPaths, playlistIds) {
  await api("PUT", `/station/${sid}/files/batch`, {
    do: "playlist",
    playlists: playlistIds.map(String),
    files: relPaths,
    dir: "",
  });
}

const sched = (start, end) => [{ start_time: start, end_time: end, start_date: null, end_date: null, days: [], loop_once: false }];

async function main() {
  console.log(`AzuraCast: ${BASE}`);
  const sid = await resolveStationId();
  console.log(`• estação id ${sid}`);
  const manifest = JSON.parse(await readFile(join(BUILD, "manifest.json"), "utf8"));

  if (WIPE) await wipe(sid);

  // ---- Upload de toda a media ----
  console.log("\n[Upload media]");
  const allMusic = [...manifest.music.rock, ...manifest.music.house];
  for (const rel of allMusic) await upload(sid, rel);
  console.log(`  ${allMusic.length} músicas`);
  // jingles: dois curtos que alternam na troca de música + um longo (station ID)
  await upload(sid, manifest.jingles.short1);
  await upload(sid, manifest.jingles.short2);
  await upload(sid, manifest.jingles.long1);
  console.log("  jingles (short_1, short_2, long_1)");
  for (const b of manifest.blocks) await upload(sid, b.path);
  console.log(`  ${manifest.blocks.length} blocos`);

  // ---- Playlists de música ----
  console.log("\n[Playlists música]");
  const madrugada = await mkPlaylist(sid, { name: "Madrugada (tudo)", type: "default", source: "songs", order: "shuffle", is_enabled: true, schedule_items: sched(2300, 700) });
  const rockId = await mkPlaylist(sid, { name: "Rock", type: "default", source: "songs", order: "shuffle", is_enabled: true, schedule_items: sched(700, 1300) });
  const houseId = await mkPlaylist(sid, { name: "House/EDM", type: "default", source: "songs", order: "shuffle", is_enabled: true, schedule_items: sched(1300, 2300) });
  await assign(sid, manifest.music.rock, [rockId, madrugada]);
  await assign(sid, manifest.music.house, [houseId, madrugada]);
  console.log("  música atribuída (rock 07–13, house 13–23, tudo 23–07)");

  // ---- Jingles: alternam [short_1, short_2] a cada 2 músicas, na troca ----
  // SEM "interrupt": o jingle entra na troca da música (não a corta a meio),
  // deixando o crossfade misturar o fade out/in — como pedido.
  console.log("\n[Jingles]");
  const jingId = await mkPlaylist(sid, { name: "Jingles", type: "once_per_x_songs", source: "songs", order: "sequential", play_per_songs: 2, backend_options: ["single_track"], is_jingle: true, is_enabled: true });
  // adiciona 1 a 1 para garantir a ordem short_1, short_2
  await assign(sid, [manifest.jingles.short1], [jingId]);
  await assign(sid, [manifest.jingles.short2], [jingId]);
  console.log("  jingles: short_1, short_2 (once_per_x_songs=2, sem interrupt)");

  // ---- Station ID: jingle longo uma vez ao topo de cada hora (24/7) ----
  // once_per_hour @ minuto 0, SEM "interrupt": entra na troca da música mais
  // próxima do topo da hora (não corta a meio), misturado pelo crossfade.
  const stationId = await mkPlaylist(sid, {
    name: "Station ID",
    type: "once_per_hour",
    source: "songs",
    order: "sequential",
    play_per_hour_minute: 0,
    backend_options: ["single_track"],
    is_jingle: true,
    is_enabled: true,
  });
  await assign(sid, [manifest.jingles.long1], [stationId]);
  console.log("  station ID: jingle_long_1 (once_per_hour @ min 0, sem interrupt)");

  // ---- Blocos falados (once_per_hour, janela = a hora) ----
  console.log("\n[Blocos falados]");
  const usedSlot = new Set(); // evita 2 blocos no mesmo hora:min
  // ordena por hora:min para atribuir bumps de forma estável
  const blocks = [...manifest.blocks].sort((a, b) => a.hour * 60 + a.min - (b.hour * 60 + b.min));
  for (const b of blocks) {
    let min = b.min;
    while (usedSlot.has(b.hour * 60 + min)) min += 2; // desencontra colisões (ex.: 13:00)
    usedSlot.add(b.hour * 60 + min);
    const HH = String(b.hour).padStart(2, "0"), MM = String(min).padStart(2, "0");
    const pid = await mkPlaylist(sid, {
      name: `${b.program} ${HH}${MM}`,
      type: "once_per_hour",
      source: "songs",
      order: "sequential",
      play_per_hour_minute: min,
      // SEM "interrupt": o bloco (voz + jingle + eventuais ads) entra na troca
      // da música em vez de a cortar a meio — evita repetições/duplicados.
      backend_options: ["single_track"],
      is_enabled: true,
      schedule_items: sched(b.hour * 100, b.hour * 100 + 59),
    });
    await assign(sid, [b.path], [pid]);
  }
  console.log(`  ${blocks.length} blocos agendados`);

  // ---- Jingles sem fade (o crossfade da estação é só para as músicas) ----
  // Por defeito o crossfade "normal" da estação aplica fade-in/out também aos
  // jingles; forçamos fade_in=0/fade_out=0 por ficheiro para tocarem "secos".
  console.log("\n[Fade dos jingles]");
  try {
    const files = await api("GET", `/station/${sid}/files`);
    const jinglePaths = new Set([manifest.jingles.short1, manifest.jingles.short2, manifest.jingles.long1]);
    const em = { amplify: null, cross_start_next: null, cue_in: null, cue_out: null, fade_in: 0, fade_out: 0 };
    let n = 0;
    for (const f of (Array.isArray(files) ? files : [])) {
      if (jinglePaths.has(f.path)) { await api("PUT", `/station/${sid}/file/${f.id ?? f.unique_id}`, { extra_metadata: em }); n++; }
    }
    console.log(`  ${n} jingles sem fade-in/out`);
  } catch (e) { console.log(`  ! fade jingles: ${e.message}`); }

  // ---- Limpa custom_config antigo (ducking Liquidsoap) ----
  console.log("\n[Backend]");
  try {
    const admin = await api("GET", `/admin/station/${sid}`);
    const bc = admin.backend_config || {};
    if (bc.custom_config) { bc.custom_config = ""; await api("PUT", `/admin/station/${sid}`, { backend_config: bc }); console.log("  custom_config limpo"); }
    else console.log("  sem custom_config (ok)");
  } catch (e) { console.log(`  ! backend_config: ${e.message}`); }

  // ---- Reinicia ----
  console.log("\n• a reiniciar estação…");
  await api("POST", `/station/${sid}/restart`);
  console.log("Concluído. ✅");
}

main().catch((e) => { console.error("\nFALHOU:", e.message); process.exit(1); });
