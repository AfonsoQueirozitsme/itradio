"use client";

// Consola LIVE. Mostra o ALINHAMENTO ao ar (material pronto com hora prevista):
// locutores, jingles, blocos de publicidade, músicas, segmentos, notícias — não
// jobs. As horas são calculadas a partir da ordem + durações, por isso arrastar
// um item recalcula tudo. O que está a tocar aparece a verde com barra de
// progresso. Itens ainda por ir ao ar podem ser reordenados e removidos.
//
// A "vida" (o "agora" a avançar, progresso) é simulada no cliente a partir de um
// valor determinístico do seam (sem mismatch de hidratação) até ligarmos ao
// nowplaying + fila do backend.

import { useEffect, useRef, useState } from "react";
import { Card, StatusChip } from "./ui";
import Soundboard from "./soundboard";
import { IconPlay, IconClose, IconGrip, IconTrash, IconAlert } from "./icons";
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

export default function LiveConsole({ data, pads }: { data: LiveData; pads: (SoundPad | null)[] }) {
  const [histCount, setHistCount] = useState(data.historialVisivel);
  const fullHist = data.historial;
  const hasMoreHist = histCount < fullHist.length;

  // Build visible items: N most recent history + current + future
  const visibleHist = histCount > 0 ? fullHist.slice(-histCount) : [];
  const futureItems = data.itens.slice(data.historialVisivel);
  const [futureOverride, setFutureOverride] = useState<LiveItem[] | null>(null);
  const currentFuture = futureOverride ?? futureItems;
  const allVisible = [...visibleHist, ...currentFuture];

  // Recompute blocoInicio/decorridoInicial based on visible history
  const visibleHistDur = visibleHist.reduce((acc, it) => acc + it.duracao, 0);
  const baseFutureDur = futureItems.length > 0
    ? Math.max(0, data.decorridoInicial - data.itens.slice(0, data.historialVisivel).reduce((a, it) => a + it.duracao, 0))
    : 0;
  const computedDecorrido = visibleHistDur + baseFutureDur;

  const [nowSec, setNowSec] = useState<number>(computedDecorrido);
  const [selected, setSelected] = useState<LiveItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

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

  // reordenação (arrastar) — só entre itens agendados (futuros)
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

  return (
    <>
      {/* A barra "Em direto" vive agora no shell (app-shell.tsx), colada à
          navbar e presente em todas as páginas do painel. */}

      {/* Soundboard flutuante (canto inferior esquerdo) */}
      <Soundboard pads={pads} />

      <div className="space-y-4">
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
          <div className="text-right text-xs text-[var(--gray)]">
            <div className="font-medium text-[var(--ink)]">{data.now.programa}</div>
            <div>
              {restantes} a seguir · {visibleHist.length} anteriores{hasMoreHist ? ` (de ${fullHist.length})` : ""}
            </div>
          </div>
        </div>

        <Card className="p-2 sm:p-3">
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
          <ul className="space-y-1.5" onDragOver={(e) => e.preventDefault()}>
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
                    {/* barra de progresso do item a tocar */}
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
          </ul>
        </Card>

        <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Historial + fila reais do AzuraCast. Reordenar/remover ainda não escreve na fila (só leitura).
        </p>
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

// ── Drawer de pré-visualização + remover ────────────────────────────────────
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
                    {playing ? <span className="text-sm">❚❚</span> : <IconPlay className="h-5 w-5" />}
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

        {/* remover do alinhamento — só material que ainda não foi ao ar */}
        <div className="border-t border-[var(--line)] px-4 py-3">
          {removivel ? (
            <button
              type="button"
              onClick={onRemove}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              <IconTrash className="h-4 w-4" />
              Remover do alinhamento (não vai tocar)
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
