#!/usr/bin/env node
/**
 * Deploy focado do injetor de segmentos/notícias (Liquidsoap custom_config).
 *
 * Aplica APENAS o snippet liquidsoap/segments_mix.liq ao backend_config.custom_config
 * da estação e reinicia o backend — sem tocar em uploads, playlists ou users
 * (ao contrário do provision.mjs, que faz o provisionamento completo).
 *
 * Faz backup do custom_config atual antes de sobrepor.
 *
 *   node --env-file=.env deploy-segments.mjs            # dry-run (mostra plano + backup)
 *   node --env-file=.env deploy-segments.mjs --yes      # aplica + restart
 *
 * ENV: AZURACAST_BASE_URL, AZURACAST_API_KEY, STATION_SHORTCODE (def it.fm).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.AZURACAST_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const KEY = process.env.AZURACAST_API_KEY;
const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
const LIQ = join(__dir, "liquidsoap", "segments_mix.liq");

if (!KEY) { console.error("ERRO: AZURACAST_API_KEY em falta (usa --env-file=.env)."); process.exit(1); }

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
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
  const yes = process.argv.includes("--yes");
  const sid = await resolveSid();
  const admin = await api("GET", `/admin/station/${sid}`);
  const shortName = admin.short_name || SHORTCODE;
  const mediaDir = `/var/azuracast/stations/${shortName}/media`;
  const snippet = (await readFile(LIQ, "utf8")).replaceAll("{{MEDIA_DIR}}", mediaDir);

  const bc = admin.backend_config || {};
  const current = bc.custom_config || "";

  // backup do custom_config atual
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(__dir, "build");
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, `custom_config.backup-${ts}.liq`);
  await writeFile(backupPath, current || "(vazio)\n");

  console.log(`estação id ${sid} · ${BASE} · media ${mediaDir}`);
  console.log(`backup do custom_config atual → ${backupPath} (${current.length} chars)`);
  console.log(`snippet novo: ${snippet.length} chars` + (current === snippet ? " (IDÊNTICO ao atual — nada a fazer)" : " (DIFERE do atual)"));

  if (current === snippet) { console.log("nada a aplicar."); return; }
  if (!yes) { console.log("\n(dry-run — usa --yes para aplicar + restart do backend)"); return; }

  bc.custom_config = snippet;
  await api("PUT", `/admin/station/${sid}`, { backend_config: bc });
  console.log("✓ custom_config aplicado");
  await api("POST", `/station/${sid}/restart`);
  console.log("✓ backend reiniciado — injetor de segmentos/notícias ativo.");
}

main().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });
