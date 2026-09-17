#!/usr/bin/env node
/**
 * music-deploy.mjs — publica a música curada no AzuraCast (corre NO HOST, contra
 * localhost). NÃO-DESTRUTIVO por desenho:
 *   - só cria/atualiza a SUA playlist por programa ("Música <nome>");
 *   - sobe os mp3 IN-PLACE (mantém ids; não apaga nada);
 *   - restart do backend SÓ se criou uma playlist nova (refrescar media numa
 *     playlist existente é in-place, como o news generate / push-blocks);
 *   - NUNCA toca no custom_config (injector de notícias), noutras playlists, nem
 *     apaga media. Reporta colisões de janela — não as resolve (isso é a Fase 3).
 *
 * Lê build-music/manifest.json (produzido por music-build.mjs; rsync p/ o host).
 *
 * Uso (no host):
 *   node --env-file=.env music/music-deploy.mjs                 # dry-run, todos os slugs do manifest
 *   node --env-file=.env music/music-deploy.mjs --slug sofia_martins        # dry-run, 1 programa
 *   node --env-file=.env music/music-deploy.mjs --slug sofia_martins --yes  # aplica
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireKey, BASE } from "../lib/env.mjs";
import { api, resolveSid, sched, getPlaylists, getFiles, uploadFile, createPlaylist, updatePlaylist, assignToPlaylists, restart, findByName } from "../lib/azuracast.mjs";
import { programBySlug, PROGRAMS, hhmm } from "../lib/programs.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATION = dirname(__dir);
const MUSIC_BUILD = join(STATION, "build-music");
const MANIFEST = join(MUSIC_BUILD, "manifest.json");

const plName = (prog) => `Música ${prog.nome}`;

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

async function main() {
  requireKey();
  const flags = parseArgs(process.argv.slice(2));
  const yes = !!flags.yes;
  const onlySlug = flags.slug ? String(flags.slug) : null;

  if (!existsSync(MANIFEST)) die(`falta ${MANIFEST} (corre music-build.mjs e faz rsync do build-music/)`);
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const music = manifest.music || {};

  const slugs = (onlySlug ? [onlySlug] : Object.keys(music)).filter((s) => (music[s] || []).length);
  if (!slugs.length) die(onlySlug ? `sem faixas p/ "${onlySlug}" no manifest` : "manifest sem faixas de música");

  const sid = await resolveSid();
  console.log(`estação id ${sid} · ${BASE}${yes ? "" : "  (DRY-RUN — usa --yes para aplicar)"}`);

  const playlists = await getPlaylists(sid);

  // relatório + verificação de ficheiros locais
  const plan = [];
  for (const slug of slugs) {
    const prog = programBySlug(slug);
    if (!prog) { console.warn(`  ! slug "${slug}" não está em lib/programs — salto`); continue; }
    const rels = music[slug];
    const missing = rels.filter((r) => !existsSync(join(MUSIC_BUILD, r)));
    if (missing.length) die(`faltam ${missing.length} ficheiros locais (ex.: ${missing[0]}) — rsync do build-music/`);
    const existing = findByName(playlists, plName(prog));
    plan.push({ prog, rels, existing });
  }

  // colisões de janela com OUTRAS playlists agendadas (informativo — não resolve)
  console.log("\nplano:");
  for (const { prog, rels, existing } of plan) {
    const win = `${String(prog.inicio).padStart(2, "0")}:00–${String(prog.fim).padStart(2, "0")}:00`;
    const collide = [];
    for (const p of playlists) {
      if (existing && p.id === existing.id) continue;
      for (const si of p.schedule_items || []) {
        const a = Math.floor(si.start_time / 100), b = Math.floor(si.end_time / 100);
        if (a < prog.fim && b > prog.inicio) { collide.push(p.name); break; }
      }
    }
    console.log(`  · "${plName(prog)}" (shuffle, ${win}) — ${rels.length} faixas${existing ? ` [existe→atualiza id ${existing.id}, sem restart]` : " [NOVA→restart]"}`);
    if (collide.length) console.log(`      ⚠️ janela sobrepõe: ${[...new Set(collide)].join(", ")} (Fase 3 resolve a cedência)`);
  }
  if (!yes) { console.log("\n(dry-run — nada alterado)"); return; }

  // aplica
  let createdNew = false;
  for (const { prog, rels, existing } of plan) {
    console.log(`\n[${prog.nome}]`);
    console.log(`  upload ${rels.length} faixas…`);
    for (const rel of rels) await uploadFile(sid, rel, join(MUSIC_BUILD, rel));

    let plId = existing?.id;
    if (!plId) {
      const pl = await createPlaylist(sid, {
        name: plName(prog), type: "default", source: "songs", order: "shuffle",
        is_jingle: false, is_enabled: true, avoid_duplicates: true,
        schedule_items: [sched(hhmm(prog.inicio), hhmm(prog.fim))],
      });
      plId = pl.id; createdNew = true;
      console.log(`  + "${plName(prog)}" (id ${plId})`);
    } else {
      await updatePlaylist(sid, plId, { is_enabled: true, schedule_items: [sched(hhmm(prog.inicio), hhmm(prog.fim))] });
      console.log(`  ~ "${plName(prog)}" (id ${plId}) atualizada`);
    }
    await assignToPlaylists(sid, rels, [plId]);
    console.log(`  ✓ ${rels.length} faixas → "${plName(prog)}"`);
  }

  if (createdNew) {
    console.log("\n• playlist nova criada → restart do backend…");
    await restart(sid);
    console.log("  ✓ backend reiniciado");
  } else {
    console.log("\n• só refresco in-place (playlists já existiam) — SEM restart");
  }
  console.log("\n✅ Música publicada.");
}

main().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });
