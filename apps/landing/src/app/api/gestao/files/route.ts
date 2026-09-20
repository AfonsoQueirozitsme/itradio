// API de ficheiros: lista directórios e ficheiros do apps/station para o
// file-picker da gestão. Autenticado pela sessão SSO do AzuraCast (mesmo
// mecanismo do proxy de áudio).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AZURACAST_BASE_URL,
  GESTAO_ADMIN_GATE,
  AZ_PROBE_TIMEOUT_MS,
  ITFM_STATION_DIR,
  GESTAO_DEV_BYPASS,
} from "@/app/gestao/_lib/config";

// ── Hidden / irrelevant entries to skip ────────────────────────────────────
const SKIP_NAMES = new Set(["node_modules", ".git"]);

// ── Station dir resolution (same candidates as audio/route.ts) ─────────────
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

// ── Auth: lightweight probe (standalone — no React cache / next/headers) ───
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

// ── Types ──────────────────────────────────────────────────────────────────
interface FileEntry {
  name: string;
  type: "dir" | "file";
  size?: number;
  ext?: string;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 1. Extract `dir` query param (default: root)
  const relDir = request.nextUrl.searchParams.get("dir") ?? "";

  // 2. Security: reject path traversal
  if (relDir.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // 3. Auth: check AzuraCast session (or dev bypass)
  if (!GESTAO_DEV_BYPASS) {
    const cookie = request.headers.get("cookie");
    if (!cookie) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ok = await validateSession(cookie);
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 4. Resolve station dir
  const stationDir = await resolveStationDir();
  if (!stationDir) {
    return NextResponse.json(
      { error: "Station directory not found" },
      { status: 404 },
    );
  }

  // 5. Build absolute path and guard containment
  const absDir = path.resolve(stationDir, relDir);
  if (!absDir.startsWith(stationDir + path.sep) && absDir !== stationDir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // 6. Read directory (names only — avoids Dirent generic issues across Node types)
  let names: string[];
  try {
    names = await fs.readdir(absDir);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 7. Build entries, skipping hidden and irrelevant
  const dirs: FileEntry[] = [];
  const files: FileEntry[] = [];

  for (const name of names) {
    if (name.startsWith(".") || SKIP_NAMES.has(name)) continue;

    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(path.join(absDir, name));
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      dirs.push({ name, type: "dir" });
    } else if (st.isFile()) {
      const ext = path.extname(name).toLowerCase() || undefined;
      files.push({ name, type: "file", size: st.size, ext });
    }
  }

  // Sort alphabetically
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    path: relDir,
    entries: [...dirs, ...files],
  });
}

// ── Allowed extensions for upload ─────────────────────────────────────────
const ALLOWED_EXTS = new Set([
  ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus",
  ".json", ".mjs", ".js", ".py", ".liq",
  ".txt", ".tsv", ".csv", ".md",
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ── POST handler: file upload + mkdir ─────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Auth: check AzuraCast session (or dev bypass)
  if (!GESTAO_DEV_BYPASS) {
    const cookie = request.headers.get("cookie");
    if (!cookie) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ok = await validateSession(cookie);
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 2. Resolve station dir
  const stationDir = await resolveStationDir();
  if (!stationDir) {
    return NextResponse.json(
      { error: "Station directory not found" },
      { status: 404 },
    );
  }

  const dirParam = request.nextUrl.searchParams.get("dir") ?? "";
  const mkdirParam = request.nextUrl.searchParams.get("mkdir");

  // Security: reject path traversal
  if (dirParam.includes("..") || (mkdirParam && mkdirParam.includes(".."))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // ── mkdir mode ────────────────────────────────────────────────────────
  if (mkdirParam) {
    // Validate folder name (no slashes, no ..)
    if (mkdirParam.includes("/") || mkdirParam.includes("\\")) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    const target = path.resolve(stationDir, dirParam, mkdirParam);
    if (!target.startsWith(stationDir + path.sep) && target !== stationDir) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    try {
      await fs.mkdir(target, { recursive: true });
      const rel = path.relative(stationDir, target);
      return NextResponse.json({ ok: true, path: rel });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to create directory" },
        { status: 500 },
      );
    }
  }

  // ── file upload mode ──────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Size check
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  // Extension check
  const ext = path.extname(file.name).toLowerCase();
  if (!ext || !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `Extension not allowed: ${ext || "(none)"}` },
      { status: 415 },
    );
  }

  // Filename security: reject path separators
  const baseName = path.basename(file.name);
  if (baseName !== file.name || baseName.includes("..")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  // Build absolute path and guard containment
  const absDir = path.resolve(stationDir, dirParam);
  if (!absDir.startsWith(stationDir + path.sep) && absDir !== stationDir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const absFile = path.join(absDir, baseName);
  if (!absFile.startsWith(stationDir + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    // Ensure target directory exists
    await fs.mkdir(absDir, { recursive: true });

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absFile, buffer);

    const relPath = path.relative(stationDir, absFile);
    return NextResponse.json({ ok: true, path: relPath });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to write file" },
      { status: 500 },
    );
  }
}
