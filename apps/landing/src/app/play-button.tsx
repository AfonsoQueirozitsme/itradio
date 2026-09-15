"use client";

import { usePlayer } from "./player-context";

function Equalizer() {
  const bars = [0, 0.15, 0.3, 0.1, 0.25, 0.05, 0.2];
  return (
    <span className="flex h-[18px] items-end gap-1" aria-hidden>
      {bars.map((delay, i) => (
        <span
          key={i}
          className="eq-bar w-1 rounded-full bg-brand"
          style={{ height: "100%", animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

export default function PlayButton() {
  const { playing, loading, error, toggle } = usePlayer();

  const label = error
    ? "Stream indisponível"
    : loading
      ? "A ligar…"
      : playing
        ? "Agora a tocar"
        : "Ouvir ao vivo";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      aria-label={playing ? "Pausar" : "Ouvir ao vivo"}
      className="group inline-flex min-w-[220px] items-center justify-center gap-3 rounded-full bg-white px-8 py-4 font-semibold text-brand shadow-lg transition-transform hover:scale-105 disabled:opacity-70"
    >
      {loading ? (
        <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
      ) : playing ? (
        <>
          {/* A tocar: faixas por defeito, ⏸ ao passar o rato. */}
          <span className="group-hover:hidden">
            <Equalizer />
          </span>
          <svg
            className="hidden group-hover:block"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        </>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {playing && !loading ? (
        <>
          <span className="group-hover:hidden">{label}</span>
          <span className="hidden group-hover:inline">Pausar</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
