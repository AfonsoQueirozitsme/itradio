"use client";

// Quadro de PROGRAMAS. Mostra a grelha da estação (6 programas com locutor + a
// madrugada em rotação geral) de duas formas alternáveis: uma TIMELINE de 24 h
// (horas de Lisboa) com os blocos posicionados pela janela, e uma LISTA de
// cartões. Clicar num bloco/cartão abre um drawer com o detalhe (locutor, pool,
// segmentos, jingle, janela/dias) e um modo de edição só de DEMONSTRAÇÃO.
//
// A "vida" (linha do "agora" a atravessar a grelha + contagem para o próximo
// programa) é simulada no cliente a partir de `data.agora` (valor determinístico
// do seam → sem mismatch de hidratação) até ligarmos ao nowplaying + playlists.

import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, Stat, StatusChip } from "./ui";
import { PoolBar } from "./charts";
import {
  IconProgramas,
  IconLocutores,
  IconClock,
  IconGrid,
  IconClose,
  IconPlay,
  IconAlert,
  IconChevronRight,
} from "./icons";
import type {
  ProgramasData,
  Programa,
  ProgramaEstado,
  Segmento,
  SegTipo,
  Janela,
} from "../../_lib/programas";

// ── Ícone local (lápis) — não existe em icons.tsx ────────────────────────────
function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2V20z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAY = 86400;

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function hhmmToSec(s: string) {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 3600 + (m || 0) * 60;
}
function fmtClock(sec: number) {
  const s = ((sec % DAY) + DAY) % DAY;
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}`;
}
function fmtDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${pad(s)}`;
}
function fmtEmMin(min: number) {
  if (min <= 0) return "agora";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${pad(min % 60)}`;
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}
function janelasLabel(js: Janela[]) {
  return js.map((j) => `${j.inicio}–${j.fim}`).join(" · ");
}
function pctLeft(sec: number) {
  return (sec / DAY) * 100;
}
function pctWidth(a: number, b: number) {
  return ((b - a) / DAY) * 100;
}

// ── Mapas de estado / segmento ───────────────────────────────────────────────
type ChipTone = "ok" | "neutral" | "warn" | "danger" | "live";
const ESTADO_TONE: Record<ProgramaEstado, ChipTone> = {
  no_ar: "live",
  agendado: "neutral",
  pausado: "warn",
};
const ESTADO_LABEL: Record<ProgramaEstado, string> = {
  no_ar: "No ar",
  agendado: "Agendado",
  pausado: "Pausado",
};
const SEG: Record<SegTipo, { label: string; dot: string }> = {
  noticias: { label: "Notícias", dot: "bg-emerald-400" },
  meteo: { label: "Meteo", dot: "bg-sky-400" },
  transito: { label: "Trânsito", dot: "bg-amber-400" },
};

// Cores do bloco na timeline, por estado.
function blockClass(estado: ProgramaEstado) {
  switch (estado) {
    case "no_ar":
      return "border-transparent bg-brand text-[#0b3d1a] shadow-sm ring-1 ring-brand/50";
    case "pausado":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--ink)]/25";
  }
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ProgramasBoard({ data }: { data: ProgramasData }) {
  const [view, setView] = useState<"timeline" | "lista">("timeline");
  const [sel, setSel] = useState<Programa | null>(null);
  const [nowSec, setNowSec] = useState<number>(hhmmToSec(data.agora));

  // o "agora" avança em tempo real, a partir de um valor determinístico do seam
  useEffect(() => {
    const id = setInterval(() => setNowSec((v) => (v + 1) % DAY), 1000);
    return () => clearInterval(id);
  }, []);

  const { horasLocutor, horasRotacao, totalHoras, locutoresAtivos, totalProgramas, proximo } =
    data.kpis;
  const pctLocutor = Math.round((horasLocutor / totalHoras) * 100);
  const noAr = data.programas.filter((p) => p.estado === "no_ar").length;

  // contagem ao vivo para o próximo programa (deriva de nowSec)
  const proximoSec = hhmmToSec(proximo.hora);
  const emMin = Math.max(0, Math.round((proximoSec - nowSec) / 60));

  // programas dos quais o locutor selecionado também apresenta (nota "apresenta também")
  const outrosDoLocutor = sel
    ? data.programas.filter((p) => p.locutor === sel.locutor && p.slug !== sel.slug).map((p) => p.nome)
    : [];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Programas" value={totalProgramas} icon={<IconProgramas className="h-4 w-4" />}>
          <div className="flex items-center gap-2">
            <StatusChip tone="live" dot>
              {noAr} no ar
            </StatusChip>
            <span className="text-[11px] text-[var(--gray)]">+ madrugada</span>
          </div>
        </Stat>

        <Stat
          label="Grelha coberta"
          value={totalHoras}
          unit={` / ${totalHoras} h`}
          icon={<IconGrid className="h-4 w-4" />}
        >
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
            <div className="bg-brand" style={{ width: `${(horasLocutor / totalHoras) * 100}%` }} />
            <div className="bg-[var(--line)]" style={{ width: `${(horasRotacao / totalHoras) * 100}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-[var(--gray)]">
            {horasLocutor} h locutor · {horasRotacao} h rotação · {pctLocutor}% com locutor
          </div>
        </Stat>

        <Stat
          label="Locutores ativos"
          value={locutoresAtivos}
          icon={<IconLocutores className="h-4 w-4" />}
        >
          <span className="text-[11px] text-[var(--gray)]">Sofia Martins tem 2 shows</span>
        </Stat>

        <Stat label="Próximo a entrar" value={proximo.hora} icon={<IconClock className="h-4 w-4" />}>
          <span className="text-[11px] text-[var(--gray)]">
            <span className="font-medium text-[var(--ink)]">{proximo.nome}</span> · em {fmtEmMin(emMin)}
          </span>
        </Stat>
      </div>

      {/* Vista principal (Timeline ⇄ Lista) */}
      <Card className="p-4">
        <CardHeader
          title={view === "timeline" ? "Grelha do dia" : "Programas"}
          action={
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-[11px] tabular-nums text-[var(--gray)] sm:inline-flex">
                <IconClock className="h-3.5 w-3.5" />
                Agora {fmtClock(nowSec)} · Lisboa
              </span>
              <ViewToggle view={view} onChange={setView} />
            </div>
          }
        />

        <div className="mt-4">
          {view === "timeline" ? (
            <GridTimeline data={data} nowSec={nowSec} onSelect={setSel} />
          ) : (
            <ProgramaLista data={data} onSelect={setSel} />
          )}
        </div>
      </Card>

      {/* Nota de demonstração */}
      <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Demonstração: a grelha é lida de <span className="font-mono">lib/programs.mjs</span> e mapeada para
        playlists do AzuraCast. Editar aqui não escreve nada — ao ligar, guardar valida a janela/pool e escreve
        com backup. Segredos (<span className="font-mono">.env</span>) nunca aparecem aqui.
      </p>

      {sel ? (
        <ProgramaDrawer prog={sel} outros={outrosDoLocutor} onClose={() => setSel(null)} />
      ) : null}
    </div>
  );
}

