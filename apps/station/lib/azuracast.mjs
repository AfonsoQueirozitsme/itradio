/**
 * lib/azuracast.mjs — cliente da API do AzuraCast (extraído da duplicação em
 * news-live.mjs / deploy-programacao.mjs / tuga-deploy.mjs, sem mudança de
 * comportamento).
 *
 * Todas as funções recebem `sid` (station id) exceto resolveSid(). NUNCA imprime
 * a chave (vem de lib/env). Erros trazem status HTTP + início do corpo.
 */

import { readFile } from "node:fs/promises";
import { BASE, KEY, SHORTCODE } from "./env.mjs";

/** Um item de agenda (janela HHMM→HHMM, todos os dias). Objeto único — envolve
 *  em array para `schedule_items`. Igual ao sched dos scripts existentes. */
export const sched = (start, end) => ({ start_time: start, end_time: end, start_date: null, end_date: null, days: [], loop_once: false });

/** Chamada crua à API. `raw=true` devolve texto; senão faz JSON.parse (ou null). */
export async function api(method, path, body, raw = false) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return raw ? text : (text ? JSON.parse(text) : null);
}

/** Resolve o id da estação pelo shortcode (fallback: admin/stations → stations → 1.ª). */
export async function resolveSid() {
  let st = [];
  try { st = await api("GET", "/admin/stations"); } catch {}
  if (!Array.isArray(st) || !st.length) { try { st = await api("GET", "/stations"); } catch { st = []; } }
  const m = st.find((s) => s.short_name === SHORTCODE || s.shortcode === SHORTCODE) || st[0];
  if (!m) throw new Error(`estação ${SHORTCODE} não encontrada`);
  return m.id;
}

/** Lista os media da estação. */
export const getFiles = (sid) => api("GET", `/station/${sid}/files`);
/** Lista as playlists da estação. */
export const getPlaylists = (sid) => api("GET", `/station/${sid}/playlists`);

/** Sobe/reescreve um media IN-PLACE (mantém o id se o path já existir; sem restart). */
export async function uploadFile(sid, rel, absPath) {
  const b64 = (await readFile(absPath)).toString("base64");
  await api("POST", `/station/${sid}/files`, { path: rel, file: b64 });
}

/** Envia album art (jpg/png) para um media file do AzuraCast via a API de art.
 *  Aceita path absoluto do ficheiro de imagem. Silencioso se falhar. */
export async function uploadArt(sid, mediaId, imgPath) {
  try {
    const imgBuf = await readFile(imgPath);
    const boundary = "----ITFMArt" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="art"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imgBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${BASE}/api/station/${sid}/file/${mediaId}/art`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireKey()}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!res.ok) return false;
    return true;
  } catch { return false; }
}

/** Cria uma playlist; devolve o objeto criado (com .id). */
export const createPlaylist = (sid, body) => api("POST", `/station/${sid}/playlists`, body);
/** Atualiza campos de uma playlist existente. */
export const updatePlaylist = (sid, id, body) => api("PUT", `/station/${sid}/playlist/${id}`, body);

/** Atribui media (por path) a uma ou mais playlists — mantém pertença múltipla. */
export async function assignToPlaylists(sid, relPaths, playlistIds) {
  await api("PUT", `/station/${sid}/files/batch`, {
    do: "playlist",
    playlists: playlistIds.map(String),
    files: relPaths,
    dir: "",
  });
}

/** Reorder media within a playlist. Takes the playlist id and an array of
 *  media file ids (AzuraCast internal) in the desired order. Uses the
 *  playlist/{id}/order endpoint if available, falls back silently. */
export async function reorderPlaylist(sid, playlistId, mediaIds) {
  try {
    await api("PUT", `/station/${sid}/playlist/${playlistId}/order`, mediaIds.map((id, i) => ({ id, weight: i + 1 })));
  } catch {
    // Older AzuraCast versions may not have this endpoint — silent fallback
  }
}

/** Look up media file details by path. Returns the file object (with .id) or null. */
export async function getFileByPath(sid, relPath) {
  try {
    const files = await api("GET", `/station/${sid}/files/list?searchPhrase=${encodeURIComponent(relPath)}`);
    return Array.isArray(files) ? files.find((f) => f.path === relPath) : null;
  } catch {
    return null;
  }
}

/** Apaga media (por path) — remove do disco E de TODAS as playlists (cascata do
 *  AzuraCast). DESTRUTIVO. Usa o batch `do:delete` (mesmo endpoint do assign).
 *  Refresco in-place, SEM restart (não mexe na agenda/switch). */
export async function deleteFiles(sid, relPaths) {
  if (!relPaths.length) return;
  await api("PUT", `/station/${sid}/files/batch`, { do: "delete", files: relPaths, dir: "" });
}

/** Reinicia o backend (liquidsoap). SÓ necessário quando a agenda/switch muda
 *  (playlist nova) — refrescar media numa playlist existente é in-place. */
export const restart = (sid) => api("POST", `/station/${sid}/restart`);

/** Encontra uma playlist por nome (case-insensitive) numa lista já obtida. */
export const findByName = (playlists, name) => playlists.find((p) => p.name.toLowerCase() === name.toLowerCase());
