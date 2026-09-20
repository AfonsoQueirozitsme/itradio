#!/usr/bin/env node
/**
 * music-deploy.mjs — publica a música curada no AzuraCast (corre NO HOST, contra
 * localhost). Cirúrgico e limitado à SUA área por desenho:
 *   - só cria/atualiza a SUA playlist por programa ("Música <nome>");
 *   - sobe os mp3 IN-PLACE (mantém ids);
 *   - ROTAÇÃO COM TETO: mantém as `poolCap` faixas mais recentes por programa e
 *     apaga as mais antigas — a eliminação é estritamente sob `musica/<slug>/`
 *     (nunca noutras pastas/programas); o AzuraCast remove-as das playlists por
 *     cascata. Acontece DEPOIS dos uploads → nunca deixa a pool a zero;
 *   - restart do backend SÓ se criou uma playlist nova (refrescar/retirar media
 *     numa playlist existente é in-place, como o news generate / push-blocks);
 *   - NUNCA toca no custom_config (injector de notícias) nem noutras playlists.
 *     Reporta colisões de janela — não as resolve (isso é a Fase 3).
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
import { api, resolveSid, sched, getPlaylists, getFiles, uploadFile, createPlaylist, updatePlaylist, assignToPlaylists, reorderPlaylist, getFileByPath, deleteFiles, restart, findByName } from "../lib/azuracast.mjs";
import { programBySlug, PROGRAMS, programWindows, programPoolCap } from "../lib/programs.mjs";
import { djOrder, djOrderLog } from "./dj-order.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATION = dirname(__dir);
const MUSIC_BUILD = join(STATION, "build-music");
const MANIFEST = join(MUSIC_BUILD, "manifest.json");
const HISTORY = join(__dir, ".rotation.json");   // recência por videoId (escrito pelo music-build)

const plName = (prog) => `Música ${prog.nome}`;
const videoIdOf = (relPath) => relPath.split("/").pop().replace(/\.mp3$/i, "");

async function loadJson(p, fallback) { try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; } }

/** Faixas a RETIRAR da pool no ar de um programa (rotação com teto). Junta o que
 *  está no AzuraCast sob `musica/<slug>/` com o que vai ser acrescentado agora,
 *  ordena por recência (`at` do .rotation.json; desconhecido = mais antigo) e
 *  devolve os paths acima do teto que EXISTEM no AzuraCast (para apagar). */
