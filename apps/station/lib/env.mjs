/**
 * lib/env.mjs — configuração partilhada da estação (fonte única de env vars).
 *
 * Os scripts correm com `node --env-file=.env …`, por isso o process.env já vem
 * populado; este módulo só centraliza os NOMES, os defaults e a validação, para
 * não repetir a mesma leitura (com precedências ligeiramente diferentes) em cada
 * script. NUNCA imprime a chave — só a expõe a quem a importa.
 */

// Precedência mantida igual à dos scripts existentes (news-live/tuga/deploy):
export const BASE = (process.env.AZURACAST_BASE_URL || process.env.STATION_API_URL || "http://localhost").replace(/\/+$/, "");
export const KEY = process.env.AZURACAST_API_KEY || process.env.STATION_API_KEY;
export const SHORTCODE = process.env.STATION_SHORTCODE || "it.fm";
export const CONTAINER = process.env.AZURACAST_CONTAINER || "azuracast";

/** Aborta (exit 1) se faltar a chave da API. Mensagem sem revelar segredos. */
export function requireKey() {
  if (!KEY) {
    console.error("ERRO: AZURACAST_API_KEY em falta (correr com: node --env-file=.env …)");
    process.exit(1);
  }
}

/** Hora local de Lisboa (0–23), DST-safe via Intl — igual ao news-live.mjs. */
export function lisbonHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour12: false, hour: "2-digit" }).format(new Date()));
}
