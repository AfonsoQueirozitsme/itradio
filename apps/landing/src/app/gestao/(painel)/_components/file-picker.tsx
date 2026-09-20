"use client";

// File picker / media browser para a gestão. Navega pelo apps/station via
// /api/gestao/files e permite seleccionar ficheiros áudio (preview inline via
// /api/gestao/audio). Estilo drawer consistente com o settings-panel.

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose, IconPlay, IconChevronRight } from "./icons";

// ── Audio extensions recognized for preview / selection ────────────────────
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"]);

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FilePicker({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentDir, setCurrentDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch directory listing
  const fetchDir = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setPreviewSrc(null);
    try {
      const res = await fetch(`/api/gestao/files?dir=${encodeURIComponent(dir)}`);
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

  // Keyboard: Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  // ── Breadcrumb segments ────────────────────────────────────────────────
  const segments = currentDir ? currentDir.split("/") : [];
  const crumbs = [
    { label: "station", path: "" },
    ...segments.map((seg, i) => ({
      label: seg,
      path: segments.slice(0, i + 1).join("/"),
    })),
  ];

  // ── Navigate into a directory ──────────────────────────────────────────
  function navigateTo(dir: string) {
    audioRef.current?.pause();
    setPreviewSrc(null);
    fetchDir(dir);
  }

  // ── Preview audio ─────────────────────────────────────────────────────
  function togglePreview(filePath: string) {
    if (previewSrc === filePath) {
      audioRef.current?.pause();
      setPreviewSrc(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewSrc(filePath);
  }

  // ── Select file ───────────────────────────────────────────────────────
  function handleSelect(entry: FileEntry) {
    const isAudio = entry.ext ? AUDIO_EXTS.has(entry.ext) : false;
    if (!isAudio) return;
    const filePath = joinPath(currentDir, entry.name);
    setSelected(filePath);
  }

  function confirmSelection() {
    if (selected) {
      onSelect(selected);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-lg flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <IconFolder className="h-4 w-4 text-[var(--gray)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">
              Procurar ficheiros
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--line)] px-4 py-2 text-xs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <IconChevronRight className="h-3 w-3 text-[var(--gray)]/50" />}
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
        </div>

        {/* File listing */}
        <div className="flex-1 overflow-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--gray)]">
              A carregar...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-sm text-red-500">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--gray)]">
              Pasta vazia
            </div>
          ) : (
            <div className="space-y-0.5">
              {entries.map((entry) => {
                const isDir = entry.type === "dir";
                const isAudio = !isDir && entry.ext ? AUDIO_EXTS.has(entry.ext) : false;
                const filePath = joinPath(currentDir, entry.name);
                const isSelected = selected === filePath;

                return (
                  <div
                    key={entry.name}
                    className={[
                      "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      isDir
                        ? "cursor-pointer hover:bg-[var(--bg)]"
                        : isAudio
                          ? `cursor-pointer hover:bg-[var(--bg)] ${isSelected ? "bg-brand/10 ring-1 ring-brand/30" : ""}`
                          : "cursor-default opacity-40",
                    ].join(" ")}
                    onClick={() => {
                      if (isDir) navigateTo(filePath);
                      else if (isAudio) handleSelect(entry);
                    }}
                  >
                    {/* Icon */}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--gray)]">
                      {isDir ? (
                        <IconFolder className="h-4 w-4" />
                      ) : isAudio ? (
                        <IconAudio className="h-4 w-4" />
                      ) : (
                        <IconFile className="h-4 w-4" />
                      )}
                    </span>

                    {/* Name + meta */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[var(--ink)]">
                        {entry.name}
                      </div>
                      {!isDir && entry.size != null ? (
                        <div className="text-[10px] text-[var(--gray)]">
                          {formatSize(entry.size)}
                          {entry.ext ? ` · ${entry.ext.replace(".", "").toUpperCase()}` : ""}
                        </div>
                      ) : null}
                    </div>

                    {/* Preview button for audio files */}
                    {isAudio ? (
                      <button
                        type="button"
                        title="Pré-visualizar"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreview(filePath);
                        }}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
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
                    ) : isDir ? (
                      <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--gray)]/40" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Audio preview element (hidden) */}
        {previewSrc ? (
          <audio
            ref={audioRef}
            src={`/api/gestao/audio?path=${encodeURIComponent(previewSrc)}`}
            autoPlay
            onEnded={() => setPreviewSrc(null)}
          />
        ) : null}

        {/* Footer with select button */}
        <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3">
          <span className="truncate text-xs text-[var(--gray)]">
            {selected ? selected : "Nenhum ficheiro selecionado"}
          </span>
          <button
            type="button"
            disabled={!selected}
            onClick={confirmSelection}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
              selected
                ? "bg-brand text-[#0b3d1a] hover:scale-105"
                : "cursor-not-allowed bg-[var(--bg)] text-[var(--gray)]"
            }`}
          >
            Selecionar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline SVG icons (small, local to this component) ─────────────────────

function IconFolder({ className }: { className?: string }) {
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
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </svg>
  );
}

function IconAudio({ className }: { className?: string }) {
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
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

function IconFile({ className }: { className?: string }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

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
