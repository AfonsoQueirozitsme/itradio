"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type NowPlaying = {
  /** Texto do rádio: "Artista - Título" (ou nome do streamer se ao vivo). */
  texto: string | null;
  /** URL da capa, se existir. */
  arte: string | null;
  /** true se houver um streamer ligado ao vivo (DJ). */
  aoVivo: boolean;
};

/** Uma faixa que já passou. */
export type Historico = {
  id: string;
  texto: string;
  arte: string | null;
};

type PlayerState = {
  playing: boolean;
  loading: boolean;
  error: boolean;
  started: boolean;
  now: NowPlaying;
  historico: Historico[];
  toggle: () => void;
};

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer tem de estar dentro de <PlayerProvider>");
  return ctx;
}

/**
 * Nome limpo de uma faixa: "Artista - Título" a partir dos campos separados
 * (ignora o álbum "IT.FM" que polui o `text` do broadcast e o traço à esquerda
 * das faixas sem artista). Cai para o título ou para o `text` limpo.
 */
function songLabel(song: Record<string, unknown> | null | undefined): string | null {
  const artist = String(song?.artist ?? "").trim();
  const title = String(song?.title ?? "").trim();
  if (artist && title) return `${artist} - ${title}`;
  if (title) return title;
  const text = String(song?.text ?? "")
    .replace(/\s*-\s*IT\.FM\s*-\s*/i, " - ") // remove o álbum infiltrado
    .replace(/^\s*-\s*/, "") // faixa sem artista → tira o traço inicial
    .trim();
  return text || null;
}

/** Deriva a URL do now-playing do AzuraCast a partir da URL do stream. */
function nowPlayingUrlFrom(streamUrl: string): string | null {
  try {
    const u = new URL(streamUrl);
    // /listen/<shortcode>/<mount> → shortcode
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("listen");
    const shortcode = idx >= 0 ? parts[idx + 1] : parts[0];
    if (!shortcode) return null;
    return `${u.origin}/api/nowplaying/${shortcode}`;
  } catch {
    return null;
  }
}

export function PlayerProvider({
  streamUrl,
  children,
}: {
  streamUrl: string;
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wantPlayRef = useRef(false);
  const startedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const [now, setNow] = useState<NowPlaying>({ texto: null, arte: null, aoVivo: false });
  const [historico, setHistorico] = useState<Historico[]>([]);

  // Elemento de áudio (single source of truth).
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

  // Polling do now-playing: começa quando o utilizador dá play.
  const npUrl = useMemo(() => nowPlayingUrlFrom(streamUrl), [streamUrl]);
  useEffect(() => {
    if (!started || !npUrl) return;
    let cancel = false;
    async function poll() {
      try {
        const res = await fetch(npUrl!, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancel) return;
        const song = data?.now_playing?.song ?? {};
        const aoVivo = Boolean(data?.live?.is_live);
        const streamer = data?.live?.streamer_name?.trim();
        const texto = (aoVivo && streamer ? streamer : songLabel(song)) || null;
        setNow({ texto, arte: (song.art as string) || null, aoVivo });

        const hist = Array.isArray(data?.song_history) ? data.song_history : [];
        const lista = hist
          .map((h: Record<string, unknown>) => {
            const s = (h?.song ?? {}) as Record<string, unknown>;
            const t = songLabel(s);
            return t
              ? {
                  id: String(h?.sh_id ?? h?.played_at ?? t),
                  texto: t,
                  arte: (s.art as string) || null,
                }
              : null;
          })
          .filter((x): x is Historico => x !== null)
          // colapsa duplicados seguidos (mesma faixa repetida) para não aparecer 2x
          .filter((h, i, arr) => i === 0 || h.texto !== arr[i - 1].texto)
          .slice(0, 10);
        setHistorico(lista);
      } catch {
        /* ignora falhas de rede pontuais */
      }
    }
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [started, npUrl]);

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
      // Só (re)liga ao ponto vivo na 1ª vez ou depois de erro (senão salta de faixa).
      if (!startedRef.current || error) audio.load();
      startedRef.current = true;
      setStarted(true);
      await audio.play();
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  const value: PlayerState = {
    playing,
    loading,
    error,
    started,
    now,
    historico,
    toggle,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
