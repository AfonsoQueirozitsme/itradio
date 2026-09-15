"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePlayer } from "./player-context";
import PlayerExpanded from "./player-expanded";
import { programaAtual, type ProgramaAtual } from "./programacao";

export default function PlayerBar() {
  const { playing, loading, error, started, now, toggle } = usePlayer();
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

  // Expandido: tela cheia (o dock traz o próprio botão Fechar).
  if (aberto) return <PlayerExpanded prog={prog} onClose={() => setAberto(false)} />;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3">
      <div className="mx-auto max-w-3xl">
        {/* Barra do player (flutuante) */}
        <div className="animate-slide-up flex items-center gap-4 rounded-2xl border border-white/20 bg-brand/80 px-4 py-3 shadow-2xl backdrop-blur-md">
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

          {/* Expandir (tela cheia + "Passou na RadioIT") */}
          <button
            type="button"
            onClick={() => setAberto(true)}
            aria-label="Expandir player"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
