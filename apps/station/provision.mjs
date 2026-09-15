#!/usr/bin/env node
/**
 * Provisionamento da estação IT.FM no AzuraCast.
 *
 * Recria — de forma idempotente — toda a configuração de emissão contra um
 * AzuraCast já a correr:
 *   - a estação (se ainda não existir)
 *   - a playlist de rotação geral (música)
 *   - os anúncios de topo de hora (audio/horas/N.mp3  →  toca ao minuto 0 da hora N)
 *   - os segmentos ao minuto 30 (audio/segmentos/*.mp3, ver SEGMENTS abaixo)
 *   - o upload dos clips e a sua atribuição às playlists
 *
 * Pré-requisitos (num Ubuntu limpo):
 *   1. `npm run station:up` e esperar o AzuraCast arrancar.
 *   2. Concluir o wizard inicial no browser (criar conta de admin).
 *   3. Criar uma API key (Perfil → API Keys) OU deixar este script criar a estação
 *      se a key for de admin.
 *
 * Uso:
 *   AZURACAST_BASE_URL=http://SERVIDOR:8080 \
 *   AZURACAST_API_KEY=identifier:verifier \
 *   npm run station:provision
 *
 * Variáveis opcionais: STATION_NAME (def. "IT.FM"), STATION_SHORTCODE (def. "it.fm").
 *
 * Utilizadores super-admin (opcional): se ADMIN_PASSWORD estiver definida, o
 * script garante que cada email em ADMIN_USERS (lista separada por vírgulas;
 * def. os dois emails da equipa) existe como Super Administrator. A password
 * NUNCA está no código — vem só do ambiente (guarda-a num .env gitignored):
 *   ADMIN_PASSWORD='...' npm run station:provision
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(__dir, "audio");

const BASE = (process.env.AZURACAST_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY;
const STATION_NAME = process.env.STATION_NAME || "IT.FM";
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";

if (!KEY) {
  console.error("ERRO: define AZURACAST_API_KEY=identifier:verifier (ver cabeçalho deste ficheiro).");
  process.exit(1);
}

// --- Configuração da grelha -------------------------------------------------

// Anúncios de topo de hora: o ficheiro N.mp3 toca ao minuto 0 da hora N.
const HOUR_FILES = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23];

// Jingles a cada X minutos (independente da hora).
const JINGLES = [
  { file: "jingle_1.mp3", name: "Jingle 1", everyMinutes: 3 },
];

// Utilizadores super-admin criados por omissão (só se ADMIN_PASSWORD existir).
const ADMIN_USERS = (process.env.ADMIN_USERS ||
  "afonso.queiroz@bauermedia.pt,carlos.picarra@bauermedia.pt")
  .split(",").map((e) => e.trim()).filter(Boolean);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // nunca no repo

// Segmentos ao minuto 30. Cada um toca nas horas indicadas.
const SEGMENTS = [
  { file: "transito.mp3",       name: "Trânsito",       hours: [7, 9, 14, 17] },
  { file: "meteo.mp3",          name: "Meteo",          hours: [8, 11, 13, 15, 18, 20, 22] },
  { file: "tech_ao_minuto.mp3", name: "Tech ao Minuto", hours: [10, 12, 16, 19, 21, 23] },
];

// --- Cliente HTTP -----------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// --- Passos ------------------------------------------------------------------

async function resolveStationId() {
  let stations = [];
  try { stations = await api("GET", "/admin/stations"); } catch { /* key não-admin */ }
  if (!Array.isArray(stations) || stations.length === 0) {
    try { stations = await api("GET", "/stations"); } catch { stations = []; }
  }
  const match = stations.find(
    (s) => s.short_name === SHORTCODE || s.shortcode === SHORTCODE || s.name === STATION_NAME,
  );
  if (match) {
    console.log(`• Estação encontrada: "${match.name}" (id ${match.id})`);
    return match.id;
  }
  console.log(`• Estação "${SHORTCODE}" não existe — a criar…`);
  const created = await api("POST", "/admin/stations", {
    name: STATION_NAME,
    short_name: SHORTCODE,
    frontend_type: "icecast",
    backend_type: "liquidsoap",
    enable_public_page: true,
  });
  console.log(`  criada (id ${created.id})`);
  return created.id;
}

