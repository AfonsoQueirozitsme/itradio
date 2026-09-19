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
  /** Volume 0..1 (persistido em localStorage). */
  volume: number;
  /** true se em silêncio (persistido em localStorage). */
  muted: boolean;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  /** Frase de estado para leitores de ecrã (região aria-live). */
  statusText: string;
};

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer tem de estar dentro de <PlayerProvider>");
  return ctx;
}

const VOL_KEY = "itfm:volume";
const MUTED_KEY = "itfm:muted";
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);

// Sem áudio real durante este tempo, com o elemento "a tocar" = ligação morta
// (socket half-open depois de um restart do backend / blip de rede / wake-from-
// sleep, que NÃO dispara 'error' nem 'ended') → religa.
const STALL_MS = 10000;
// Ritmo do watchdog de progresso.
const WATCHDOG_MS = 3000;
// Só repõe o backoff ao fim deste tempo de reprodução ESTÁVEL — senão um link a
// "piscar" (liga 1s, cai, repete) martelava o stream no piso dos 2s.
const STABLE_MS = 30000;
// iOS/Safari rejeita um play() sem gesto do utilizador com este erro.
const isAutoplayBlocked = (e: unknown) =>
  e instanceof DOMException && e.name === "NotAllowedError";

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

/** Parte "Artista - Título" para a Media Session (título/artista separados). */
function splitLabel(texto: string | null): { artist: string; title: string } {
  if (!texto) return { artist: "", title: "" };
  const i = texto.indexOf(" - ");
  if (i > 0) return { artist: texto.slice(0, i).trim(), title: texto.slice(i + 3).trim() };
  return { artist: "", title: texto.trim() };
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
  // Religação automática: timer da próxima tentativa + contador para o backoff.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  // Watchdog de progresso: instante (ms) em que chegou áudio real pela última vez.
  const lastProgressRef = useRef(0);
  // Timer que repõe o backoff só depois de reprodução estável.
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true quando o play() foi bloqueado por falta de gesto (iOS): pára a religação
  // automática até o utilizador tocar outra vez.
  const needsGestureRef = useRef(false);
  // Preenchido dentro do efeito do áudio (fecha sobre o <audio> atual) para o
  // `toggle` também poder disparar uma religação.
  const scheduleReconnectRef = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const [now, setNow] = useState<NowPlaying>({ texto: null, arte: null, aoVivo: false });
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  // Espelhos para os handlers registados uma só vez (Media Session, teclado).
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  const playingRef = useRef(false);
  const toggleRef = useRef<() => void>(() => {});
  playingRef.current = playing;

  // Elemento de áudio (single source of truth).
  useEffect(() => {
    const audio = new Audio(streamUrl);
    audio.preload = "none";
    audio.volume = volumeRef.current;
    audio.muted = mutedRef.current;

    const clearRetry = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    const cancelStable = () => {
      if (stableTimerRef.current) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
    };
    // Marca que chegou áudio real agora (alimenta o watchdog de progresso).
    const markProgress = () => {
      lastProgressRef.current = Date.now();
    };

    // iOS/Safari bloqueou o play() automático (sem gesto): pára a religação e
    // deixa o botão em estado "tocar" — o próximo toque do utilizador é que religa.
    const enterNeedsGesture = () => {
      needsGestureRef.current = true;
      clearRetry();
      cancelStable();
      retryAttemptRef.current = 0;
      setLoading(false);
      setPlaying(false);
    };

    // Repõe o backoff só depois de reprodução ESTÁVEL (evita que um link a
    // "piscar" — liga 1s, cai, repete — martele o stream no piso dos 2s).
    const armStable = () => {
      cancelStable();
      stableTimerRef.current = setTimeout(() => {
        retryAttemptRef.current = 0;
      }, STABLE_MS);
    };

    // Religa ao ponto vivo com backoff exponencial (2s→30s) enquanto o
    // utilizador quiser ouvir. Um restart do backend (ou um blip de rede) deixa
    // de deixar o player morto: recupera sozinho quando o stream voltar.
    const scheduleReconnect = () => {
      if (!wantPlayRef.current || needsGestureRef.current || retryTimerRef.current) return;
      const attempt = retryAttemptRef.current;
      // Teto exponencial (2s,4s,8s,16s,30s…) com "equal jitter" (à AWS): metade
      // fixa + metade aleatória. O jitter descorrelaciona as religações — quando
      // o backend reinicia e derruba todos os ouvintes ao mesmo instante, evita
      // que voltem a bater no stream em uníssono (thundering herd).
      const ceil = Math.min(30000, 2000 * 2 ** attempt);
      const delay = ceil / 2 + Math.random() * (ceil / 2);
      retryAttemptRef.current = attempt + 1;
      // O spinner nunca pára enquanto o utilizador quiser ouvir: fica em "A ligar…"
      // e a religar em fundo até o stream regressar (auto-cura, sem estado morto).
      setLoading(true);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (!wantPlayRef.current || needsGestureRef.current) return;
        markProgress(); // dá uma folga a esta tentativa antes de o watchdog a julgar
        audio.src = streamUrl; // elemento fresco (essencial no iOS após stream morta)
        audio.load(); // volta ao ponto vivo, não retoma buffer velho
        audio.play().catch((err) => {
          if (isAutoplayBlocked(err)) {
            enterNeedsGesture();
            return;
          }
          scheduleReconnect();
        });
      }, delay);
    };
    scheduleReconnectRef.current = scheduleReconnect;

    audio.addEventListener("playing", () => {
      needsGestureRef.current = false;
      clearRetry();
      markProgress();
      setLoading(false);
      setPlaying(true);
      setError(false);
      armStable(); // conta 30s de estabilidade antes de repor o backoff
    });
    // Progresso real do áudio: alimenta o watchdog e prova que o stream está vivo.
    audio.addEventListener("timeupdate", markProgress);
    audio.addEventListener("progress", markProgress);
    audio.addEventListener("pause", () => {
      cancelStable();
      setPlaying(false);
    });
    audio.addEventListener("waiting", () => {
      if (wantPlayRef.current) setLoading(true);
    });
    audio.addEventListener("error", () => {
      if (!wantPlayRef.current) return;
      // Ignora o "erro" que o nosso próprio load() dispara ao abortar o fetch anterior.
      if (audio.error && audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;
      cancelStable();
      setPlaying(false);
      scheduleReconnect();
    });
    // Numa emissão ao vivo o stream nunca "acaba"; se acaba, a ligação caiu → religa.
    audio.addEventListener("ended", () => {
      if (!wantPlayRef.current) return;
      cancelStable();
      setPlaying(false);
      scheduleReconnect();
    });

    // Watchdog — o bug central. Um socket half-open (restart do backend, blip de
    // rede, wake-from-sleep) NÃO dispara 'error' nem 'ended': o browser fica "a
    // tocar" sem áudio nenhum e o player prendia-se no spinner para sempre. Aqui,
    // se não chega áudio há STALL_MS e não há já uma religação agendada, forçamos
    // a religação (load()+play()). É o que faz a auto-cura funcionar de verdade.
    const watchdog = setInterval(() => {
      if (!wantPlayRef.current || needsGestureRef.current) return;
      if (retryTimerRef.current) return; // já há tentativa agendada
      if (audio.paused) return; // em pausa / ainda não arrancou — o toggle trata
      if (Date.now() - lastProgressRef.current > STALL_MS) {
        cancelStable();
        setPlaying(false); // reflecte o silêncio: o próximo toque religa, não pausa
        setLoading(true);
        scheduleReconnect();
      }
    }, WATCHDOG_MS);

    // Wake-from-sleep / rede regressou: religa já (o socket morto pode nunca
    // disparar 'error', por isso não esperamos por ele).
    const kick = () => {
      if (!wantPlayRef.current || needsGestureRef.current || document.hidden) return;
      clearRetry();
      retryAttemptRef.current = 0;
      markProgress();
      audio.src = streamUrl; // elemento fresco (essencial no iOS após stream morta)
      audio.load();
      audio.play().catch((err) => {
        if (isAutoplayBlocked(err)) {
          enterNeedsGesture();
          return;
        }
        scheduleReconnect();
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    audioRef.current = audio;
    return () => {
      clearRetry();
      cancelStable();
      clearInterval(watchdog);
      window.removeEventListener("online", kick);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      audio.pause();
      audio.src = "";
    };
  }, [streamUrl]);

  // Restaura volume/mute do localStorage no arranque (client-only, evita
  // mismatch de hidratação por só correr depois do mount).
  useEffect(() => {
    try {
      const v = localStorage.getItem(VOL_KEY);
      const m = localStorage.getItem(MUTED_KEY);
      if (v != null) {
        const nv = clamp01(parseFloat(v));
        volumeRef.current = nv;
        setVolumeState(nv);
      }
      if (m != null) {
        const nm = m === "1";
        mutedRef.current = nm;
        setMuted(nm);
      }
    } catch {
      /* localStorage indisponível (modo privado / iframe) — usa defaults */
    }
  }, []);

  // Aplica volume/mute ao elemento de áudio sempre que mudam.
  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [volume, muted]);

  function setVolume(v: number) {
    const nv = clamp01(v);
    setVolumeState(nv);
    if (nv > 0 && muted) setMuted(false); // mexer no volume tira do silêncio
    try {
      localStorage.setItem(VOL_KEY, String(nv));
      if (nv > 0) localStorage.setItem(MUTED_KEY, "0");
    } catch {
      /* ignora */
    }
  }

  function toggleMute() {
    setMuted((m) => {
      const nm = !m;
      try {
        localStorage.setItem(MUTED_KEY, nm ? "1" : "0");
      } catch {
        /* ignora */
      }
      return nm;
    });
  }

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

        const hist: Record<string, unknown>[] = Array.isArray(data?.song_history) ? data.song_history : [];
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
    // A ação do utilizador manda: cancela qualquer religação pendente.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (playing) {
      wantPlayRef.current = false;
      retryAttemptRef.current = 0;
      audio.pause();
      return;
    }
    try {
      wantPlayRef.current = true;
      needsGestureRef.current = false; // este toque É o gesto — reautoriza o play
      retryAttemptRef.current = 0;
      setLoading(true);
      setError(false);
      lastProgressRef.current = Date.now(); // folga para o watchdog na 1ª ligação
      // Emissão ao vivo: (re)liga sempre ao ponto vivo. Não há posição de buffer
      // que valha a pena retomar, e retomar buffer velho arrastava áudio atrasado
      // (e, depois de uma pausa longa, o buffer esgotava e prendia sem religar).
      // No iOS, depois de a stream morrer o elemento fica "vazio"/em erro e um
      // simples play() falha — e o telemóvel entrega a sessão de media à app de
      // música do sistema (Apple Music). Reatribuir a src ANTES do load(), dentro
      // do gesto do toque, garante sempre um elemento fresco e tocável.
      audio.src = streamUrl;
      audio.load();
      startedRef.current = true;
      setStarted(true);
      await audio.play();
    } catch (err) {
      if (isAutoplayBlocked(err)) {
        // Improvável num gesto real, mas se acontecer deixa o botão em "tocar".
        needsGestureRef.current = true;
        setLoading(false);
        return;
      }
      // Não desiste: tenta religar com backoff em vez de morrer no 1º erro.
      scheduleReconnectRef.current();
    }
  }
  toggleRef.current = toggle;

  // Controlo por teclado (Espaço / K), à imagem dos players do YouTube/SoundCloud.
  // Só depois do 1º play (senão roubava o Espaço/scroll a quem nunca tocou) e
  // nunca enquanto se escreve num campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (el?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (!startedRef.current) return;
      const isSpace = e.code === "Space" || e.key === " ";
      const isK = e.key === "k" || e.key === "K";
      if (isSpace || isK) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Media Session: handlers registados uma vez (usam refs para o estado atual).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* ação não suportada neste browser */
      }
    };
    set("play", () => {
      if (!playingRef.current) toggleRef.current();
    });
    set("pause", () => {
      if (playingRef.current) toggleRef.current();
    });
    set("stop", () => {
      if (playingRef.current) toggleRef.current();
    });
    return () => {
      set("play", null);
      set("pause", null);
      set("stop", null);
    };
  }, []);

  // Media Session: metadados (lockscreen / auscultadores / teclas de media).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (started && "MediaMetadata" in window) {
        const { artist, title } = splitLabel(now.texto);
        ms.metadata = new MediaMetadata({
          title: title || "Radio IT — em direto",
          artist: artist || (now.aoVivo ? "Em direto" : "Radio IT"),
          album: "IT.FM",
          artwork: now.arte
            ? [{ src: now.arte, sizes: "512x512" }]
            : [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
        });
      }
      ms.playbackState = playing ? "playing" : "paused";
    } catch {
      /* Media Session parcial nalguns browsers — ignora */
    }
  }, [now, playing, started]);

  const statusText = error
    ? "Stream indisponível"
    : loading
      ? "A ligar…"
      : playing
        ? now.texto
          ? `A tocar: ${now.texto}`
          : "Em direto"
        : started
          ? "Em pausa"
          : "Pronto a tocar";

  const value: PlayerState = {
    playing,
    loading,
    error,
    started,
    now,
    historico,
    toggle,
    volume,
    muted,
    setVolume,
    toggleMute,
    statusText,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
