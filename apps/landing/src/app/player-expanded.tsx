"use client";

import Image from "next/image";
import { useState } from "react";
import Logo from "./logo";
import { usePlayer } from "./player-context";
import type { ProgramaAtual } from "./programacao";

export default function PlayerExpanded({
  prog,
  closing = false,
  onClose,
}: {
  prog: ProgramaAtual | null;
  closing?: boolean;
  onClose: () => void;
}) {
  const { playing, loading, error, now, historico, toggle } = usePlayer();
  const [copiado, setCopiado] = useState(false);
  // (dock fixo ao fundo do overlay; scroll só na área de conteúdo)

  const titulo = error
    ? "Stream indisponível"
    : now.texto ?? (loading ? "A ligar…" : "Radio IT — em direto");
  // Cabeçalho do programa (ao lado da capa).
  const programaTitulo = prog?.programa ?? (now.aoVivo ? "Em direto" : "Piloto automático");
  const locutorLinha = prog ? `com ${prog.locutor.nome}` : "Só música, sem parar";

  // Capa: foto do programa online, ou a imagem do piloto automático (madrugada/só música).
  const capa = prog?.locutor.foto ?? "/piloto-automatico.jpg";

  async function partilhar() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Radio IT", text: titulo, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* utilizador cancelou */
    }
  }

  return (
    <div
      className={`app-gradient fixed inset-0 z-50 ${
        closing ? "animate-collapse" : "animate-expand"
      }`}
    >
      {/* Área com scroll (dock fica fora, sempre no fundo) */}
      <div className="absolute inset-0 overflow-y-auto">
      {/* Logótipo no canto superior esquerdo */}
      <div className="pointer-events-none sticky top-0 z-10 px-6 pt-6">
        <Logo className="[&_span:first-child]:text-3xl [&_span:last-child]:px-3 [&_span:last-child]:text-2xl sm:[&_span:first-child]:text-4xl sm:[&_span:last-child]:text-3xl" />
      </div>

      {/* Hero */}
      <div className="flex min-h-full flex-col items-center px-6 pb-40">
        {/* Cabeçalho: capa + título do programa ao lado */}
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 pt-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
          <div className="relative h-48 w-48 shrink-0 overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/20 sm:h-56 sm:w-56">
            {capa ? (
              <Image src={capa} alt="" fill sizes="224px" className="object-cover" unoptimized />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-white/15 text-6xl">
                🎧
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wide text-white/80 sm:justify-start">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              No ar agora
            </p>
            <h2 className="mt-2 text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {programaTitulo}
            </h2>
            <p className="mt-1 text-base text-white/80">{locutorLinha}</p>

            <p className="mt-4 truncate text-sm text-white/70">
              <span className="text-white/50">A tocar: </span>
              {titulo}
            </p>

            {/* Ações */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <button
                type="button"
                onClick={partilhar}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand shadow-lg transition-transform hover:scale-105"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                {copiado ? "Link copiado!" : "Partilhar"}
              </button>
            </div>
          </div>
        </div>

        {/* Passou na RadioIT */}
        <div className="mt-12 w-full max-w-2xl text-left">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/80">
            Passou na RadioIT
          </h3>
          {historico.length === 0 ? (
            <p className="rounded-2xl border border-white/15 bg-white/10 px-4 py-8 text-center text-sm text-white/70 backdrop-blur-sm">
              Ainda sem histórico…
            </p>
          ) : (
            <ul className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm">
              {historico.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                  {h.arte ? (
                    <Image
                      src={h.arte}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/15 text-base">
                      ♪
                    </span>
                  )}
                  <span className="truncate text-sm text-white">{h.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </div>

      {/* Dock inferior (colado ao fundo do overlay, opaco) */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/15 bg-brand shadow-2xl">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
            {capa ? (
              <Image src={capa} alt="" fill sizes="44px" className="object-cover" unoptimized />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-white/15 text-lg">🎧</span>
            )}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{titulo}</p>

          <button
            type="button"
            onClick={toggle}
            aria-pressed={playing}
            aria-label={playing ? "Pausar" : "Tocar"}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-lg transition-transform hover:scale-105"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
            ) : playing ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 flex-col items-center gap-0.5 px-2 text-white/80 transition-colors hover:text-white"
            aria-label="Fechar"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-wide">Fechar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
