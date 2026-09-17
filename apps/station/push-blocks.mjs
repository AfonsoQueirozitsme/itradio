#!/usr/bin/env node
/**
 * Push cirúrgico dos blocos falados IT.FM (corre NO SERVIDOR, contra localhost).
 *
 * Substitui, EM ESQUEMA, o conteúdo de cada bloco (programas/<slug>/<HHMM>.mp3) pela
 * versão nova do build/ — sem WIPE, sem mexer em playlists, SEM restart e sem dead air.
 *
 * Porquê é seguro (verificado): um POST /station/{sid}/files com um `path` que JÁ existe
 * REESCREVE o ficheiro no mesmo sítio, mantém o mesmo media id e a pertença às playlists;
 * o AzuraCast re-analisa o ficheiro (duração/cue) no processamento. O Liquidsoap toca o
 * ficheiro em disco na próxima vez que o bloco entrar — sem reiniciar nada.
 *
 * Os blocos já vêm normalizados a -16 LUFS do build (amplify fica nulo neles — não se
 * mexe no amplify aqui; isso é do loudness-watcher, e só para música/jingles).
 *
 * Uso (no servidor):
 *   set -a; . ~/itradio/apps/station/.env; set +a
 *   node ~/itradio/apps/station/push-blocks.mjs            # dry-run: lista o que faria
 *   node ~/itradio/apps/station/push-blocks.mjs --yes      # aplica (reescreve os blocos)
 *
 * Nunca imprime a API key.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dir, "build");
const BASE = (process.env.AZURACAST_BASE_URL || process.env.STATION_API_URL || "http://localhost").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY || process.env.STATION_API_KEY;
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
const CONTAINER = process.env.AZURACAST_CONTAINER || "azuracast";
const YES = process.argv.includes("--yes");

if (!KEY) { console.error("ERRO: AZURACAST_API_KEY em falta (. ~/itradio/apps/station/.env)"); process.exit(1); }
if (!existsSync(join(BUILD, "manifest.json"))) { console.error(`ERRO: falta ${BUILD}/manifest.json (rsync do build)`); process.exit(1); }

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

async function resolveStation() {
  let st = [];
  try { st = await api("GET", "/admin/stations"); } catch {}
  if (!Array.isArray(st) || !st.length) { try { st = await api("GET", "/stations"); } catch { st = []; } }
  const m = st.find((s) => s.short_name === SHORTCODE || s.shortcode === SHORTCODE) || st[0];
  if (!m) throw new Error(`estação ${SHORTCODE} não encontrada`);
  const { stdout } = await exec("docker", ["exec", CONTAINER, "sh", "-lc", "ls -d /var/azuracast/stations/*/media 2>/dev/null"]).catch(() => ({ stdout: "" }));
  const dirs = String(stdout).trim().split("\n").filter(Boolean);
  const media = dirs.find((d) => d.includes(m.short_name || "") || d.includes(SHORTCODE)) || dirs[0];
  return { sid: m.id, name: m.name, media };
}

// md5 do ficheiro DENTRO do container (para confirmar a reescrita).
async function md5Container(absPath) {
  const { stdout } = await exec("docker", ["exec", CONTAINER, "md5sum", absPath]).catch(() => ({ stdout: "" }));
  return String(stdout).trim().split(/\s+/)[0] || null;
}
function md5Buf(buf) { return createHash("md5").update(buf).digest("hex"); }

async function main() {
  const { sid, name, media } = await resolveStation();
  const manifest = JSON.parse(await readFile(join(BUILD, "manifest.json"), "utf8"));
  const blocks = manifest.blocks || [];
  console.log(`estação ${name} (id ${sid}) · ${blocks.length} blocos no build${media ? ` · media ${media}` : ""}`);

  // mapa dos ficheiros vivos: path -> id (para saber quais já existem)
  const live = await api("GET", `/station/${sid}/files`);
  const byPath = new Map(live.map((f) => [f.path, f.id ?? f.unique_id]));

  const missing = blocks.filter((b) => !byPath.has(b.path));
  const existing = blocks.filter((b) => byPath.has(b.path));
  console.log(`  ${existing.length} substituem em esquema · ${missing.length} novos${missing.length ? " (serão criados)" : ""}`);
  if (missing.length) for (const b of missing) console.log(`    novo: ${b.path}`);

  if (!YES) {
    console.log("\n(dry-run — usa --yes para reescrever os blocos)");
    return;
  }

  let ok = 0, changed = 0, same = 0, fail = 0;
  for (const b of blocks) {
    const buf = await readFile(join(BUILD, b.path));
    const localMd5 = md5Buf(buf);
    // md5 do que está vivo AGORA (antes de reescrever)
    const before = media ? await md5Container(`${media}/${b.path}`) : null;
    if (before && before === localMd5) { same++; ok++; process.stdout.write(`\r  ${ok}/${blocks.length} (já igual: ${same}, reescritos: ${changed})   `); continue; }
    try {
      await api("POST", `/station/${sid}/files`, { path: b.path, file: buf.toString("base64") });
      // confirma a reescrita
      const after = media ? await md5Container(`${media}/${b.path}`) : null;
      if (after && after !== localMd5) { fail++; console.warn(`\n  ! md5 não bate após upload: ${b.path} (disco ${after?.slice(0,8)} vs build ${localMd5.slice(0,8)})`); }
      else { changed++; }
      ok++;
    } catch (e) { fail++; console.warn(`\n  ! falhou ${b.path}: ${e.message}`); }
    process.stdout.write(`\r  ${ok}/${blocks.length} (já igual: ${same}, reescritos: ${changed})   `);
  }
  process.stdout.write("\n");
  console.log(`✅ blocos: ${changed} reescritos, ${same} já iguais, ${fail} falhas (sem restart, sem dead air).`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error("\nFALHOU:", e.message); process.exit(1); });
