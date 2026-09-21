"use client";

// Consola LIVE. Mostra o ALINHAMENTO ao ar (material pronto com hora prevista):
// locutores, jingles, blocos de publicidade, músicas, segmentos, notícias — não
// jobs. As horas são calculadas a partir da ordem + durações, por isso arrastar
// um item recalcula tudo. O que está a tocar aparece a verde com barra de
// progresso. Itens ainda por ir ao ar podem ser reordenados e removidos.
//
// Funcionalidades:
//  • "Meter no ar" — dispara um item no AzuraCast (request) ou notícias (sentinel).
//  • "Novo" — abre um explorador de ficheiros à esquerda; arrastar ficheiros
//    áudio para o alinhamento adiciona-os à fila.
//  • Preview drawer — pré-visualização de áudio e texto, ação de disparar.

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, StatusChip } from "./ui";
import Soundboard from "./soundboard";
import { IconPlay, IconClose, IconGrip, IconTrash, IconAlert, IconFolder, IconChevronRight, IconSearch } from "./icons";
import type { LiveData, LiveItem, LiveKind } from "../../_lib/live";
import type { SoundPad } from "../../_lib/settings";
import { type Estado, buildSchedule, fmtClock, fmtDur, parseHHMM } from "../../_lib/live-schedule";

const KIND: Record<LiveKind, { label: string; dot: string }> = {
  locutor: { label: "Locutor", dot: "bg-rose-400" },
  jingle: { label: "Jingle", dot: "bg-violet-400" },
  anuncio: { label: "Publicidade", dot: "bg-amber-400" },
  musica: { label: "Música", dot: "bg-brand" },
  segmento: { label: "Segmento", dot: "bg-sky-400" },
  noticias: { label: "Notícias", dot: "bg-emerald-400" },
};

const HIST_PAGE = 10;

const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"]);

