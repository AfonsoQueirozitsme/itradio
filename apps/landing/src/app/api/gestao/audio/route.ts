// Proxy de audio: serve ficheiros do apps/station ao browser para previews na
// gestao. Autenticado pela sessao SSO do AzuraCast (mesmo mecanismo do CMS).
// Suporta Range requests para seeking no <audio>.

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AZURACAST_BASE_URL,
  GESTAO_ADMIN_GATE,
  AZ_PROBE_TIMEOUT_MS,
  ITFM_STATION_DIR,
  GESTAO_DEV_BYPASS,
} from "@/app/gestao/_lib/config";

// ── Audio extensions whitelist ──────────────────────────────────────────────
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"]);

const MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".opus": "audio/opus",
};

// ── Station dir resolution (same candidates as azuracast-read.ts) ───────────
const STATION_DIR_CANDIDATES = [
  ITFM_STATION_DIR,
  path.resolve(process.cwd(), "../station"),
  path.resolve(process.cwd(), "apps/station"),
  "/home/itradio/itradio/apps/station",
].filter((p): p is string => typeof p === "string" && p.length > 0);

let _stationDir: string | null | undefined;

async function resolveStationDir(): Promise<string | null> {
  if (_stationDir !== undefined) return _stationDir;
  for (const dir of STATION_DIR_CANDIDATES) {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) {
        _stationDir = dir;
        return dir;
      }
    } catch {
      // next candidate
    }
  }
  _stationDir = null;
  return null;
}

// ── Auth: lightweight probe (same as azProbe but standalone to avoid importing
// React cache() and next/headers outside RSC context) ────────────────────────
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

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 1. Extract & validate `path` query param
  const relPath = request.nextUrl.searchParams.get("path");
  if (!relPath) {
    return new Response("Missing ?path parameter", { status: 400 });
  }

  // 2. Security: reject path traversal
  if (relPath.includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }

  // 3. Security: only allow audio extensions
  const ext = path.extname(relPath).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) {
    return new Response("Unsupported file type", { status: 400 });
  }

  // 4. Auth: check AzuraCast session (or dev bypass)
  if (!GESTAO_DEV_BYPASS) {
    const cookie = request.headers.get("cookie");
    if (!cookie) {
      return new Response("Unauthorized", { status: 401 });
    }
    const ok = await validateSession(cookie);
    if (!ok) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 5. Resolve station dir and build absolute path
  const stationDir = await resolveStationDir();
  if (!stationDir) {
    return new Response("Station directory not found", { status: 404 });
  }

  const absPath = path.resolve(stationDir, relPath);

  // Extra guard: resolved path must stay inside station dir
  if (!absPath.startsWith(stationDir + path.sep) && absPath !== stationDir) {
    return new Response("Invalid path", { status: 400 });
  }

  // 6. Stat the file
  let fileStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    fileStat = await fs.stat(absPath);
    if (!fileStat.isFile()) {
      return new Response("Not found", { status: 404 });
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const fileSize = fileStat.size;
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  // 7. Handle Range requests (for seeking)
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return new Response("Invalid Range", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const { createReadStream } = await import("node:fs");
    const stream = createReadStream(absPath, { start, end });
    const readable = readableFromNode(stream);

    return new Response(readable, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // 8. Full file response
  const { createReadStream } = await import("node:fs");
  const stream = createReadStream(absPath);
  const readable = readableFromNode(stream);

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Convert a Node.js ReadStream into a web ReadableStream for the Response body.
function readableFromNode(
  nodeStream: import("node:fs").ReadStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}
