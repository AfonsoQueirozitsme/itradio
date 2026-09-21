"use client";

// Editor do soundboard (aba Settings). Grelha 4×4 na ordem das teclas HOTKEYS;
// clicar num slot abre um drawer para editar/limpar o cartão. Edição em estado
// local (SIMULADA) — ao ligar, grava a config de carts com backup no
// apps/station. Segredos (.env) NUNCA são geridos aqui.

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Card, StatusChip } from "./ui";
import { IconClose, IconTrash, IconGrid, IconGrip, IconAlert, IconCheck, IconPlay, IconFolder, IconUpload } from "./icons";
import { HOTKEYS, type SettingsData, type SoundPad, type PadKind } from "../../_lib/settings";
import { loadPads, savePads, swapPads } from "./soundboard-store";
import FilePicker from "./file-picker";

const KIND_LABEL: Record<PadKind, string> = {
  jingle: "Jingle",
  noticias: "Notícias",
  anuncio: "Publicidade",
  segmento: "Segmento",
  efeito: "Efeito",
  musica: "Música / bed",
};
const KIND_DOT: Record<PadKind, string> = {
  jingle: "bg-violet-400",
  noticias: "bg-emerald-400",
  anuncio: "bg-amber-400",
  segmento: "bg-sky-400",
  efeito: "bg-rose-400",
  musica: "bg-brand",
};
const KINDS = Object.keys(KIND_LABEL) as PadKind[];

const KIND_DIR: Record<PadKind, string> = {
  jingle: "audio/jingles",
  noticias: "audio/segmentos",
  anuncio: "audio/beds",
  segmento: "audio/segmentos",
  efeito: "audio/jingles",
  musica: "audio/musica",
};

type Draft = { label: string; kind: PadKind; ficheiro: string; dur: string };

type MediaEntry = { name: string; path: string; size?: number; ext?: string };

