"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  streamUrl: string;
};

export default function LivePlayer({ streamUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wantPlayRef = useRef(false);
  const startedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const audio = new Audio(streamUrl);
    audio.preload = "none";
    audio.addEventListener("playing", () => {
      setLoading(false);
      setPlaying(true);
      setError(false);
    });
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("waiting", () => {
      if (wantPlayRef.current) setLoading(true);
    });
    audio.addEventListener("error", () => {
      // Só sinaliza erro se o utilizador tiver pedido para tocar.
      if (!wantPlayRef.current) return;
      setError(true);
      setLoading(false);
      setPlaying(false);
    });
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [streamUrl]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      wantPlayRef.current = false;
      audio.pause();
      return;
    }
    try {
      wantPlayRef.current = true;
      setLoading(true);
      setError(false);
      // Só (re)liga ao ponto vivo na primeira vez ou depois de um erro.
      // Num resume normal continua do buffer, para não saltar de faixa.
      if (!startedRef.current || error) {
        audio.load();
      }
      startedRef.current = true;
      await audio.play();
    } catch {
      setError(true);
      setLoading(false);
    }
  }

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