// ── Toggle de vista ──────────────────────────────────────────────────────────
function ViewToggle({
  view,
  onChange,
}: {
  view: "timeline" | "lista";
  onChange: (v: "timeline" | "lista") => void;
}) {
  const opts: { key: "timeline" | "lista"; label: string }[] = [
    { key: "timeline", label: "Timeline" },
    { key: "lista", label: "Lista" },
  ];
  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--card)] p-1 text-xs">
      {opts.map((o) => {
        const on = o.key === view;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={
              on
                ? "rounded-full bg-[var(--ink)] px-3.5 py-1.5 font-medium text-white"
                : "rounded-full px-3.5 py-1.5 font-medium text-[var(--gray)] transition-colors hover:text-[var(--ink)]"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Timeline (eixo de 24 h) ──────────────────────────────────────────────────
function GridTimeline({
  data,
  nowSec,
  onSelect,
}: {
  data: ProgramasData;
  nowSec: number;
  onSelect: (p: Programa) => void;
}) {
  // blocos dos programas (um por janela; a janela partida gera dois)
  const blocks = data.programas.flatMap((p) =>
    p.janelas.map((j, i) => ({
      key: `${p.slug}-${i}`,
      prog: p,
      startSec: hhmmToSec(j.inicio),
      endSec: hhmmToSec(j.fim),
      janela: j,
      first: i === 0,
    })),
  );

  // madrugada: 23:00–07:00 atravessa a meia-noite → dois pedaços no eixo 0–24h
  const madrugada = data.madrugada.janelas.flatMap((j) => {
    const s = hhmmToSec(j.inicio);
    const e = hhmmToSec(j.fim);
    return e <= s
      ? [
          { s: 0, e, wide: e - 0 >= DAY * 0.12 },
          { s, e: DAY, wide: DAY - s >= DAY * 0.12 },
        ]
      : [{ s, e, wide: e - s >= DAY * 0.12 }];
  });

  // marcadores :30 do boletim "Notícias (live)" (07:30–22:30) + topo da hora 19:00
  const newsTicks = Array.from({ length: 22 - 7 + 1 }, (_, i) => (7 + i) * 3600 + 1800);
  const topOfHour = 19 * 3600;

  const rulerLabels = ["00", "03", "06", "09", "12", "15", "18", "21", "24"];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px] pb-1">
        {/* régua de horas */}
        <div className="flex justify-between text-[10px] tabular-nums text-[var(--gray)]">
          {rulerLabels.map((l) => (
            <span key={l}>{l}h</span>
          ))}
        </div>

        {/* lane do "agora" — pílula isolada (nunca colide com a régua/blocos) */}
        <div className="relative h-5">
          <span
            className="absolute bottom-0 -translate-x-1/2 rounded-full bg-brand px-2 py-[3px] text-[9px] font-bold tabular-nums text-[#0b3d1a] shadow-sm ring-2 ring-[var(--bg)]"
            style={{ left: `${pctLeft(nowSec)}%` }}
          >
            {fmtClock(nowSec)}
          </span>
        </div>

        {/* faixas (programas + notícias) com a linha do "agora" a atravessá-las */}
        <div className="relative">
          <div
            className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-brand"
            style={{ left: `${pctLeft(nowSec)}%` }}
          />

          {/* faixa dos programas */}
          <div className="relative h-20 rounded-xl border border-[var(--line)] bg-[var(--bg)]/50">
            {/* grelhas verticais de 3 em 3 horas */}
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                className="absolute inset-y-0 w-px bg-[var(--line)]/60"
                style={{ left: `${i * 12.5}%` }}
              />
            ))}

            {/* madrugada (rotação geral, esbatida) */}
            {madrugada.map((m, i) => (
              <div
                key={`mad-${i}`}
                className="absolute inset-y-1.5 z-0 flex items-center justify-center rounded-lg border border-dashed border-[var(--line)]"
                style={{
                  left: `${pctLeft(m.s)}%`,
                  width: `${pctWidth(m.s, m.e)}%`,
                  backgroundImage:
                    "repeating-linear-gradient(45deg, var(--line) 0, var(--line) 1px, transparent 1px, transparent 8px)",
                }}
                title={`${data.madrugada.nome} · ${janelasLabel(data.madrugada.janelas)}`}
              >
                {m.wide ? (
                  <span className="rounded-full bg-[var(--card)]/85 px-2 py-0.5 text-center text-[10px] leading-tight text-[var(--gray)]">
                    Rotação geral
                    <span className="block text-[9px] opacity-80">sem locutor · 23:00–07:00</span>
                  </span>
                ) : null}
              </div>
            ))}

            {/* blocos dos programas */}
            {blocks.map((b) => {
              const left = pctLeft(b.startSec);
              const width = pctWidth(b.startSec, b.endSec);
              const narrow = width < 5;
              const noAr = b.prog.estado === "no_ar";
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelect(b.prog)}
                  title={`${b.prog.nome} · ${b.janela.inicio}–${b.janela.fim} · ${b.prog.locutor}`}
                  style={{ left: `${left}%`, width: `${width}%`, minWidth: narrow ? 8 : 44 }}
                  className={`absolute inset-y-1.5 z-10 flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border text-left leading-tight transition-colors ${
                    narrow ? "items-center px-0" : "px-2.5"
                  } ${blockClass(b.prog.estado)}`}
                >
                  {narrow ? (
                    <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                  ) : (
                    <>
                      <span className="flex items-start gap-1 text-[11px] font-semibold">
                        {noAr ? (
                          <span className="relative mt-1 flex h-1.5 w-1.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0b3d1a] opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#0b3d1a]" />
                          </span>
                        ) : null}
                        <span className="line-clamp-2">{b.first ? b.prog.nome : "cont."}</span>
                      </span>
                      {b.first ? (
                        <span className="text-[10px] tabular-nums opacity-80">
                          {b.janela.inicio}–{b.janela.fim}
                        </span>
                      ) : null}
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* faixa das notícias — boletim :30 (07:30–22:30) + topo da hora 19:00 */}
          <div className="relative mt-1.5 h-9 rounded-lg border border-[var(--line)] bg-[var(--bg)]/50">
            <span className="absolute left-2 top-1.5 inline-flex items-center gap-1 text-[10px] text-[var(--gray)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Notícias (live)
            </span>
            {newsTicks.map((t) => (
              <span
                key={t}
                className="absolute bottom-2 h-3 w-px -translate-x-1/2 bg-[var(--gray)]/40"
                style={{ left: `${pctLeft(t)}%` }}
                title={`Boletim :30 · ${fmtClock(t)}`}
              />
            ))}
            {/* topo da hora — 19:00 (self-bed, sem jingle) */}
            <span
              className="absolute bottom-2 h-4 w-0.5 -translate-x-1/2 bg-brand"
              style={{ left: `${pctLeft(topOfHour)}%` }}
              title="Notícias topo da hora · 19:00"
            />
            <span
              className="absolute top-1 -translate-x-1/2 rounded-full bg-brand/15 px-1 text-[9px] font-semibold text-[#0b3d1a]"
              style={{ left: `${pctLeft(topOfHour)}%` }}
            >
              19h
            </span>
          </div>
        </div>

        {/* legenda */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--gray)]">
          <LegendDot className="bg-brand" label="No ar" />
          <LegendDot className="bg-[var(--card)] ring-1 ring-[var(--line)]" label="Agendado" />
          <LegendDot className="bg-amber-100 ring-1 ring-amber-300" label="Pausado" />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-dashed border-[var(--gray)]" />
            Rotação geral
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-px bg-[var(--gray)]/50" />
            Boletim :30
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-brand" />
            19h topo da hora
          </span>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

// ── Lista de programas ───────────────────────────────────────────────────────
function ProgramaLista({ data, onSelect }: { data: ProgramasData; onSelect: (p: Programa) => void }) {
  const ordered = [...data.programas].sort(
    (a, b) => hhmmToSec(a.janelas[0].inicio) - hhmmToSec(b.janelas[0].inicio),
  );
  return (
    <div className="space-y-2">
      {ordered.map((p) => (
        <button
          key={p.slug}
          type="button"
          onClick={() => onSelect(p)}
          className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-left transition-colors hover:bg-[var(--bg)]"
        >
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-logo)] text-sm font-semibold ${
              p.estado === "no_ar" ? "bg-brand text-[#0b3d1a]" : "bg-[var(--bg)] text-[var(--ink)]"
            }`}
          >
            {initials(p.locutor)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--ink)]">{p.nome}</span>
              <StatusChip tone={ESTADO_TONE[p.estado]} dot={p.estado === "no_ar"}>
                {ESTADO_LABEL[p.estado]}
              </StatusChip>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--gray)]">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 font-medium tabular-nums text-[var(--ink)]">
                <IconClock className="h-3 w-3" />
                {janelasLabel(p.janelas)}
              </span>
              <span>Seg–Dom</span>
              <span>·</span>
              <span>{p.locutor}</span>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-[#0b3d1a]">
                {p.pool.ytGenre}
              </span>
            </div>
          </div>

          <div className="w-40 shrink-0">
            <PoolBar label="Pool no ar" value={p.pool.atual} cap={p.pool.poolCap} />
          </div>

          <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--gray)]" />
        </button>
      ))}

      {/* madrugada — não é programa de locutor */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)]/40 p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--gray)]">
          <IconClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--ink)]">{data.madrugada.nome}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--gray)]">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 font-medium tabular-nums text-[var(--ink)]">
              <IconClock className="h-3 w-3" />
              {janelasLabel(data.madrugada.janelas)}
            </span>
            <span>{data.madrugada.nota}</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-[var(--gray)]">{data.madrugada.fonte}</span>
      </div>
    </div>
  );
}

// ── Drawer de detalhe (read-only + edição de demonstração) ───────────────────
function ProgramaDrawer({
  prog,
  outros,
  onClose,
}: {
  prog: Programa;
  outros: string[];
  onClose: () => void;
}) {
  const [editar, setEditar] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [prog01, setProg01] = useState(0);

  // Escape fecha
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // real audio playback for the jingle
  function toggleJingle() {
    if (!audioRef.current) {
      audioRef.current = new Audio(`/api/gestao/audio?path=${encodeURIComponent(prog.jingle.fonte)}`);
      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current;
        if (a && a.duration) setProg01((a.currentTime / a.duration) * 100);
      });
      audioRef.current.addEventListener("ended", () => { setPlaying(false); setProg01(0); });
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const pool = prog.pool;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* cabeçalho */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={ESTADO_TONE[prog.estado]} dot={prog.estado === "no_ar"}>
                {ESTADO_LABEL[prog.estado]}
              </StatusChip>
              <span className="text-xs tabular-nums text-[var(--gray)]">{janelasLabel(prog.janelas)}</span>
              <span className="text-xs text-[var(--gray)]">· Seg–Dom</span>
            </div>
            <h3 className="mt-1 truncate font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">
              {prog.nome}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* corpo */}
        <div className="flex-1 overflow-auto px-4 py-4">
          {/* locutor */}
          <Section title="Locutor">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg)] font-[family-name:var(--font-logo)] text-sm font-semibold text-[var(--ink)]">
                {initials(prog.locutor)}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--ink)]">{prog.locutor}</div>
                {outros.length ? (
                  <div className="text-[11px] text-[var(--gray)]">Apresenta também: {outros.join(", ")}</div>
                ) : (
                  <div className="text-[11px] text-[var(--gray)]">Género interno: {prog.genero}</div>
                )}
              </div>
            </div>
          </Section>

          {/* música / pool */}
          <Section title="Música">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--ink)]">{pool.playlist}</span>
                <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] font-semibold text-white">
                  {pool.loudness}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-[#0b3d1a]">
                  {pool.ytGenre}
                </span>
                {pool.ytGenreAlts.map((a) => (
                  <span
                    key={a}
                    className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[11px] text-[var(--gray)] ring-1 ring-[var(--line)]"
                  >
                    {a}
                  </span>
                ))}
              </div>

              <div className="mt-3">
                <PoolBar label="Pool no ar" value={pool.atual} cap={pool.poolCap} />
                <div className="mt-1.5 text-[11px] text-[var(--gray)]">
                  +{pool.poolSize}/refresh · teto {pool.poolCap} · {pool.atual} no ar
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--gray)]">
                <span>
                  Duração {fmtDur(pool.minDur)}–{fmtDur(pool.maxDur)}
                </span>
                <span className="font-mono opacity-80">{pool.dir}</span>
              </div>
            </div>
          </Section>

          {/* segmentos */}
          <Section title="Segmentos incluídos">
            {prog.segmentos.length ? (
              <ul className="space-y-1.5">
                {prog.segmentos.map((s, i) => (
                  <SegmentoRow key={i} s={s} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs text-[var(--gray)]">
                Sem segmentos nesta janela (programa modular curto).
              </p>
            )}
          </Section>

          {/* jingle / ID */}
          <Section title="Jingle / ID">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleJingle}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white transition-transform hover:scale-105"
                  aria-label={playing ? "Pausar" : "Reproduzir"}
                >
                  {playing ? <span className="text-sm">❚❚</span> : <IconPlay className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--ink)]">{prog.jingle.id}</div>
                  <div className="truncate font-mono text-[11px] text-[var(--gray)]">{prog.jingle.fonte}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
                      style={{ width: `${prog01}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-[var(--gray)]">Pré-escuta via proxy de áudio.</p>
            </div>
          </Section>

          {/* janela & dias */}
          <Section title="Janela & dias">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
              <div className="flex flex-wrap gap-1.5">
                {prog.janelas.map((j, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--card)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--ink)] ring-1 ring-[var(--line)]"
                  >
                    <IconClock className="h-3 w-3" />
                    {j.inicio}–{j.fim}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {prog.diasSemana.map((d) => (
                  <span
                    key={d}
                    className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0b3d1a]"
                  >
                    {d}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-[var(--gray)]">
                schedule_items com <span className="font-mono">days: []</span> → todos os dias · horas de Lisboa.
              </p>
            </div>
          </Section>

          {/* edição de demonstração */}
          {editar ? (
            <Section title="Editar (demonstração)">
              <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  demonstração
                </span>
                <EditField label="Janela" value={janelasLabel(prog.janelas)} />
                <EditField label="ytGenre" value={pool.ytGenre} />
                <div className="grid grid-cols-2 gap-2.5">
                  <EditField label="poolSize" value={String(pool.poolSize)} />
                  <EditField label="poolCap" value={String(pool.poolCap)} />
                </div>
                <p className="text-[10px] text-amber-700">
                  Campos desativados — nenhuma escrita real. Ao ligar, guardar valida contra
                  <span className="font-mono"> programs.mjs</span> e AzuraCast (baixar o teto apaga faixas ao vivo).
                </p>
              </div>
            </Section>
          ) : null}
        </div>

        {/* rodapé */}
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3">
          <button
            type="button"
            onClick={() => setEditar((v) => !v)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
          >
            <IconPencil className="h-4 w-4" />
            {editar ? "Fechar edição" : "Editar"}
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">{title}</div>
      {children}
    </div>
  );
}

function SegmentoRow({ s }: { s: Segmento }) {
  const meta = SEG[s.tipo];
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-2.5">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--ink)]">{meta.label}</span>
          <span className="text-[11px] text-[var(--gray)]">{s.cadencia}</span>
        </div>
        <div className="truncate font-mono text-[10px] text-[var(--gray)] opacity-80">{s.fonte}</div>
      </div>
    </li>
  );
}

function EditField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-amber-700">{label}</span>
      <input
        type="text"
        defaultValue={value}
        disabled
        className="w-full cursor-not-allowed rounded-lg border border-amber-200 bg-[var(--card)] px-2.5 py-1.5 text-sm text-[var(--gray)]"
      />
    </label>
  );
}
