"use client";

// Explorador de ficheiros standalone para a gestao. Navega pelo apps/station
// via /api/gestao/files, permite upload, criacao de pastas e preview de audio.

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "./ui";
import {
  IconFolder,
  IconFile,
  IconMusica,
  IconPlay,
  IconClose,
  IconChevronRight,
  IconUpload,
  IconFolderPlus,
  IconDownload,
} from "./icons";

// ── Audio extensions recognized for preview ──────────────────────────────
const AUDIO_EXTS = new Set([
  ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus",
]);

// ── Types ────────────────────────────────────────────────────────────────
interface FileEntry {
  name: string;
  type: "dir" | "file";
  size?: number;
  ext?: string;
}

interface FilesResponse {
  path: string;
  entries: FileEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function extLabel(ext: string | undefined): string {
  if (!ext) return "Ficheiro";
  const e = ext.replace(".", "").toUpperCase();
  if (AUDIO_EXTS.has(ext)) return `Audio ${e}`;
  return e;
}

// ── Component ────────────────────────────────────────────────────────────
export default function FileExplorer() {
  const [currentDir, setCurrentDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Fetch directory listing ────────────────────────────────────────────
  const fetchDir = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    setPreviewSrc(null);
    setUploadMsg(null);
    try {
      const res = await fetch(
        `/api/gestao/files?dir=${encodeURIComponent(dir)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data: FilesResponse = await res.json();
      setEntries(data.entries);
      setCurrentDir(data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar ficheiros");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir("");
  }, [fetchDir]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  // ── Breadcrumbs ────────────────────────────────────────────────────────
  const segments = currentDir ? currentDir.split("/") : [];
  const crumbs = [
    { label: "station", path: "" },
    ...segments.map((seg, i) => ({
      label: seg,
      path: segments.slice(0, i + 1).join("/"),
    })),
  ];

  // ── Navigate ───────────────────────────────────────────────────────────
  function navigateTo(dir: string) {
    audioRef.current?.pause();
    setPreviewSrc(null);
    fetchDir(dir);
  }

  // ── Audio preview ──────────────────────────────────────────────────────
  function togglePreview(filePath: string) {
    if (previewSrc === filePath) {
      audioRef.current?.pause();
      setPreviewSrc(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewSrc(filePath);
  }

  // ── Upload ─────────────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/gestao/files?dir=${encodeURIComponent(currentDir)}`,
        { method: "POST", body: fd },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setUploadMsg(`Enviado: ${file.name}`);
      // Refresh listing
      await fetchDir(currentDir);
    } catch (e) {
      setUploadMsg(
        `Erro: ${e instanceof Error ? e.message : "falha no upload"}`,
      );
    } finally {
      setUploading(false);
      // Reset the file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  // ── Create folder ──────────────────────────────────────────────────────
  async function handleCreateFolder() {
    const name = window.prompt("Nome da nova pasta:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();

    // Basic validation
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
      setUploadMsg("Erro: nome de pasta invalido");
      return;
    }

    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await fetch(
        `/api/gestao/files?dir=${encodeURIComponent(currentDir)}&mkdir=${encodeURIComponent(trimmed)}`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setUploadMsg(`Pasta criada: ${trimmed}`);
      await fetchDir(currentDir);
    } catch (e) {
      setUploadMsg(
        `Erro: ${e instanceof Error ? e.message : "falha ao criar pasta"}`,
      );
    } finally {
      setUploading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Card className="overflow-hidden">
      {/* Toolbar: breadcrumbs + actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        {/* Breadcrumbs */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && (
                <IconChevronRight className="h-3 w-3 text-[var(--gray)]/50" />
              )}
              <button
                type="button"
                onClick={() => navigateTo(c.path)}
                className={`rounded px-1 py-0.5 transition-colors ${
                  i === crumbs.length - 1
                    ? "font-semibold text-[var(--ink)]"
                    : "text-[var(--gray)] hover:text-[var(--ink)]"
                }`}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreateFolder}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--card)] disabled:opacity-50"
          >
            <IconFolderPlus className="h-3.5 w-3.5" />
            Nova pasta
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-[#0b3d1a] transition-colors hover:scale-105 disabled:opacity-50"
          >
            <IconUpload className="h-3.5 w-3.5" />
            {uploading ? "A enviar..." : "Enviar ficheiro"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFileInputChange}
          />
        </div>
      </div>

      {/* Upload feedback */}
      {uploadMsg && (
        <div
          className={`flex items-center justify-between border-b border-[var(--line)] px-4 py-2 text-xs ${
            uploadMsg.startsWith("Erro")
              ? "bg-red-50 text-red-700"
              : "bg-brand/10 text-[#0b3d1a]"
          }`}
        >
          <span>{uploadMsg}</span>
          <button
            type="button"
            onClick={() => setUploadMsg(null)}
            className="ml-2 opacity-60 hover:opacity-100"
          >
            <IconClose className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--gray)]">
            A carregar...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 text-sm text-red-500">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-[var(--gray)]">
            <IconFolder className="h-8 w-8 opacity-30" />
            Pasta vazia
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                <th className="px-4 py-2.5">Nome</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Tipo</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Tamanho</th>
                <th className="px-4 py-2.5 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isDir = entry.type === "dir";
                const isAudio =
                  !isDir && entry.ext ? AUDIO_EXTS.has(entry.ext) : false;
                const filePath = joinPath(currentDir, entry.name);

                return (
                  <tr
                    key={entry.name}
                    className={`border-b border-[var(--line)] transition-colors last:border-b-0 ${
                      isDir
                        ? "cursor-pointer hover:bg-[var(--bg)]"
                        : "hover:bg-[var(--bg)]/50"
                    }`}
                    onClick={() => {
                      if (isDir) navigateTo(filePath);
                    }}
                  >
                    {/* Name */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--gray)]">
                          {isDir ? (
                            <IconFolder className="h-4 w-4" />
                          ) : isAudio ? (
                            <IconMusica className="h-4 w-4" />
                          ) : (
                            <IconFile className="h-4 w-4" />
                          )}
                        </span>
                        <span className="truncate font-medium text-[var(--ink)]">
                          {entry.name}
                        </span>
                        {isDir && (
                          <IconChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--gray)]/40" />
                        )}
                      </div>
                    </td>

                    {/* Type */}
                    <td className="hidden px-4 py-2.5 text-[var(--gray)] sm:table-cell">
                      {isDir ? "Pasta" : extLabel(entry.ext)}
                    </td>

                    {/* Size */}
                    <td className="hidden px-4 py-2.5 tabular-nums text-[var(--gray)] sm:table-cell">
                      {isDir ? "--" : entry.size != null ? formatSize(entry.size) : "--"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isAudio && (
                          <>
                            <button
                              type="button"
                              title="Pre-visualizar"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePreview(filePath);
                              }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                                previewSrc === filePath
                                  ? "bg-brand text-[#0b3d1a]"
                                  : "bg-[var(--bg)] text-[var(--gray)] hover:text-[var(--ink)]"
                              }`}
                            >
                              {previewSrc === filePath ? (
                                <IconStop className="h-3 w-3" />
                              ) : (
                                <IconPlay className="h-3 w-3" />
                              )}
                            </button>
                            <a
                              href={`/api/gestao/audio?path=${encodeURIComponent(filePath)}`}
                              download={entry.name}
                              title="Descarregar"
                              onClick={(e) => e.stopPropagation()}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg)] text-[var(--gray)] transition-colors hover:text-[var(--ink)]"
                            >
                              <IconDownload className="h-3 w-3" />
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Hidden audio element for preview */}
      {previewSrc && (
        <audio
          ref={audioRef}
          src={`/api/gestao/audio?path=${encodeURIComponent(previewSrc)}`}
          autoPlay
          onEnded={() => setPreviewSrc(null)}
        />
      )}
    </Card>
  );
}

// ── Inline stop icon ─────────────────────────────────────────────────────
function IconStop({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}
