"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconPainel,
  IconProgramas,
  IconLocutores,
  IconSegmentos,
  IconMusica,
  IconLog,
  IconJobs,
  IconSettings,
  IconBell,
  IconLogout,
  IconSearch,
  IconPlay,
  IconPause,
  IconFolder,
  IconClose,
} from "./icons";
import type { LiveData } from "../../_lib/live";
import { buildSchedule, fmtDur, parseHHMM } from "../../_lib/live-schedule";

type NavItem = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
};

const NAV: NavItem[] = [
  { href: "/gestao", label: "Painel", Icon: IconPainel },
  { href: "/gestao/programas", label: "Programas", Icon: IconProgramas },
  { href: "/gestao/locutores", label: "Locutores", Icon: IconLocutores },
  { href: "/gestao/segmentos", label: "Segmentos", Icon: IconSegmentos },
  { href: "/gestao/musica", label: "Música", Icon: IconMusica },
  { href: "/gestao/live", label: "Live", Icon: IconLog },
  { href: "/gestao/ficheiros", label: "Ficheiros", Icon: IconFolder },
  { href: "/gestao/jobs", label: "Jobs", Icon: IconJobs },
  { href: "/gestao/settings", label: "Settings", Icon: IconSettings },
];

const STREAM_URL = "https://radio.itfm.live/listen/it.fm/radio.mp3";

function isActive(pathname: string, href: string) {
  return href === "/gestao"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Module-level audio so it persists across re-renders / navigations
let _audio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio(STREAM_URL);
    _audio.preload = "none";
  }
  return _audio;
}

function LiveListeners({ count }: { count: number }) {
  return (
    <span
      title="Ouvintes agora · ao vivo"
      className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)]"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
      <span className="tabular-nums">{count}</span>
      <span className="hidden font-normal text-[var(--gray)] sm:inline">ouvintes</span>
    </span>
  );
}

