"use client";

// Editor do soundboard (aba Settings). Grelha 4×4 na ordem das teclas HOTKEYS;
// clicar num slot abre um drawer para editar/limpar o cartão. Edição em estado
// local (SIMULADA) — ao ligar, grava a config de carts com backup no
// apps/station. Segredos (.env) NUNCA são geridos aqui.

import { useEffect, useState, type DragEvent } from "react";
import { Card, StatusChip } from "./ui";
import { IconClose, IconTrash, IconGrid, IconGrip, IconAlert, IconCheck } from "./icons";
import { HOTKEYS, type SettingsData, type SoundPad, type PadKind } from "../../_lib/settings";
import { loadPads, savePads, swapPads } from "./soundboard-store";

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

type Draft = { label: string; kind: PadKind; ficheiro: string; dur: string };

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

          <Field label="Ficheiro" hint="relativo a /home/itradio/itfm-data">
            <input
              value={ficheiro}
              onChange={(e) => setFicheiro(e.target.value)}
              placeholder="ex.: carts/id_pause_play.mp3"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-mono text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]/30"
            />
          </Field>

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
