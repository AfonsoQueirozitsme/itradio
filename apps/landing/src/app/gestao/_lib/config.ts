// Config server-only da gestão (/gestao). Lê env em runtime; NUNCA exporta
// segredos para o cliente — não importar a partir de componentes "use client".
// A pasta _lib tem prefixo "_" → privada, nunca vira rota no App Router.

// Base da API do AzuraCast no próprio host (mesma convenção que
// apps/station/lib/azuracast.mjs). Em produção corre na VPS, onde o AzuraCast
// atende em localhost:80. Em dev local não há AzuraCast → as sondas falham e
// tudo cai no ecrã de login (esperado; o SSO só é testável atrás do túnel).
export const AZURACAST_BASE_URL = (
  process.env.AZURACAST_BASE_URL ?? "http://localhost"
).replace(/\/+$/, "");

// Permissão que dá entrada na gestão. Por defeito "administer stations"
// (GET /api/admin/stations = 200 só para quem administra estações — que é
// exatamente o âmbito deste CMS). Aperta-se para super-admin com
// GESTAO_ADMIN_GATE=/api/admin/users.
export const GESTAO_ADMIN_GATE = process.env.GESTAO_ADMIN_GATE ?? "/api/admin/stations";

// Diretório de dados runtime, FORA da árvore git — o deploy faz `git reset
// --hard` e apagaria tudo o que estivesse dentro do repo. Criado na VPS em
// /home/itradio/itfm-data (uploads, schedule.json, etc., nas fases seguintes).
export const ITFM_DATA_DIR = process.env.ITFM_DATA_DIR ?? "/home/itradio/itfm-data";

// DEV-ONLY: renderiza o painel sem sessão AzuraCast, para construir a UI local
// (onde não há AzuraCast em localhost:80). Cadeado DUPLO: só fora de produção E
// com opt-in explícito. Server-only (sem prefixo NEXT_PUBLIC) → nunca vai para o
// bundle do cliente; `next build`/`next start` forçam NODE_ENV=production, por
// isso este ramo é código MORTO em produção, aconteça o que acontecer ao env.
export const GESTAO_DEV_BYPASS =
  process.env.NODE_ENV !== "production" && process.env.GESTAO_DEV_BYPASS === "1";

// Timeout das sondas de sessão ao AzuraCast (ms).
export const AZ_PROBE_TIMEOUT_MS = 4000;
