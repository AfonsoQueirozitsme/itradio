#!/usr/bin/env node
/**
 * daily-refresh.mjs — job DIÁRIO da música. Corre NATIVAMENTE NO VPS (systemd
 * timer itfm-music-daily), sem depender do Mac nem de túneis SSH — o servidor
 * está 24/7 no datacenter e é autónomo. Para cada programa, EM SEQUÊNCIA
 * (partilham manifest.json + .rotation.json — paralelo corrompe):
 *   1) music-build.mjs --slug <slug>   → saca trending novo do género, excluindo
 *      o histórico de rotação (.rotation.json) → faixas genuinamente novas;
 *   2) music-deploy.mjs --slug <slug> --yes  → publica in-place na playlist
 *      "Música <nome>" já existente (SEM restart — só refresco de media) e faz a
 *      rotação com teto (apaga as mais antigas acima do poolCap do programa).
 *
 * O deploy fala com o AzuraCast em http://localhost (AZURACAST_BASE_URL no .env):
 * o próprio host serve a API na porta 80. Um programa que falhe é contado como
 * falha e o job continua para o próximo (isolado, sem abortar os restantes).
 *
 * NÃO faz restart do backend (as playlists já existem) → sem dead air.
 * NÃO toca no injector de notícias nem noutras playlists.
 *
 * Correr manualmente (no VPS):  node --env-file=.env music/daily-refresh.mjs
 * (o systemd passa --env-file=.env; os filhos herdam process.env — a chave da
 * API + a base URL. PATH inclui /usr/bin p/ o ffmpeg do normalize.)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROGRAMS } from "../lib/programs.mjs";

const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));   // …/apps/station/music
const STATION = dirname(__dir);                          // …/apps/station
const NODE = process.execPath;

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

/** Corre um script da estação como processo filho; herda o env (com a chave da API). */
async function step(script, args) {
  const { stdout, stderr } = await exec(NODE, [join(__dir, script), ...args], {
    cwd: STATION, env: process.env, maxBuffer: 1 << 27,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

async function main() {
  log(`▸ refresh diário da música — ${PROGRAMS.length} programas`);
  let ok = 0, fail = 0;
  for (const p of PROGRAMS) {
    log(`──────── ${p.nome} (${p.slug}) ────────`);
    try {
      await step("music-build.mjs", ["--slug", p.slug]);
      await step("music-deploy.mjs", ["--slug", p.slug, "--yes"]);
      ok++;
    } catch (e) {
      fail++;
      const first = (e.stderr || e.stdout || e.message || String(e)).toString().split("\n").filter(Boolean).pop();
      log(`  ✗ ${p.slug} FALHOU: ${first}`);
    }
  }
  log(`✅ concluído — ${ok} ok, ${fail} falha(s)`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { log("FALHOU:", e.message || e); process.exit(1); });