async function existingPlaylists(sid) {
  const pls = await api("GET", `/station/${sid}/playlists`);
  return new Map(pls.map((p) => [p.name, p.id]));
}

async function ensurePlaylist(sid, existing, body) {
  if (existing.has(body.name)) {
    console.log(`  = playlist "${body.name}" já existe (id ${existing.get(body.name)})`);
    return existing.get(body.name);
  }
  const pl = await api("POST", `/station/${sid}/playlists`, body);
  console.log(`  + playlist "${body.name}" criada (id ${pl.id})`);
  existing.set(body.name, pl.id);
  return pl.id;
}

async function uploadIfNeeded(sid, existingPaths, relPath, absPath) {
  if (existingPaths.has(relPath)) {
    console.log(`  = clip ${relPath} já está na media`);
    return;
  }
  const b64 = (await readFile(absPath)).toString("base64");
  await api("POST", `/station/${sid}/files`, { path: relPath, file: b64 });
  existingPaths.add(relPath);
  console.log(`  + upload ${relPath}`);
}

async function existingPaths(sid) {
  try {
    const files = await api("GET", `/station/${sid}/files`);
    return new Set((Array.isArray(files) ? files : []).map((f) => f.path).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function assign(sid, playlistId, relPath, dir) {
  await api("PUT", `/station/${sid}/files/batch`, {
    do: "playlist",
    playlists: [String(playlistId)],
    files: [relPath],
    dir,
  });
}

async function ensureUsers() {
  if (!ADMIN_PASSWORD) {
    console.log("\n[Utilizadores] ADMIN_PASSWORD não definida — passo ignorado.");
    return;
  }
  console.log("\n[Utilizadores super-admin]");
  // Encontra o role de super-admin.
  const roles = await api("GET", "/admin/roles");
  const superRole = (Array.isArray(roles) ? roles : []).find((r) => r.is_super_admin);
  if (!superRole) { console.log("  ! não encontrei um role super-admin, ignorado"); return; }

  const users = await api("GET", "/admin/users");
  const byEmail = new Map(
    (Array.isArray(users) ? users : []).map((u) => [String(u.email).toLowerCase(), u]),
  );
  for (const email of ADMIN_USERS) {
    if (byEmail.has(email.toLowerCase())) {
      console.log(`  = "${email}" já existe (não mexo na password)`);
      continue;
    }
    const created = await api("POST", "/admin/users", {
      email,
      new_password: ADMIN_PASSWORD,
      roles: [{ id: superRole.id }],
    });
    console.log(`  + "${email}" criado como Super Administrator (id ${created.id})`);
  }
}

async function main() {
  console.log(`AzuraCast: ${BASE}`);
  const sid = await resolveStationId();
  await ensureUsers();
  const playlists = await existingPlaylists(sid);
  const paths = await existingPaths(sid);

  // 1) Rotação geral (música). Sobe o que estiver em audio/musica/ (não versionado).
  console.log("\n[Rotação geral]");
  const musicaDir = join(AUDIO, "musica");
  const geralId = await ensurePlaylist(sid, playlists, {
    name: "Rotação Geral",
    type: "default",
    source: "songs",
    order: "shuffle",
    is_enabled: true,
  });
  if (existsSync(musicaDir)) {
    const files = (await readdir(musicaDir)).filter((f) => /\.(mp3|m4a|ogg|flac|wav)$/i.test(f));
    for (const f of files) {
      const rel = `musica/${f}`;
      await uploadIfNeeded(sid, paths, rel, join(musicaDir, f));
      await assign(sid, geralId, rel, "musica");
    }
    if (files.length === 0) console.log("  (audio/musica/ vazio — sobe as músicas para aqui antes de provisionar)");
  }

  // 2) Anúncios de topo de hora (minuto 0).
  console.log("\n[Anúncios de topo de hora]");
  for (const h of HOUR_FILES) {
    const HH = String(h).padStart(2, "0");
    const rel = `horas/${h}.mp3`;
    const abs = join(AUDIO, "horas", `${h}.mp3`);
    if (!existsSync(abs)) { console.log(`  ! falta ${abs}, ignorado`); continue; }
    await uploadIfNeeded(sid, paths, rel, abs);
    const pid = await ensurePlaylist(sid, playlists, {
      name: `Hora ${HH}`,
      type: "once_per_hour",
      source: "songs",
      order: "sequential",
      play_per_hour_minute: 0,
      backend_options: ["interrupt", "single_track"],
      is_enabled: true,
      schedule_items: [
        { start_time: h * 100, end_time: h * 100 + 59, start_date: null, end_date: null, days: [], loop_once: false },
      ],
    });
    await assign(sid, pid, rel, "horas");
  }

  // 3) Segmentos ao minuto 30.
  // O AGENDAMENTO é feito no Liquidsoap custom (liquidsoap/segments_mix.liq),
  // com ducking real: a música continua a 50% por baixo e o segmento +30%.
  // Por isso as playlists ficam DESATIVADAS no AzuraCast — só precisamos que
  // os clips estejam na media. (Se estivessem ativas, tocavam a dobrar.)
  console.log("\n[Segmentos :30 — geridos por Liquidsoap, playlists desativadas]");
  for (const seg of SEGMENTS) {
    const rel = `segmentos/${seg.file}`;
    const abs = join(AUDIO, "segmentos", seg.file);
    if (!existsSync(abs)) { console.log(`  ! falta ${abs}, ignorado`); continue; }
    await uploadIfNeeded(sid, paths, rel, abs);
    if (playlists.has(seg.name)) {
      // já existe (ex.: de um provisionamento antigo) — garante que está OFF.
      await api("PUT", `/station/${sid}/playlist/${playlists.get(seg.name)}`, { is_enabled: false });
      console.log(`  = playlist "${seg.name}" desativada (agendada no Liquidsoap)`);
    } else {
      console.log(`  = "${seg.name}" não criada no AzuraCast (agendada no Liquidsoap)`);
    }
  }

  // 3b) Jingles a cada X minutos.
  console.log("\n[Jingles]");
  for (const j of JINGLES) {
    const rel = `jingles/${j.file}`;
    const abs = join(AUDIO, "jingles", j.file);
    if (!existsSync(abs)) { console.log(`  ! falta ${abs}, ignorado`); continue; }
    await uploadIfNeeded(sid, paths, rel, abs);
    const pid = await ensurePlaylist(sid, playlists, {
      name: j.name,
      type: "once_per_x_minutes",
      source: "songs",
      order: "sequential",
      play_per_minutes: j.everyMinutes,
      backend_options: ["interrupt", "single_track"],
      is_enabled: true,
    });
    await assign(sid, pid, rel, "jingles");
  }

  // 3c) Segmentos com ducking real + bed (Liquidsoap custom_config).
  console.log("\n[Ducking Liquidsoap]");
  const liqPath = join(__dir, "liquidsoap", "segments_mix.liq");
  if (existsSync(liqPath)) {
    const admin = await api("GET", `/admin/station/${sid}`);
    const shortName = admin.short_name || SHORTCODE;
    const mediaDir = `/var/azuracast/stations/${shortName}/media`;
    const snippet = (await readFile(liqPath, "utf8")).replaceAll("{{MEDIA_DIR}}", mediaDir);
    const bc = admin.backend_config || {};
    bc.custom_config = snippet;
    await api("PUT", `/admin/station/${sid}`, { backend_config: bc });
    console.log(`  custom_config aplicado (media dir: ${mediaDir})`);
  } else {
    console.log("  (segments_mix.liq não encontrado, ignorado)");
  }

  // 4) Aplicar no backend.
  console.log("\n• A reiniciar a estação para aplicar…");
  await api("POST", `/station/${sid}/restart`);
  console.log("Concluído. ✅");
}

main().catch((e) => {
  console.error("\nFALHOU:", e.message);
  if (e.status === 403) {
    console.error("A API key não tem permissões suficientes (cria uma como admin da estação).");
  }
  process.exit(1);
});
