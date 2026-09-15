"use client";

import { usePlayer } from "./player-context";

export default function PlayButton() {
  const { playing, loading, error, toggle } = usePlayer();

  const label = error
    ? "Stream indisponível"
    : loading
      ? "A ligar…"
      : playing
        ? "Em pausa"
        : "Ouvir ao vivo";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      className="inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 font-semibold text-brand shadow-lg transition-transform hover:scale-105 disabled:opacity-70"
    >
      {loading ? (
        <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
      ) : playing ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {label}
    </button>
  );
}
