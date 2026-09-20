"use client";

import { useEffect, useState } from "react";
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
  { href: "/gestao/jobs", label: "Jobs", Icon: IconJobs },
  { href: "/gestao/settings", label: "Settings", Icon: IconSettings },
];

function isActive(pathname: string, href: string) {
  // O índice /gestao é prefixo de tudo → só ativo em igualdade exata.
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

// Pílula de "ouvintes agora" na navbar — só no Live. Número base determinístico
// (sem mismatch de hidratação) com pequena deriva no cliente (mock).
function LiveListeners() {
  const [n, setN] = useState(342);
  useEffect(() => {
    const id = setInterval(() => {
      // deriva suave determinística por passo (sem Math.random)
      setN((v) => Math.max(0, v + (((v * 7 + 3) % 11) - 5)));
    }, 4000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      title="Ouvintes agora · ao vivo"
      className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)]"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
      <span className="tabular-nums">{n}</span>
      <span className="hidden font-normal text-[var(--gray)] sm:inline">ouvintes</span>
    </span>
  );
}

// Barra "Em direto" — trapézio de destaque colado à navbar, presente em TODAS
// as páginas do painel. Vive no shell (não na página Live) para andar SEMPRE
// junto do cabeçalho: como faz parte do mesmo bloco `sticky`, acompanha o
// overscroll da navbar em vez de descolar. O "agora" avança no cliente a partir
// de um valor determinístico do seam (sem mismatch de hidratação).
function GlobalNowBar({ live }: { live: LiveData }) {
  const [nowSec, setNowSec] = useState(live.decorridoInicial);
  useEffect(() => {
    const id = setInterval(() => setNowSec((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = buildSchedule(live.itens, parseHHMM(live.blocoInicio), nowSec);
  const playing = rows.find((r) => r.estado === "playing") ?? null;
  const titulo = playing?.item.titulo ?? "Piloto automático";
  const elapsed = playing ? fmtDur(Math.max(0, playing.item.duracao * (playing.progress / 100))) : "--:--";
  const total = playing ? fmtDur(playing.item.duracao) : "--:--";
  const trapezoid = { clipPath: "polygon(0 0, 100% 0, calc(100% - 22px) 100%, 22px 100%)" };

  return (
    <div className="flex justify-center px-4 pb-2">
      <div
        style={trapezoid}
        className="w-full max-w-2xl bg-brand px-9 pb-2.5 pt-2 text-[#0b3d1a] shadow-lg shadow-brand/20"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0b3d1a]/15">
            <IconPlay className="h-4 w-4" />
          </span>
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
        {/* progresso do que está a tocar */}
        <div className="mx-1 mt-1.5 h-1 overflow-hidden rounded-full bg-[#0b3d1a]/15">
          <div
            className="h-full rounded-full bg-[#0b3d1a] transition-[width] duration-1000 ease-linear"
            style={{ width: `${playing?.progress ?? 0}%` }}
          />
        </div>
      </div>
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

  // ⌘K / Ctrl+K abre a paleta de comandos; Esc fecha.
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
        {/* Cabeçalho fixo: top bar + barra "Em direto". Ambos no MESMO bloco
            sticky → andam sempre juntos e nunca descolam no overscroll. */}
        <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur-sm">
          <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-sm text-[var(--gray)] transition-colors hover:border-[var(--ink)]/20 sm:max-w-sm"
            >
              <IconSearch className="h-4 w-4 shrink-0" />
              <span className="truncate">Pesquisar ou comandar</span>
              <span className="ml-auto hidden shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px] sm:block">
                ⌘K
              </span>
            </button>
            <span className="flex-1 sm:hidden" />
            <LiveListeners />
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
          <GlobalNowBar live={live} />
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-8">
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

      {/* Paleta de comandos (⌘K) — navegação rápida; pesquisa real em breve */}
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
