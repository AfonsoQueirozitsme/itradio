#!/usr/bin/env node
/**
 * Deploy cirúrgico do programa "Tuga Underground" (12:00–12:30 Lisboa, diário).
 * Corre NO SERVIDOR (contra localhost). NÃO faz WIPE. Requer um reload do backend
 * no fim (a agenda/switch do Liquidsoap muda) — o utilizador aprovou ("Agora").
 *
 * O que faz (idempotente — reutiliza o que já existir por nome):
 *   1. sobe a abertura (programas/tuga_underground/1200.mp3) e as 3 faixas (musica/tuga/*)
 *   2. "Tuga Underground Abertura" — default single_track, janela 12:00–12:09 → toca a
 *      abertura UMA vez ao início (predicate.at_most(1) como os blocos), depois devolve o ar.
 *   3. "Tuga Underground" — default shuffle, janela 12:00–12:30 → as 3 faixas em contínuo.
 *   4. abre um buraco na Rock (700–1300 → 700–1200 + 1230–1300) para o Tuga ganhar a
 *      janela sem depender da ordem do switch (a Rock fica inativa 12:00–12:30).
 *   5. desliga o bloco regular "Ctrl+Alt+Ritmo 1200" (só toca 12:00–12:09, dentro do Tuga)
 *      para não injectar a voz/notícias do meio-dia por cima do Tuga. REVERSÍVEL.
 *   6. o jingle curto a cada 2 músicas já é o rotate global "Jingles" — nada a criar.
 *   7. reload do backend (liquidsoap) para aplicar a nova agenda.
 *
 * Uso (no servidor):
 *   set -a; . ~/itradio/apps/station/.env; set +a
 *   node ~/itradio/apps/station/tuga-deploy.mjs            # dry-run (mostra o plano)
 *   node ~/itradio/apps/station/tuga-deploy.mjs --yes      # aplica + reload
 *
 * Reverter (se preciso): repor a Rock a 700–1300, reactivar "Ctrl+Alt+Ritmo 1200",
 * apagar as 2 playlists Tuga, e reload. Nunca imprime a API key.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dir, "build");
const BASE = (process.env.AZURACAST_BASE_URL || process.env.STATION_API_URL || "http://localhost").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY || process.env.STATION_API_KEY;
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
const YES = process.argv.includes("--yes");

if (!KEY) { console.error("ERRO: AZURACAST_API_KEY em falta (. ~/itradio/apps/station/.env)"); process.exit(1); }

const OPENING = "programas/tuga_underground/1200.mp3";
const TRACKS = [
  "musica/tuga/Mind Da Gap - Bemvindo.mp3",
  "musica/tuga/Mind Da Gap - Es Como Um Don.mp3",
  "musica/tuga/Mind Da Gap - Falsos Amigos.mp3",
];
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

async function main() {
  const sid = await resolveSid();
  console.log(`estação id ${sid} · ${BASE}${YES ? "" : "  (DRY-RUN — usa --yes para aplicar)"}`);

  // 0) sanidade dos ficheiros do build
  const need = [OPENING, ...TRACKS];
  for (const rel of need) if (!existsSync(join(BUILD, rel))) { console.error(`ERRO: falta ${BUILD}/${rel} (rsync do build)`); process.exit(1); }

  const playlists = await api("GET", `/station/${sid}/playlists`);
  const byName = (n) => playlists.find((p) => p.name.toLowerCase() === n.toLowerCase());
  const rock = byName("Rock");
  const block1200 = byName("Ctrl+Alt+Ritmo 1200");
  const existAbertura = byName("Tuga Underground Abertura");
  const existMusica = byName("Tuga Underground");

  console.log("\nplano:");
  console.log(`  · upload: ${OPENING} + ${TRACKS.length} faixas`);
  console.log(`  · playlist "Tuga Underground Abertura" (single_track, 12:00–12:09)${existAbertura ? " [existe→reutiliza]" : ""}`);
  console.log(`  · playlist "Tuga Underground" (shuffle, 12:00–12:30)${existMusica ? " [existe→reutiliza]" : ""}`);
  console.log(`  · Rock: buraco 12:00–12:30  → [700–1200, 1230–1300]${rock ? "" : "  ! Rock não encontrada"}`);
  console.log(`  · desligar bloco "Ctrl+Alt+Ritmo 1200"${block1200 ? ` (id ${block1200.id})` : "  ! não encontrado"}`);
  console.log(`  · reload do backend (liquidsoap)`);
  if (!YES) { console.log("\n(dry-run — nada foi alterado)"); return; }

  // 1) upload (reescreve em esquema se já existir)
  console.log("\n[1] upload…");
  for (const rel of need) {
    const b64 = (await readFile(join(BUILD, rel))).toString("base64");
    await api("POST", `/station/${sid}/files`, { path: rel, file: b64 });
    console.log(`  ✓ ${rel}`);
  }

  // 2) playlist da abertura (single_track, 12:00–12:09)
  let aberturaId = existAbertura?.id;
  if (!aberturaId) {
    const pl = await api("POST", `/station/${sid}/playlists`, {
      name: "Tuga Underground Abertura", type: "default", source: "songs", order: "sequential",
      is_jingle: false, is_enabled: true, backend_options: ["single_track"], avoid_duplicates: false,
      schedule_items: [sched(1200, 1209)],
    });
    aberturaId = pl.id;
    console.log(`  + "Tuga Underground Abertura" (id ${aberturaId})`);
  } else {
    await api("PUT", `/station/${sid}/playlist/${aberturaId}`, { is_enabled: true, backend_options: ["single_track"], schedule_items: [sched(1200, 1209)] });
    console.log(`  ~ "Tuga Underground Abertura" (id ${aberturaId}) actualizada`);
  }

  // 3) playlist da música (shuffle contínua, 12:00–12:30)
  let musicaId = existMusica?.id;
  if (!musicaId) {
    const pl = await api("POST", `/station/${sid}/playlists`, {
      name: "Tuga Underground", type: "default", source: "songs", order: "shuffle",
      is_jingle: false, is_enabled: true, backend_options: [""], avoid_duplicates: true,
      schedule_items: [sched(1200, 1230)],
    });
    musicaId = pl.id;
    console.log(`  + "Tuga Underground" (id ${musicaId})`);
  } else {
    await api("PUT", `/station/${sid}/playlist/${musicaId}`, { is_enabled: true, schedule_items: [sched(1200, 1230)] });
    console.log(`  ~ "Tuga Underground" (id ${musicaId}) actualizada`);
  }

  // 4) atribui ficheiros às playlists (por path, via batch)
  console.log("\n[2] atribuir ficheiros às playlists…");
  await api("PUT", `/station/${sid}/files/batch`, { do: "playlist", playlists: [String(aberturaId)], files: [OPENING], dir: "" });
  await api("PUT", `/station/${sid}/files/batch`, { do: "playlist", playlists: [String(musicaId)], files: TRACKS, dir: "" });
  console.log("  ✓ abertura → Abertura · 3 faixas → Tuga Underground");

  // 5) buraco na Rock (12:00–12:30 fica para o Tuga)
  if (rock) {
    await api("PUT", `/station/${sid}/playlist/${rock.id}`, { schedule_items: [sched(700, 1200), sched(1230, 1300)] });
    console.log(`\n[3] Rock (id ${rock.id}): agenda → [07:00–12:00, 12:30–13:00]`);
  } else {
    console.warn("\n[3] ! Rock não encontrada — buraco NÃO aberto (o Tuga pode não ganhar a janela)");
  }

  // 6) desliga o bloco regular das 12:00 (evita voz/notícias por cima do Tuga)
  if (block1200) {
    await api("PUT", `/station/${sid}/playlist/${block1200.id}`, { is_enabled: false });
    console.log(`[4] bloco "Ctrl+Alt+Ritmo 1200" (id ${block1200.id}) DESLIGADO (reversível)`);
  }

  // 7) reload do backend para aplicar a agenda
  console.log("\n[5] reload do backend (liquidsoap)…");
  await api("POST", `/station/${sid}/restart`);
  console.log("  ✓ backend reiniciado");

  console.log("\n✅ Tuga Underground no ar 12:00–12:30 (Lisboa). Jingle curto a cada 2 músicas = rotate global.");
  console.log("   Faixas novas: correr depois  node loudness-watcher.mjs apply --station --only musica/tuga --yes  (normaliza a -16).");
}

main().catch((e) => { console.error("\nFALHOU:", e.message); process.exit(1); });
