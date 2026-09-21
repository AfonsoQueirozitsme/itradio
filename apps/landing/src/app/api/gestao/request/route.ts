// Pedir ao AzuraCast para meter uma faixa na fila (request). Usa a sessão SSO
// do operador (cookie-forward) para chamar a API admin. Fallback: se não temos
// o media ID, procuramos por path (GET /station/{id}/files?searchPhrase=...).

import { NextRequest } from "next/server";
import {
  AZURACAST_BASE_URL,
  GESTAO_ADMIN_GATE,
  AZ_PROBE_TIMEOUT_MS,
  AZ_STATION_ID,
  GESTAO_DEV_BYPASS,
} from "@/app/gestao/_lib/config";

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

async function azPost(apiPath: string, cookie: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(`${AZURACAST_BASE_URL}${apiPath}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(AZ_PROBE_TIMEOUT_MS * 2),
    });
  } catch {
    return null;
  }
}

async function azGet(apiPath: string, cookie: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${AZURACAST_BASE_URL}${apiPath}`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(AZ_PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // 1. Auth
  const cookie = request.headers.get("cookie");
  if (!GESTAO_DEV_BYPASS) {
    if (!cookie) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await validateSession(cookie);
    if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: { mediaId?: number; path?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const effectiveCookie = cookie ?? "";

  // 3. Resolve media ID if only path given
  let mediaId = body.mediaId;
  if (!mediaId && body.path) {
    const searchPath = body.path.split("/").pop() ?? body.path;
    const files = await azGet(
      `/api/station/${AZ_STATION_ID}/files?searchPhrase=${encodeURIComponent(searchPath)}`,
      effectiveCookie,
    );
    if (Array.isArray(files) && files.length > 0) {
      const match = files.find(
        (f: Record<string, unknown>) =>
          typeof f.path === "string" && f.path.endsWith(body.path!),
      ) ?? files[0];
      mediaId = (match as Record<string, unknown>).id as number | undefined;
    }
    if (!mediaId) {
      return Response.json(
        { error: "Ficheiro não encontrado no AzuraCast", path: body.path },
        { status: 404 },
      );
    }
  }

  if (!mediaId) {
    return Response.json({ error: "mediaId ou path necessário" }, { status: 400 });
  }

  // 4. Request the track
  const res = await azPost(
    `/api/station/${AZ_STATION_ID}/requests/${mediaId}`,
    effectiveCookie,
  );

  if (!res) {
    return Response.json({ error: "AzuraCast indisponível" }, { status: 503 });
  }

  if (res.status === 200 || res.status === 202) {
    return Response.json({ ok: true, mediaId });
  }

  const detail = await res.text().catch(() => "");
  return Response.json(
    { error: `AzuraCast ${res.status}`, detail },
    { status: res.status },
  );
}