export default function SettingsPanel({ data }: { data: SettingsData }) {
  const [pads, setPads] = useState<(SoundPad | null)[]>(data.pads);
  const [editing, setEditing] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Estado inicial vem do seam (SSR-safe); no browser aplica-se o arranjo
  // guardado (localStorage) para não haver mismatch de hidratação.
  useEffect(() => {
    setPads(loadPads(data.pads));
  }, [data.pads]);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }
  // grava o arranjo (localStorage → reflete-se no soundboard da Live) e sinaliza
  function commit(next: (SoundPad | null)[]) {
    setPads(next);
    savePads(next);
    flashSaved();
  }

  function onSave(i: number, draft: Draft) {
    const existing = pads[i];
    const next = pads.slice();
    next[i] = {
      id: existing?.id ?? `p-${HOTKEYS[i]}`,
      hotkey: HOTKEYS[i],
      label: draft.label.trim() || "Sem nome",
      kind: draft.kind,
      ficheiro: draft.ficheiro.trim(),
      dur: draft.dur.trim() || "0:00",
    };
    commit(next);
    setEditing(null);
  }
  function onClear(i: number) {
    const next = pads.slice();
    next[i] = null;
    commit(next);
    setEditing(null);
  }
  // arrastar um cartão para outro slot → troca conteúdos e re-normaliza hotkeys.
  // A origem viaja no dataTransfer (robusto — não depende do estado do React
  // entre o dragstart e o drop); dragFrom serve só o feedback visual.
  function handleDrop(e: DragEvent, target: number) {
    const raw = e.dataTransfer.getData("text/plain");
    const from = raw === "" ? dragFrom : Number(raw);
    if (from !== null && !Number.isNaN(from) && from !== target) commit(swapPads(pads, from, target));
    setDragFrom(null);
    setDragOver(null);
  }

  const usados = pads.filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--gray)]">
          {usados}/16 cartões · arrasta um cartão para outro slot para o mover · reflete o soundboard da Live.
        </p>
        {saved ? (
          <StatusChip tone="ok" dot>
            Guardado
          </StatusChip>
        ) : null}
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {pads.map((pad, i) => {
            const isDropTarget = dragOver === i && dragFrom !== null && dragFrom !== i;
            if (!pad) {
              return (
                <button
                  key={`empty-${i}`}
                  type="button"
                  onClick={() => setEditing(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(e, i);
                  }}
                  className={[
                    "flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed transition-colors",
                    isDropTarget
                      ? "border-[var(--ink)]/40 bg-[var(--bg)] text-[var(--ink)]"
                      : "border-[var(--line)] text-[var(--gray)] hover:border-[var(--ink)]/30 hover:text-[var(--ink)]",
                  ].join(" ")}
                >
                  <span className="text-lg leading-none">+</span>
                  <span className="text-[10px]">tecla {HOTKEYS[i]}</span>
                </button>
              );
            }
            return (
              <button
                key={pad.id}
                type="button"
                draggable
                onClick={() => setEditing(i)}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(e, i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                title={`${pad.label} · tecla ${pad.hotkey} · arrasta para mover`}
                className={[
                  "group relative flex h-24 cursor-grab flex-col justify-between rounded-xl border bg-[var(--bg)] p-2.5 text-left transition-colors active:cursor-grabbing",
                  dragFrom === i ? "opacity-40" : "",
                  isDropTarget
                    ? "border-[var(--ink)]/50 ring-1 ring-[var(--ink)]/30"
                    : "border-[var(--line)] hover:border-[var(--ink)]/25",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span className={`h-2 w-2 rounded-full ${KIND_DOT[pad.kind]}`} />
                  <span className="flex items-center gap-1">
                    <IconGrip className="h-3.5 w-3.5 text-[var(--gray)]/40 opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="rounded-md border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--gray)]">
                      {pad.hotkey}
                    </span>
                  </span>
                </div>
                <div>
                  <div className="line-clamp-2 text-xs font-semibold leading-tight text-[var(--ink)]">
                    {pad.label}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--gray)]">
                    <span>{KIND_LABEL[pad.kind]}</span>
                    <span>·</span>
                    <span className="tabular-nums">{pad.dur}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Demonstração: o arranjo fica guardado neste browser e reflete-se no soundboard da Live. Ao ligar, grava
        a config de carts (com backup) no apps/station; os ficheiros apontam para /home/itradio/itfm-data.
        Segredos (.env) nunca são geridos aqui.
      </p>

      {editing !== null ? (
        <PadEditor
          index={editing}
          pad={pads[editing]}
          onClose={() => setEditing(null)}
          onSave={(draft) => onSave(editing, draft)}
          onClear={() => onClear(editing)}
        />
      ) : null}
    </div>
  );
}

function PadEditor({
  index,
  pad,
  onClose,
  onSave,
  onClear,
}: {
  index: number;
  pad: SoundPad | null;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  onClear: () => void;
}) {
  const [label, setLabel] = useState(pad?.label ?? "");
  const [kind, setKind] = useState<PadKind>(pad?.kind ?? "jingle");
  const [ficheiro, setFicheiro] = useState(pad?.ficheiro ?? "");
  const [dur, setDur] = useState(pad?.dur ?? "0:00");
  const [showFilePicker, setShowFilePicker] = useState(false);

  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const fetchMedia = useCallback(async (dir: string) => {
    setMediaLoading(true);
    try {
      const res = await fetch(`/api/gestao/files?dir=${encodeURIComponent(dir)}`);
      if (!res.ok) { setMedia([]); return; }
      const data = await res.json();
      const audioExts = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"]);
      const items: MediaEntry[] = (data.entries ?? [])
        .filter((e: { type: string; ext?: string }) => e.type === "file" && e.ext && audioExts.has(e.ext))
        .map((e: { name: string; size?: number; ext?: string }) => ({
          name: e.name,
          path: dir ? `${dir}/${e.name}` : e.name,
          size: e.size,
          ext: e.ext,
        }));
      setMedia(items);
    } catch {
      setMedia([]);
    } finally {
      setMediaLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMedia(KIND_DIR[kind]);
  }, [kind, fetchMedia]);

  function togglePreview(filePath: string) {
    if (previewPath === filePath) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewPath(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(`/api/gestao/audio?path=${encodeURIComponent(filePath)}`);
    a.addEventListener("ended", () => setPreviewPath(null));
    audioRef.current = a;
    a.play();
    setPreviewPath(filePath);
  }

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <IconGrid className="h-4 w-4 text-[var(--gray)]" />
            <span className="text-sm font-semibold text-[var(--ink)]">
              {pad ? "Editar cartão" : "Novo cartão"}
            </span>
            <span className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--gray)]">
              tecla {HOTKEYS[index]}
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

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
          <Field label="Nome">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex.: ID Pause & Play"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]/30"
            />
          </Field>

          <Field label="Tipo">
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    kind === k
                      ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                      : "border-[var(--line)] text-[var(--gray)] hover:border-[var(--ink)]/25"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`} />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </Field>

          {/* Ficheiro selecionado */}
          <Field label="Ficheiro">
            {ficheiro ? (
              <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 p-2.5">
                <button
                  type="button"
                  onClick={() => togglePreview(ficheiro)}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 ${
                    previewPath === ficheiro
                      ? "bg-brand text-[#0b3d1a]"
                      : "bg-[var(--ink)] text-white"
                  }`}
                  aria-label={previewPath === ficheiro ? "Parar" : "Ouvir"}
                >
                  {previewPath === ficheiro ? (
                    <span className="text-xs font-bold">II</span>
                  ) : (
                    <IconPlay className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-[var(--ink)]">
                    {ficheiro.split("/").pop()}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--gray)]">{ficheiro}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setFicheiro("")}
                  className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--gray)] transition-colors hover:text-[var(--ink)]"
                >
                  Trocar
                </button>
              </div>
            ) : null}

            {/* Media da estação filtrada por tipo */}
            {!ficheiro ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                    Media carregada · {KIND_LABEL[kind]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFilePicker(true)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[var(--gray)] transition-colors hover:text-[var(--ink)]"
                  >
                    <IconFolder className="h-3 w-3" />
                    Explorar tudo
                  </button>
                </div>

                {mediaLoading ? (
                  <div className="flex items-center justify-center py-6 text-xs text-[var(--gray)]">
                    A carregar...
                  </div>
                ) : media.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--gray)]">
                    Sem ficheiros em {KIND_DIR[kind]}
                  </div>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)]/40 p-1.5">
                    {media.map((m) => (
                      <div
                        key={m.path}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setFicheiro(m.path);
                          if (!label) setLabel(m.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setFicheiro(m.path);
                            if (!label) setLabel(m.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
                          }
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--card)]"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePreview(m.path);
                          }}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                            previewPath === m.path
                              ? "bg-brand text-[#0b3d1a]"
                              : "bg-[var(--card)] text-[var(--gray)] hover:text-[var(--ink)]"
                          }`}
                        >
                          {previewPath === m.path ? (
                            <span className="text-[9px] font-bold">II</span>
                          ) : (
                            <IconPlay className="h-3 w-3" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--ink)]">{m.name}</div>
                          {m.size != null ? (
                            <div className="text-[10px] text-[var(--gray)]">{formatSize(m.size)}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Carregar nova media */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFilePicker(true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--line)] py-2.5 text-xs font-semibold text-[var(--gray)] transition-colors hover:border-[var(--ink)]/30 hover:text-[var(--ink)]"
                  >
                    <IconFolder className="h-3.5 w-3.5" />
                    Procurar na estação
                  </button>
                  <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--line)] py-2.5 text-xs font-semibold text-[var(--gray)] transition-colors hover:border-[var(--ink)]/30 hover:text-[var(--ink)]">
                    <IconUpload className="h-3.5 w-3.5" />
                    Carregar nova
                    <input
                      type="file"
                      accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const form = new FormData();
                        form.append("file", file);
                        const dir = KIND_DIR[kind];
                        try {
                          const res = await fetch(`/api/gestao/files?dir=${encodeURIComponent(dir)}`, {
                            method: "POST",
                            body: form,
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setFicheiro(data.path);
                            if (!label) setLabel(file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
                            fetchMedia(dir);
                          }
                        } catch { /* silently fail */ }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </Field>

          {showFilePicker ? (
            <FilePicker
              onSelect={(path) => {
                setFicheiro(path);
                if (!label) setLabel(path.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ") ?? "");
                setShowFilePicker(false);
              }}
              onClose={() => setShowFilePicker(false)}
            />
          ) : null}

          <Field label="Duração" hint='"0:08" ou "loop"'>
            <input
              value={dur}
              onChange={(e) => setDur(e.target.value)}
              placeholder="0:08"
              className="w-32 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--ink)]/30"
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3">
          {pad ? (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              <IconTrash className="h-4 w-4" />
              Limpar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onSave({ label, kind, ficheiro, dur })}
            className="ml-auto flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-[#0b3d1a] transition-transform hover:scale-105"
          >
            <IconCheck className="h-4 w-4" />
            Guardar cartão
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">{label}</span>
        {hint ? <span className="text-[10px] text-[var(--gray)]/70">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}