export default function LiveConsole({ data, pads }: { data: LiveData; pads: (SoundPad | null)[] }) {
  const [histCount, setHistCount] = useState(data.historialVisivel);
  const fullHist = data.historial;
  const hasMoreHist = histCount < fullHist.length;

  const visibleHist = histCount > 0 ? fullHist.slice(-histCount) : [];
  const futureItems = data.itens.slice(data.historialVisivel);
  const [futureOverride, setFutureOverride] = useState<LiveItem[] | null>(null);
  const currentFuture = futureOverride ?? futureItems;
  const allVisible = [...visibleHist, ...currentFuture];

  const visibleHistDur = visibleHist.reduce((acc, it) => acc + it.duracao, 0);
  const baseFutureDur = futureItems.length > 0
    ? Math.max(0, data.decorridoInicial - data.itens.slice(0, data.historialVisivel).reduce((a, it) => a + it.duracao, 0))
    : 0;
  const computedDecorrido = visibleHistDur + baseFutureDur;

  const [nowSec, setNowSec] = useState<number>(computedDecorrido);
  const [selected, setSelected] = useState<LiveItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showExplorer, setShowExplorer] = useState(false);
  const [externalDragOver, setExternalDragOver] = useState(false);

  const blocoInicioSec = (() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    return Math.max(0, h * 3600 + m * 60 - computedDecorrido);
  })();
  const anchorRef = useRef(Date.now());

  useEffect(() => {
    const anchor = anchorRef.current;
    const base = computedDecorrido;

    const sync = () => setNowSec(base + Math.floor((Date.now() - anchor) / 1000));
    const id = setInterval(sync, 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [computedDecorrido]);

  const rows = buildSchedule(allVisible, blocoInicioSec, nowSec);
  const firstScheduledIdx = rows.findIndex((r) => r.estado === "scheduled");
  const restantes = rows.filter((r) => r.estado === "scheduled").length;
  const playingRef = useRef<HTMLLIElement>(null);
  const didScrollRef = useRef(false);

  useEffect(() => {
    if (!didScrollRef.current && playingRef.current) {
      playingRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      didScrollRef.current = true;
    }
  });

  function loadMoreHistory() {
    setHistCount((c) => Math.min(c + HIST_PAGE, fullHist.length));
  }

  function canEdit(id: string) {
    const r = rows.find((x) => x.item.id === id);
    return r?.estado === "scheduled";
  }
  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    if (!canEdit(dragId) || !canEdit(targetId)) return;
    const prev = currentFuture;
    const from = prev.findIndex((i) => i.id === dragId);
    const to = prev.findIndex((i) => i.id === targetId);
    if (from < 0 || to < 0) return;
    const next = prev.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setFutureOverride(next);
  }
  function removeItem(id: string) {
    if (!canEdit(id)) return;
    setFutureOverride((currentFuture).filter((i) => i.id !== id));
    setSelected(null);
  }

  // Drop de ficheiros do explorador para o alinhamento
  function handleExternalDrop(e: React.DragEvent) {
    e.preventDefault();
    setExternalDragOver(false);
    const filePath = e.dataTransfer.getData("application/x-itfm-file");
    if (!filePath) return;
    const fileName = filePath.split("/").pop() ?? filePath;
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
    if (!AUDIO_EXTS.has(ext)) return;

    const newItem: LiveItem = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "musica",
      titulo: fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
      detalhe: "adicionado manualmente",
      duracao: 210,
      fonte: filePath,
      preview: { tipo: "audio", corpo: filePath, meta: "~3:30" },
    };
    setFutureOverride([...currentFuture, newItem]);
  }

  return (
    <>
      <Soundboard pads={pads} />

      <div className="flex gap-4">
        {/* Explorador de ficheiros (painel esquerdo) */}
        {showExplorer ? (
          <div className="hidden w-[320px] shrink-0 md:block">
            <FileExplorerSidebar onClose={() => setShowExplorer(false)} />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <nav className="flex items-center gap-1.5 text-xs text-[var(--gray)]">
                <span>Gestão</span>
                <span aria-hidden="true">/</span>
                <span className="text-[var(--ink)]">Live</span>
              </nav>
              <h1 className="mt-1 font-[family-name:var(--font-logo)] text-[26px] font-semibold tracking-tight text-[var(--ink)]">
                Alinhamento ao vivo
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowExplorer((v) => !v)}
                className={[
                  "hidden items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors md:flex",
                  showExplorer
                    ? "border-brand bg-brand text-[#0b3d1a]"
                    : "border-[var(--line)] text-[var(--ink)] hover:border-[var(--ink)]/30 hover:bg-[var(--bg)]",
                ].join(" ")}
              >
                <IconFolder className="h-4 w-4" />
                {showExplorer ? "Fechar" : "Novo"}
              </button>
              <div className="text-right text-xs text-[var(--gray)]">
                <div className="font-medium text-[var(--ink)]">{data.now.programa}</div>
                <div>
                  {restantes} a seguir · {visibleHist.length} anteriores{hasMoreHist ? ` (de ${fullHist.length})` : ""}
                </div>
              </div>
            </div>
          </div>

          <Card
            className={[
              "p-2 sm:p-3 transition-colors",
              externalDragOver ? "ring-2 ring-brand/50 bg-brand/5" : "",
            ].join(" ")}
          >
            {hasMoreHist ? (
              <button
                type="button"
                onClick={loadMoreHistory}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line)] py-2 text-xs font-semibold text-[var(--gray)] transition-colors hover:border-[var(--ink)]/30 hover:text-[var(--ink)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                Carregar anteriores ({fullHist.length - histCount} restantes)
              </button>
            ) : null}
            <ul
              className="space-y-1.5"
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer.types.includes("application/x-itfm-file")) {
                  setExternalDragOver(true);
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
                  setExternalDragOver(false);
                }
              }}
              onDrop={handleExternalDrop}
            >
              {rows.map((r) => {
                const k = KIND[r.item.kind];
                const editable = r.estado === "scheduled";
                return (
                  <li
                    key={r.item.id}
                    ref={r.estado === "playing" ? playingRef : undefined}
                    draggable={editable}
                    onDragStart={() => setDragId(r.item.id)}
                    onDragEnter={() => {
                      if (editable) setOverId(r.item.id);
                      reorder(r.item.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    className={[
                      "relative flex items-stretch gap-2 overflow-hidden rounded-xl border p-2.5 transition-colors",
                      r.estado === "playing"
                        ? "border-brand bg-brand/5 ring-1 ring-brand/40"
                        : r.estado === "aired"
                          ? "border-[var(--line)] bg-[var(--bg)]/40 opacity-55"
                          : "border-[var(--line)] bg-[var(--card)] hover:border-[var(--ink)]/20",
                      dragId === r.item.id ? "opacity-40" : "",
                      overId === r.item.id && dragId && dragId !== r.item.id ? "ring-1 ring-[var(--ink)]/30" : "",
                      editable ? "cursor-grab active:cursor-grabbing" : "",
                    ].join(" ")}
                  >
                    {/* pega de arrasto */}
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {editable ? (
                        <IconGrip className="h-4 w-4 text-[var(--gray)]/60" />
                      ) : r.estado === "playing" ? (
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                        </span>
                      ) : null}
                    </span>

                    {/* hora */}
                    <span className="w-11 shrink-0 pt-0.5 font-[family-name:var(--font-logo)] text-xs font-semibold tabular-nums text-[var(--gray)]">
                      {fmtClock(r.startAbs)}
                    </span>

                    {/* corpo */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${k.dot}`} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                          {k.label}
                        </span>
                        {r.estado === "playing" ? (
                          <StatusChip tone="live" dot>
                            No ar
                          </StatusChip>
                        ) : null}
                        <span className="text-sm font-medium text-[var(--ink)]">{r.item.titulo}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--gray)]">
                        {r.item.detalhe} · <span className="opacity-70">{r.item.fonte}</span>
                      </div>
                      {r.estado === "playing" ? (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg)]">
                            <div
                              className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
                              style={{ width: `${r.progress}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--gray)]">
                            {fmtDur(Math.max(0, nowSec - r.relStart))} / {fmtDur(r.item.duracao)}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* duração + ver */}
                    <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                      <span className="text-[11px] tabular-nums text-[var(--gray)]">{fmtDur(r.item.duracao)}</span>
                      {r.item.preview || editable ? (
                        <button
                          type="button"
                          onClick={() => setSelected(r.item)}
                          className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)]/30 hover:bg-[var(--bg)]"
                        >
                          Ver
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {externalDragOver ? (
                <li className="flex items-center justify-center rounded-xl border-2 border-dashed border-brand/50 bg-brand/5 py-6 text-sm font-semibold text-[#0b3d1a]">
                  Largar aqui para adicionar ao alinhamento
                </li>
              ) : null}
            </ul>
          </Card>

          <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Historial + fila reais do AzuraCast. Arraste ficheiros do explorador para adicionar ao alinhamento; reordene arrastando os cartões.
          </p>
        </div>
      </div>

      {selected ? (
        <PreviewDrawer
          item={selected}
          estado={rows.find((r) => r.item.id === selected.id)?.estado ?? "scheduled"}
          onClose={() => setSelected(null)}
          onRemove={() => removeItem(selected.id)}
        />
      ) : null}
    </>
  );
}

// ── Explorador de ficheiros (painel lateral esquerdo) ───────────────────────
interface FileEntry {
  name: string;
  type: "dir" | "file";
  size?: number;
  ext?: string;
}

function FileExplorerSidebar({ onClose }: { onClose: () => void }) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchDir = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setPreviewSrc(null);
    try {
      const res = await fetch(`/api/gestao/files?dir=${encodeURIComponent(d)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { path: string; entries: FileEntry[] } = await res.json();
      setEntries(data.entries);
      setDir(data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDir(""); }, [fetchDir]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const segments = dir ? dir.split("/") : [];
  const crumbs = [
    { label: "station", path: "" },
    ...segments.map((s, i) => ({ label: s, path: segments.slice(0, i + 1).join("/") })),
  ];

  function togglePreview(filePath: string) {
    if (previewSrc === filePath) {
      audioRef.current?.pause();
      setPreviewSrc(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewSrc(filePath);
  }

  const filtered = search
    ? entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries;

  return (
    <Card className="flex h-[calc(100dvh-180px)] flex-col overflow-hidden p-0">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <IconFolder className="h-4 w-4 text-[var(--gray)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Ficheiros</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
        >
          <IconClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* search */}
      <div className="border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-xs">
          <IconSearch className="h-3.5 w-3.5 text-[var(--gray)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar..."
            className="w-full bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--gray)]"
          />
        </div>
      </div>

      {/* breadcrumbs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-[var(--line)] px-3 py-1.5 text-[10px]">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-0.5 whitespace-nowrap">
            {i > 0 && <IconChevronRight className="h-2.5 w-2.5 text-[var(--gray)]/40" />}
            <button
              type="button"
              onClick={() => { setSearch(""); fetchDir(c.path); }}
              className={i === crumbs.length - 1
                ? "font-semibold text-[var(--ink)]"
                : "text-[var(--gray)] hover:text-[var(--ink)]"
              }
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {/* file list */}
      <div className="flex-1 overflow-auto px-1.5 py-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--gray)]">A carregar...</div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-xs text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--gray)]">Vazio</div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((entry) => {
              const isDir = entry.type === "dir";
              const isAudio = !isDir && entry.ext ? AUDIO_EXTS.has(entry.ext) : false;
              const filePath = dir ? `${dir}/${entry.name}` : entry.name;

              return (
                <div
                  key={entry.name}
                  draggable={isAudio}
                  onDragStart={(e) => {
                    if (!isAudio) return;
                    e.dataTransfer.setData("application/x-itfm-file", filePath);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    if (isDir) { setSearch(""); fetchDir(filePath); }
                    else if (isAudio) togglePreview(filePath);
                  }}
                  className={[
                    "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                    isDir
                      ? "cursor-pointer hover:bg-[var(--bg)]"
                      : isAudio
                        ? "cursor-grab hover:bg-[var(--bg)] active:cursor-grabbing"
                        : "opacity-35",
                    previewSrc === filePath ? "bg-brand/10 ring-1 ring-brand/30" : "",
                  ].join(" ")}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--bg)] text-[var(--gray)]">
                    {isDir ? (
                      <IconFolder className="h-3.5 w-3.5" />
                    ) : isAudio ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" /><path d="M14 2v6h6" /></svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--ink)]">{entry.name}</div>
                    {!isDir && entry.size != null ? (
                      <div className="text-[10px] text-[var(--gray)]">
                        {entry.size < 1024 * 1024
                          ? `${(entry.size / 1024).toFixed(0)} KB`
                          : `${(entry.size / (1024 * 1024)).toFixed(1)} MB`}
                      </div>
                    ) : null}
                  </div>
                  {isDir ? (
                    <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--gray)]/40" />
                  ) : isAudio ? (
                    <span className="shrink-0 text-[10px] text-[var(--gray)] opacity-0 transition-opacity group-hover:opacity-100">
                      arrasta
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewSrc ? (
        <audio
          ref={audioRef}
          src={`/api/gestao/audio?path=${encodeURIComponent(previewSrc)}`}
          autoPlay
          onEnded={() => setPreviewSrc(null)}
        />
      ) : null}

      <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--gray)]">
        Arrasta ficheiros áudio para o alinhamento
      </div>
    </Card>
  );
}

// ── Drawer de pré-visualização + ação ───────────────────────────────────────
function PreviewDrawer({
  item,
  estado,
  onClose,
  onRemove,
}: {
  item: LiveItem;
  estado: Estado;
  onClose: () => void;
  onRemove: () => void;
}) {
  const p = item.preview;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const k = KIND[item.kind];
  const removivel = estado === "scheduled";

  const [fireState, setFireState] = useState<"idle" | "firing" | "ok" | "error">("idle");
  const [fireError, setFireError] = useState<string | null>(null);

  function togglePlay(filePath: string) {
    if (!audioRef.current) {
      audioRef.current = new Audio(`/api/gestao/audio?path=${encodeURIComponent(filePath)}`);
      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current;
        if (a && a.duration) setProg((a.currentTime / a.duration) * 100);
      });
      audioRef.current.addEventListener("ended", () => { setPlaying(false); setProg(0); });
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  async function meterNoAr() {
    if (fireState === "firing") return;
    setFireState("firing");
    setFireError(null);

    try {
      if (item.kind === "noticias") {
        const res = await fetch("/api/gestao/fire", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Erro" }));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
      } else {
        const filePath = p?.tipo === "audio" ? p.corpo : item.fonte;
        const res = await fetch("/api/gestao/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Erro" }));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
      }
      setFireState("ok");
      setTimeout(() => setFireState("idle"), 3000);
    } catch (err) {
      setFireState("error");
      setFireError(err instanceof Error ? err.message : "Erro");
      setTimeout(() => setFireState("idle"), 5000);
    }
  }

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">{k.label}</span>
            {estado === "playing" ? (
              <StatusChip tone="live" dot>
                No ar
              </StatusChip>
            ) : estado === "aired" ? (
              <span className="text-xs text-[var(--gray)]">já foi ao ar</span>
            ) : null}
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

        <div className="flex-1 overflow-auto px-4 py-4">
          <h3 className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">
            {item.titulo}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--gray)]">
            {item.detalhe} · {item.fonte} · {fmtDur(item.duracao)}
          </p>

          {p?.tipo === "texto" ? (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">
                Guião {p.meta ? `· ${p.meta}` : ""}
              </div>
              <pre className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-3 font-sans text-sm leading-relaxed text-[var(--ink)]">
                {p.corpo}
              </pre>
            </div>
          ) : null}

          {p?.tipo === "audio" ? (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">
                Áudio {p.meta ? `· ${p.meta}` : ""}
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => togglePlay(p.corpo)}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] text-white transition-transform hover:scale-105"
                    aria-label={playing ? "Pausar" : "Reproduzir"}
                  >
                    {playing ? <span className="text-sm">&#10074;&#10074;</span> : <IconPlay className="h-5 w-5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-[var(--gray)]">{p.corpo}</div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
                        style={{ width: `${prog}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {!p ? (
            <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs text-[var(--gray)]">
              Sem pré-visualização (voice-track ao vivo / material sem ficheiro associado).
            </div>
          ) : null}
        </div>

        {/* rodapé — ações */}
        <div className="space-y-2 border-t border-[var(--line)] px-4 py-3">
          {/* Meter no ar */}
          {estado === "scheduled" ? (
            <button
              type="button"
              onClick={meterNoAr}
              disabled={fireState === "firing"}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-[#0b3d1a] transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {fireState === "firing" ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0b3d1a]/30 border-t-[#0b3d1a]" />
              ) : (
                <IconPlay className="h-4 w-4" />
              )}
              {fireState === "firing"
                ? "A meter no ar..."
                : fireState === "ok"
                  ? "No ar!"
                  : fireState === "error"
                    ? (fireError ?? "Erro")
                    : item.kind === "noticias"
                      ? "Disparar notícias agora"
                      : "Meter no ar"}
            </button>
          ) : null}

          {fireState === "ok" ? (
            <StatusChip tone="ok" dot>
              Enviado para o ar
            </StatusChip>
          ) : null}

          {/* Remover */}
          {removivel ? (
            <button
              type="button"
              onClick={onRemove}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              <IconTrash className="h-4 w-4" />
              Remover do alinhamento
            </button>
          ) : (
            <p className="flex items-center justify-center gap-2 text-xs text-[var(--gray)]">
              <IconAlert className="h-3.5 w-3.5" />
              {estado === "playing" ? "Está a tocar agora" : "Já foi ao ar"} — não pode ser removido.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
