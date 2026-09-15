"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePlayer } from "./player-context";
import { programaAtual, type ProgramaAtual } from "./programacao";

export default function PlayerBar() {
  const { playing, loading, error, started, now, historico, toggle } = usePlayer();
  const [prog, setProg] = useState<ProgramaAtual | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const update = () => setProg(programaAtual());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  // Só aparece depois do primeiro play.
  if (!started) return null;

  const radioText = error
    ? "Stream indisponível"
    : now.texto ?? (loading ? "A ligar…" : "Radio IT — em direto");

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="mx-auto max-w-3xl sm:mb-4">
        {/* Painel "Passou na RadioIT" */}
        {aberto && (
          <div className="animate-panel-up mx-2 mb-2 overflow-hidden rounded-2xl border border-white/20 bg-brand/90 shadow-2xl backdrop-blur-md sm:mx-0">
            <p className="border-b border-white/15 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/80">
              Passou na RadioIT
            </p>
            {historico.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/70">
                Ainda sem histórico…
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-white/10 overflow-y-auto">
                {historico.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                    {h.arte ? (
                      <Image
                        src={h.arte}
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15 text-sm">
                        ♪
                      </span>
                    )}
                    <span className="truncate text-sm text-white">{h.texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Barra do player */}
        <div className="animate-slide-up mx-2 flex items-center gap-4 border border-white/20 bg-brand/80 px-4 py-3 shadow-2xl backdrop-blur-md sm:mx-0 sm:rounded-2xl">
          {/* Locutor / programa */}
          {prog ? (
            <Image
              src={prog.locutor.foto}
              alt={prog.locutor.nome}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white/60"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg">
              🎧
            </span>
          )}

          {/* Radio text (now playing) */}
          <div className="min-w-0 flex-1 text-left">
            <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              {now.aoVivo ? "Em direto" : prog ? prog.programa : "Radio IT"}
            </p>
            <p className="truncate text-sm font-medium text-white">{radioText}</p>
          </div>

          {/* Abrir "Passou na RadioIT" */}
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label="Passou na RadioIT"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-300 ${aberto ? "rotate-180" : ""}`}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>

          {/* Play / pause */}
          <button
            type="button"
            onClick={toggle}
            aria-pressed={playing}
            aria-label={playing ? "Pausar" : "Tocar"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-lg transition-transform hover:scale-105"
          >
            {loading ? (
              <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
            ) : playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
