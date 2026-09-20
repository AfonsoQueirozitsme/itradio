// Disparar agora: cria o sentinel file `.itfm_fire_news` que o Liquidsoap
// (segments_mix.liq) poll a cada 2 s. Quando encontrado, o Liquidsoap apaga-o e
// dispara o noticiário imediatamente, sem restart do backend.
//
// Autenticação: mesma sonda SSO cookie-forward dos outros endpoints /api/gestao/*
// (probe ao AzuraCast admin gate). Em dev, GESTAO_DEV_BYPASS salta a verificação.

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AZURACAST_BASE_URL,
  GESTAO_ADMIN_GATE,
  AZ_PROBE_TIMEOUT_MS,
  ITFM_MEDIA_DIR,
  GESTAO_DEV_BYPASS,
} from "@/app/gestao/_lib/config";

const SENTINEL = ".itfm_fire_news";

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

  // 2. Verify the media dir exists and is writable
  const sentinelPath = path.join(ITFM_MEDIA_DIR, SENTINEL);

  try {
    await fs.access(ITFM_MEDIA_DIR, fs.constants.W_OK);
  } catch {
    return Response.json(
      { error: "Media directory not accessible", path: ITFM_MEDIA_DIR },
      { status: 503 },
    );
  }

  // 3. Write the sentinel file (empty — Liquidsoap only checks existence)
  try {
    await fs.writeFile(sentinelPath, "", { mode: 0o644 });
  } catch (err) {
    return Response.json(
      { error: "Failed to write sentinel", detail: String(err) },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, sentinel: sentinelPath });
}