function computeRetire(prog, allFiles, history, addingRels) {
  const cap = programPoolCap(prog);
  const prefix = `musica/${prog.slug}/`;
  const onAir = allFiles.map((f) => f.path).filter((p) => p && p.startsWith(prefix));
  const existing = new Set(onAir);
  const paths = new Set([...onAir, ...addingRels]);   // inclui as novas (a subir)
  const hist = history[prog.slug] || {};
  const at = (p) => hist[videoIdOf(p)]?.at || "";
  const ranked = [...paths].sort((a, b) => at(b).localeCompare(at(a)));   // recente → antigo
  const retire = ranked.slice(cap).filter((p) => existing.has(p));         // só apaga o que já lá está
  return { cap, total: paths.size, retire };
}

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
  const allFiles = await getFiles(sid);          // media atual (p/ a rotação com teto)
  const history = await loadJson(HISTORY, {});   // recência por videoId

  // relatório + verificação de ficheiros locais
  const plan = [];
  for (const slug of slugs) {
    const prog = programBySlug(slug);
    if (!prog) { console.warn(`  ! slug "${slug}" não está em lib/programs — salto`); continue; }
    let rels = music[slug];
    const missing = rels.filter((r) => !existsSync(join(MUSIC_BUILD, r)));
    if (missing.length) die(`faltam ${missing.length} ficheiros locais (ex.: ${missing[0]}) — rsync do build-music/`);

    // DJ mode: sort the full pool (existing + new) by BPM/key/energy
    if (prog.djMode) {
      const tracksMeta = manifest.tracks || {};
      const allSlugFiles = rels;
      // Also include files already on air (from allFiles) that aren't in this upload
      const prefix = `musica/${slug}/`;
      const onAirPaths = allFiles.map((f) => f.path).filter((p) => p && p.startsWith(prefix));
      const allPaths = [...new Set([...allSlugFiles, ...onAirPaths])];
      const withMeta = allPaths
        .map((p) => ({ path: p, bpm: tracksMeta[p]?.bpm || 0, key: tracksMeta[p]?.key || "1A", energy: tracksMeta[p]?.energy ?? 0.5 }))
        .filter((t) => t.bpm > 0);
      if (withMeta.length >= 2) {
        const ordered = djOrder(withMeta);
        console.log(`\n  🎛  DJ mode (${prog.nome}): ${withMeta.length} tracks with BPM/key data → sequential order`);
        console.log(djOrderLog(withMeta, ordered));
        // Reorder rels to match the DJ order (only paths that are in rels)
        const relSet = new Set(rels);
        rels = ordered.filter((p) => relSet.has(p));
        // Append any rels without BPM data at the end
        for (const r of music[slug]) if (!rels.includes(r)) rels.push(r);
      } else {
        console.log(`  🎛  DJ mode (${prog.nome}): not enough BPM data (${withMeta.length} tracks) — falling back to shuffle`);
      }
    }

    const existing = findByName(playlists, plName(prog));
    plan.push({ prog, rels, existing });
  }

  // Cedência (Fase 3): a música de programa entra como playlist Standard AGENDADA
  // e NÃO-interrupting. No liquidsoap gerado pelo AzuraCast fica na camada
  // "Standard Schedule Switches" — substitui a rotação geral SÓ na sua janela.
  // Por cima dela ficam, por camadas (cada uma cede à seguinte):
  //   · IDs de topo de hora + jingles (once_per_hour/x_minutes, "interrupt") →
  //     interrompem ao :00 (at_most 1) e devolvem logo à música;
  //   · notícias/segmentos :30 → o nosso injector faz ducking por cima de tudo.
  // Só há CONFLITO real se outra playlist de MÚSICA (type=default, ativa, não
  // interrupt) estiver agendada na mesma janela — duas camas a competir.
  const isInterrupt = (p) => (p.backend_options || []).includes("interrupt") || p.type !== "default";
  // HHMM → minutos do dia; janelas [a1,a2] e [b1,b2] cruzam-se se a1<b2 && b1<a2.
  const toMin = (t) => Math.floor(t / 100) * 60 + (t % 100);
  const rangesOverlap = (a1, a2, b1, b2) => toMin(a1) < toMin(b2) && toMin(b1) < toMin(a2);
  const overlapsWindow = (p, prog) => {
    const wins = programWindows(prog);
    return (p.schedule_items || []).some((si) =>
      wins.some(([s, e]) => rangesOverlap(s, e, si.start_time, si.end_time)));
  };
  const fmtWin = (t) => `${String(Math.floor(t / 100)).padStart(2, "0")}:${String(t % 100).padStart(2, "0")}`;

  console.log("\nplano:");
  let hardConflict = false;
  for (const item of plan) {
    const { prog, rels, existing } = item;
    const win = programWindows(prog).map(([s, e]) => `${fmtWin(s)}–${fmtWin(e)}`).join(" + ");
    const conflicts = [], coexist = [];
    for (const p of playlists) {
      if (existing && p.id === existing.id) continue;
      if (!overlapsWindow(p, prog)) continue;
      if (p.is_enabled && !isInterrupt(p)) conflicts.push(p.name);
      else coexist.push(`${p.name}${p.is_enabled ? "" : " (off)"}`);
    }
    console.log(`  · "${plName(prog)}" (Standard, shuffle, não-interrupt, ${win}) — ${rels.length} faixas${existing ? ` [existe→atualiza id ${existing.id}, sem restart]` : " [NOVA→restart]"}`);
    console.log(`      cede a: IDs de topo de hora (interrupt) + notícias/segmentos :30 (ducking do injector); substitui a rotação geral na janela`);
    if (coexist.length) console.log(`      coexiste (por design, sem conflito): ${[...new Set(coexist)].join(", ")}`);
    if (conflicts.length) { hardConflict = true; console.log(`      ⚠️ CONFLITO real (outra cama de música na janela): ${[...new Set(conflicts)].join(", ")}`); }
    // rotação com teto: quanto fica no ar e o que sai
    const { cap, total, retire } = computeRetire(prog, allFiles, history, rels);
    item.retire = retire;
    if (retire.length) console.log(`      rotação: ${total} > teto ${cap} → retira ${retire.length} mais antigas (apaga do disco + playlists)`);
    else console.log(`      rotação: ${total}/${cap} no ar — dentro do teto, nada a retirar`);
  }
  if (!yes) { console.log("\n(dry-run — nada alterado)"); return; }
  if (hardConflict) die("há CONFLITO real de janela (outra playlist de música agendada) — resolve antes de aplicar, ou desativa/reagenda a outra");

  // aplica
  let createdNew = false;
  for (const { prog, rels, existing } of plan) {
    console.log(`\n[${prog.nome}]`);
    console.log(`  upload ${rels.length} faixas…`);
    for (const rel of rels) await uploadFile(sid, rel, join(MUSIC_BUILD, rel));

    let plId = existing?.id;
    const playlistOrder = prog.djMode ? "sequential" : "shuffle";
    if (!plId) {
      const pl = await createPlaylist(sid, {
        name: plName(prog), type: "default", source: "songs", order: playlistOrder,
        is_jingle: false, is_enabled: true, avoid_duplicates: true,
        backend_options: [],   // SEM "interrupt": Standard não-interrupting → cede aos IDs de hora
        schedule_items: programWindows(prog).map(([s, e]) => sched(s, e)),
      });
      plId = pl.id; createdNew = true;
      console.log(`  + "${plName(prog)}" (id ${plId})`);
    } else {
      // reafirma type/não-interrupt + order no update — garante que continua na camada certa
      await updatePlaylist(sid, plId, { is_enabled: true, type: "default", order: playlistOrder, backend_options: [], schedule_items: programWindows(prog).map(([s, e]) => sched(s, e)) });
      console.log(`  ~ "${plName(prog)}" (id ${plId}) atualizada`);
    }
    await assignToPlaylists(sid, rels, [plId]);
    console.log(`  ✓ ${rels.length} faixas → "${plName(prog)}"`);

    // DJ mode: reorder playlist tracks for harmonic BPM progression
    if (prog.djMode) {
      const tracksMeta = manifest.tracks || {};
      const prefix = `musica/${prog.slug}/`;
      const refreshedFiles = await getFiles(sid);
      const slugFiles = refreshedFiles.filter((f) => f.path && f.path.startsWith(prefix));
      const withMeta = slugFiles
        .map((f) => ({ path: f.path, id: f.id, bpm: tracksMeta[f.path]?.bpm || 0, key: tracksMeta[f.path]?.key || "1A", energy: tracksMeta[f.path]?.energy ?? 0.5 }))
        .filter((t) => t.bpm > 0);
      if (withMeta.length >= 2) {
        const ordered = djOrder(withMeta);
        const byPath = Object.fromEntries(withMeta.map((t) => [t.path, t]));
        const mediaIds = ordered.map((p) => byPath[p]?.id).filter(Boolean);
        if (mediaIds.length >= 2) {
          await reorderPlaylist(sid, plId, mediaIds);
          console.log(`  🎛  DJ order applied: ${mediaIds.length} tracks reordered in playlist`);
        }
      }
    }
  }

  // rotação com teto: apaga as faixas antigas acima do teto (cascata → saem das
  // playlists + disco). In-place, SEM restart. Corre depois dos uploads para que
  // as novas já estejam no ar quando as velhas saem (nunca deixa a pool a zero).
  let retired = 0;
  for (const { prog, retire } of plan) {
    if (!retire?.length) continue;
    await deleteFiles(sid, retire);
    retired += retire.length;
    console.log(`  − ${prog.nome}: ${retire.length} faixas antigas retiradas (teto ${programPoolCap(prog)})`);
  }
  if (retired) console.log(`  ✓ rotação: ${retired} faixas antigas apagadas`);

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
