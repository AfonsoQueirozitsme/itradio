"use client";

// Soundboard flutuante (canto inferior esquerdo), 4×4, minimizável, com hot
// keys globais. Carregar num cartão "passa" o conteúdo LIVE — aqui é SIMULADO
// (pad fica verde + barra de progresso + indicador NO AR). Ao ligar, cada pad
// dispara o ficheiro no backend (ex.: request/push para o Liquidsoap com
// prioridade sobre a fila). A configuração vem do seam getSettingsData().

import { useCallback, useEffect, useRef, useState } from "react";
import { IconGrid, IconChevronDown, IconClose } from "./icons";
import type { SoundPad, PadKind } from "../../_lib/settings";
import { loadPads, SOUNDBOARD_STORE_KEY } from "./soundboard-store";

const KIND_DOT: Record<PadKind, string> = {
  jingle: "bg-violet-400",
  noticias: "bg-emerald-400",
  anuncio: "bg-amber-400",
  segmento: "bg-sky-400",
  efeito: "bg-rose-400",
  musica: "bg-brand",
};

function durSecs(dur: string): number | null {
  if (dur === "loop") return null;
  const [m, s] = dur.split(":").map((x) => parseInt(x, 10));
  return (m || 0) * 60 + (s || 0);
}

export default function Soundboard({ pads: initialPads }: { pads: (SoundPad | null)[] }) {
  // Arranjo inicial vem do seam (SSR-safe); no browser aplica-se o arranjo que
  // o utilizador definiu em Settings (localStorage) e ouve-se alterações vindas
  // de outra aba/janela.
  const [pads, setPads] = useState<(SoundPad | null)[]>(initialPads);
  const [open, setOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prog, setProg] = useState(0);
  const [loop, setLoop] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPads(loadPads(initialPads));
    function onStorage(e: StorageEvent) {
      if (e.key === SOUNDBOARD_STORE_KEY) setPads(loadPads(initialPads));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [initialPads]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setActiveId(null);
    setProg(0);
    setLoop(false);
  }, []);

  const fire = useCallback(
    (padId: string) => {
      const pad = pads.find((p) => p && p.id === padId);
      if (!pad) return;
      // segunda pressão do mesmo pad → parar
      if (activeId === pad.id) {
        stop();
        return;
      }
      if (timer.current) clearInterval(timer.current);
      const total = durSecs(pad.dur);
      setActiveId(pad.id);
      setProg(0);
      setLoop(total === null);
      if (total === null) return; // loop: fica ativo até nova pressão
      // avança a barra em ~10 passos/seg
      const stepMs = 100;
      const inc = 100 / ((total * 1000) / stepMs);
      timer.current = setInterval(() => {
        setProg((v) => {
          const next = v + inc;
          if (next >= 100) {
            if (timer.current) clearInterval(timer.current);
            timer.current = null;
            setActiveId(null);
            return 0;
          }
          return next;
        });
      }, stepMs);
    },
    [pads, activeId, stop],
  );

  // limpeza do intervalo ao desmontar
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // hot keys globais — ignora quando se escreve em campos / com modificadores
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = e.key.toUpperCase();
      const pad = pads.find((p) => p && p.hotkey.toUpperCase() === key);
      if (!pad) return;
      e.preventDefault();
      if (!open) setOpen(true);
      fire(pad.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pads, fire, open]);

  const active = pads.find((p) => p && p.id === activeId) ?? null;

  // ── minimizado: botão flutuante ───────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 z-40 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3.5 py-2.5 text-sm font-semibold text-[var(--ink)] shadow-lg transition-transform hover:scale-105 md:bottom-4 md:left-[92px]"
      >
        <IconGrid className="h-4 w-4" />
        Cartões
        {active ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
        ) : null}
      </button>
    );
  }

  // ── aberto: painel 4×4 ────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-24 left-4 z-40 w-[280px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-2xl md:bottom-4 md:left-[92px]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <IconGrid className="h-4 w-4 text-[var(--gray)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Cartões</span>
          <span className="text-[10px] text-[var(--gray)]">hot keys</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimizar"
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
        >
          <IconChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* faixa NO AR */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold transition-colors ${
          active ? "bg-brand text-[#0b3d1a]" : "bg-[var(--bg)] text-[var(--gray)]"
        }`}
      >
        {active ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0b3d1a] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0b3d1a]" />
            </span>
            <span className="truncate">No ar: {active.label}</span>
            {loop ? <span className="ml-auto opacity-70">loop</span> : null}
            <button
              type="button"
              onClick={stop}
              aria-label="Parar"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#0b3d1a]/15 hover:bg-[#0b3d1a]/25"
            >
              <IconClose className="h-3 w-3" />
            </button>
          </>
        ) : (
          <span>Pronto — carrega num cartão ou usa a tecla</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5 p-2">
        {pads.map((pad, i) => {
          if (!pad) {
            return (
              <div
                key={`empty-${i}`}
                className="flex h-[52px] items-center justify-center rounded-lg border border-dashed border-[var(--line)] text-[10px] text-[var(--gray)]/50"
              >
                +
              </div>
            );
          }
          const on = activeId === pad.id;
          return (
            <button
              key={pad.id}
              type="button"
              onClick={() => fire(pad.id)}
              title={`${pad.label} · ${pad.hotkey}`}
              className={`relative flex h-[52px] flex-col justify-between overflow-hidden rounded-lg border p-1.5 text-left transition-transform active:scale-95 ${
                on
                  ? "border-brand bg-brand text-[#0b3d1a]"
                  : "border-[var(--line)] bg-[var(--bg)] hover:border-[var(--ink)]/25"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-[#0b3d1a]" : KIND_DOT[pad.kind]}`} />
                <span
                  className={`rounded px-1 text-[9px] font-bold ${
                    on ? "bg-[#0b3d1a]/15" : "bg-[var(--card)] text-[var(--gray)]"
                  }`}
                >
                  {pad.hotkey}
                </span>
              </div>
              <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{pad.label}</span>
              {on ? (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-[#0b3d1a]/15">
                  <span
                    className="block h-full bg-[#0b3d1a] transition-[width] duration-100 ease-linear"
                    style={{ width: loop ? "100%" : `${prog}%` }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--gray)]">
        Demonstração — ao ligar, dispara o ficheiro no ar.
      </p>
    </div>
  );
}
