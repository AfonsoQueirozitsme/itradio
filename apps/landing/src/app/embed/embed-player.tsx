"use client";

import { usePlayer } from "../player-context";
import { SITE_URL, SITE_NAME } from "../site";

// Player compacto para <iframe>. Altura recomendada ~152px (ver /api/oembed).
export default function EmbedPlayer() {
  const { playing, loading, now, toggle, statusText, started } = usePlayer();

  const linha = now.texto ?? (loading ? "A ligar…" : "Música sem parar, ao vivo");

  return (
    <div className="app-gradient flex h-dvh min-h-[132px] w-full flex-col justify-center gap-3 px-4 py-3 text-white">
      {/* Estado para leitores de ecrã. */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>

      <div className="flex items-center gap-3">
        {/* Wordmark compacto (link para o site cheio). */}
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir ${SITE_NAME} em nova janela`}
          className="flex shrink-0 items-center gap-1.5 font-[family-name:var(--font-logo)] text-lg font-semibold leading-none text-white"
        >
          <span>Radio</span>
          <span className="flex aspect-square items-center justify-center rounded-full bg-white px-2 py-1 text-base leading-none text-brand">
            IT
          </span>
        </a>

        {/* Now playing */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/85">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            Em direto
          </p>
          <p className="truncate text-sm font-medium text-white">{linha}</p>
        </div>

        {/* Play / pause */}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          aria-label={playing ? "Pausar" : "Ouvir ao vivo"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-lg transition-transform hover:scale-105"
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
          ) : playing ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Rodapé: link para o site cheio. */}
      <a
        href={SITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-[11px] text-white/75 underline-offset-2 hover:text-white hover:underline"
      >
        {started ? "Ouvir em itfm.live →" : "Powered by itfm.live →"}
      </a>
    </div>
  );
}
