// Disparar agora: cria o sentinel file `.itfm_fire_news` que o Liquidsoap
// (segments_mix.liq) poll a cada 2 s. Quando encontrado, o Liquidsoap apaga-o e
// dispara o noticiário imediatamente, sem restart do backend.
//
// Autenticação: mesma sonda SSO cookie-forward dos outros endpoints /api/gestao/*
// (probe ao AzuraCast admin gate). Em dev, GESTAO_DEV_BYPASS salta a verificação.

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import {
  AZURACAST_BASE_URL,
  GESTAO_ADMIN_GATE,
  AZ_PROBE_TIMEOUT_MS,
  ITFM_MEDIA_DIR,
  ITFM_STATION_DIR,
  GESTAO_DEV_BYPASS,
} from "@/app/gestao/_lib/config";

const SENTINEL = ".itfm_fire_news";

// Station dir candidates (same as audio proxy)
const STATION_DIR_CANDIDATES = [
  ITFM_STATION_DIR,
  path.resolve(process.cwd(), "../station"),
  path.resolve(process.cwd(), "apps/station"),
  "/home/itradio/itradio/apps/station",
].filter((p): p is string => typeof p === "string" && p.length > 0);

// ── Auth: lightweight probe (same pattern as audio/route.ts & files/route.ts) ─
async function validateSession(cookie: string): Promise<boolean> {
  try {
    const res = await fetch(`${AZURACAST_BASE_URL}${GESTAO_ADMIN_GATE}`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(AZ_PROBE_TIMEOUT_MS),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Auth: check AzuraCast session (or dev bypass)
  if (!GESTAO_DEV_BYPASS) {
    const cookie = request.headers.get("cookie");
    if (!cookie) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ok = await validateSession(cookie);
    if (!ok) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 2. Try multiple sentinel locations — first writable wins.
  //    Priority: ITFM_MEDIA_DIR (Docker volume → Liquidsoap sees it directly),
  //    then station dir candidates (where the Liquidsoap injector also checks).
  const candidates = [
    ITFM_MEDIA_DIR,
    ...STATION_DIR_CANDIDATES,
  ].filter(Boolean) as string[];

  let written: string | null = null;

  for (const dir of candidates) {
    const sentinelPath = path.join(dir, SENTINEL);
    try {
      await fs.access(dir, fs.constants.W_OK);
      await fs.writeFile(sentinelPath, "", { mode: 0o644 });
      written = sentinelPath;
      break;
    } catch {
      // try next candidate
    }
  }

  // 3. Fallback: try docker exec to create the sentinel inside the container
  if (!written) {
    try {
      await new Promise<void>((resolve, reject) => {
        exec(
          `docker exec azuracast touch /var/azuracast/stations/it.fm/media/${SENTINEL}`,
          { timeout: 5000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      written = `docker:azuracast:/var/azuracast/stations/it.fm/media/${SENTINEL}`;
    } catch {
      // docker fallback also failed
    }
  }

  if (!written) {
    return Response.json(
      {
        error: "Nenhum diretório acessível para escrita do sentinel",
        tried: candidates.map((d) => path.join(d, SENTINEL)),
      },
      { status: 503 },
    );
  }

  return Response.json({ ok: true, sentinel: written });
}