// Floating "Em direto" player — below navbar, overlapping content
function FloatingPlayer({ live }: { live: LiveData }) {
  const [nowSec, setNowSec] = useState(live.decorridoInicial);
  const [playing, setPlaying] = useState(false);
  const anchorRef = useRef(Date.now());

  useEffect(() => {
    const anchor = anchorRef.current;
    const base = live.decorridoInicial;
    const sync = () => setNowSec(base + Math.floor((Date.now() - anchor) / 1000));
    const id = setInterval(sync, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [live.decorridoInicial]);

  // Sync playing state with module-level audio
  useEffect(() => {
    const audio = getAudio();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    setPlaying(!audio.paused);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    const audio = getAudio();
    if (audio.paused) {
      audio.src = STREAM_URL;
      audio.load();
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  const rows = buildSchedule(live.itens, parseHHMM(live.blocoInicio), nowSec);
  const playingRow = rows.find((r) => r.estado === "playing") ?? null;
  const titulo = playingRow?.item.titulo ?? "Piloto automático";
  const elapsed = playingRow ? fmtDur(Math.max(0, playingRow.item.duracao * (playingRow.progress / 100))) : "--:--";
  const total = playingRow ? fmtDur(playingRow.item.duracao) : "--:--";
  const trapezoid = { clipPath: "polygon(0 0, 100% 0, calc(100% - 22px) 100%, 22px 100%)" };

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-[57px] z-10 flex justify-center px-4 md:left-[76px]">
      <div
        style={trapezoid}
        className="pointer-events-auto w-full max-w-2xl bg-brand px-9 pb-2.5 pt-2 text-[#0b3d1a] shadow-lg shadow-brand/20"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pausar rádio" : "Ouvir rádio em direto"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0b3d1a]/15 transition-transform hover:scale-110 active:scale-95"
          >
            {playing ? (
              <IconPause className="h-4 w-4" />
            ) : (
              <IconPlay className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Em direto</span>
              <span className="truncate text-[11px] opacity-70">
                {live.now.programa} · {live.now.locutor}
              </span>
            </div>
            <div className="truncate font-[family-name:var(--font-logo)] text-[15px] font-semibold leading-tight">
              {titulo}
            </div>
          </div>
          <span className="shrink-0 font-[family-name:var(--font-logo)] text-xs font-semibold tabular-nums">
            {elapsed} / {total}
          </span>
        </div>
        <div className="mx-1 mt-1.5 h-1 overflow-hidden rounded-full bg-[#0b3d1a]/15">
          <div
            className="h-full rounded-full bg-[#0b3d1a] transition-[width] duration-1000 ease-linear"
            style={{ width: `${playingRow?.progress ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Expandable inline search
function InlineSearch({
  expanded,
  onToggle,
  onOpenPalette,
}: {
  expanded: boolean;
  onToggle: () => void;
  onOpenPalette: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Pesquisar (⌘K)"
        onClick={onToggle}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
      >
        <IconSearch className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 transition-all">
      <IconSearch className="h-4 w-4 shrink-0 text-[var(--gray)]" />
      <input
        ref={inputRef}
        placeholder="Pesquisar…"
        className="w-28 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--gray)] sm:w-44"
        onKeyDown={(e) => {
          if (e.key === "Escape") onToggle();
          if (e.key === "Enter") {
            onOpenPalette();
            onToggle();
          }
        }}
        onBlur={() => {
          setTimeout(onToggle, 150);
        }}
      />
      <span className="hidden shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--gray)] sm:block">
        ⌘K
      </span>
    </div>
  );
}

export default function AppShell({
  operator,
  live,
  children,
}: {
  operator: { name: string; email: string | null };
  live: LiveData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // ⌘K / Ctrl+K opens command palette; Esc closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === "Escape") {
        setPalette(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="gestao flex min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
      {/* Rail de ícones (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-[76px] shrink-0 flex-col items-center border-r border-[var(--line)] bg-[var(--card)] py-4 md:flex">
        <Link
          href="/gestao"
          aria-label="Radio IT · Gestão"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand font-[family-name:var(--font-logo)] text-sm font-bold text-[#0b3d1a]"
        >
          IT
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map(({ href, label, Icon }) => {
            const on = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                title={label}
                className={
                  on
                    ? "flex w-16 flex-col items-center gap-1 rounded-xl bg-[var(--ink)] px-2 py-2 text-white"
                    : "flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
                }
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </nav>
        <a
          href="/logout"
          title="Sair"
          className="flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
        >
          <IconLogout className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">Sair</span>
        </a>
      </aside>

      {/* Coluna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — single row, icons right-aligned */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-sm sm:px-6">
          <span className="flex-1" />
          <LiveListeners count={live.now.ouvintes} />
          <InlineSearch
            expanded={searchExpanded}
            onToggle={() => setSearchExpanded((v) => !v)}
            onOpenPalette={() => setPalette(true)}
          />
          <button
            type="button"
            aria-label="Notificações"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
          >
            <IconBell className="h-5 w-5" />
          </button>
          <span
            title={operator.email ?? operator.name}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-medium text-white"
          >
            {initials(operator.name)}
          </span>
        </header>

        {/* Floating player — overlaps content, below navbar */}
        <FloatingPlayer live={live} />

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-16 sm:px-6 md:pb-8">
          {children}
        </main>
      </div>

      {/* Tab bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[var(--line)] bg-[var(--card)] px-2 py-2 md:hidden">
        {NAV.map(({ href, label, Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-medium ${
                on ? "text-[var(--ink)]" : "text-[var(--gray)]"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Paleta de comandos (⌘K) */}
      {palette ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
          onClick={() => setPalette(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-sm text-[var(--gray)]">
              <IconSearch className="h-4 w-4" />
              <input
                autoFocus
                placeholder="Ir para… (pesquisa em breve)"
                className="w-full bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--gray)]"
                onKeyDown={(e) => e.key === "Escape" && setPalette(false)}
              />
            </div>
            <ul className="max-h-72 overflow-auto p-2">
              {NAV.map(({ href, label, Icon }) => (
                <li key={href}>
                  <button
                    type="button"
                    onClick={() => {
                      setPalette(false);
                      router.push(href);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
                  >
                    <Icon className="h-4 w-4 text-[var(--gray)]" />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
