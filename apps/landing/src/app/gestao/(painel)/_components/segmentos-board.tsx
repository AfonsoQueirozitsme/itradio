"use client";

// Quadro de Segmentos. Lista as inserções recorrentes (notícias, meteo, trânsito,
// sweeper/ID) com a grelha em horas de Lisboa, duração, fonte técnica e ducking,
// um destaque do "próximo segmento" e um drawer com pré-visualização simulada,
// toggles e um "Aplicar" simulado. Dados mock via seam _lib/segmentos.ts.
//
// A "vida" (relógio de Lisboa, contagem decrescente para a próxima inserção) é
// simulada no cliente a partir de `agoraLisboa` — valor DETERMINÍSTICO do seam,
// sem mismatch de hidratação (ver live.ts) — e avança num setInterval.
//
// Todas as ações (disparar, alterar ducking, pausar, aplicar) são SIMULADAS até
// ligarmos ao backend; nada é escrito no .liq nem disparado no ar a partir daqui.
// Ao ligar: "Disparar agora" → `touch .itfm_fire_news` (sem restart); "Aplicar"
// → reescreve segments_mix.liq + deploy-segments.mjs (PUT custom_config + 1
// restart do backend, com backup). Segredos (.env) nunca são geridos aqui.

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, StatusChip } from "./ui";
import { IconClock, IconPlay, IconClose, IconAlert, IconCheck, IconChevronRight } from "./icons";
import type { SegmentosData, Segmento, SegTipo } from "../../_lib/segmentos";

// ── Tabela de tipos (cor/rótulo) — coerente com a coloração do live-console ──
const TIPO: Record<SegTipo, { label: string; dot: string; chip: string }> = {
  noticias: { label: "Notícias", dot: "bg-emerald-400", chip: "bg-emerald-100 text-emerald-700" },
  meteo: { label: "Meteo", dot: "bg-sky-400", chip: "bg-sky-100 text-sky-700" },
  transito: { label: "Trânsito", dot: "bg-amber-400", chip: "bg-amber-100 text-amber-700" },
  sweeper: { label: "Sweeper", dot: "bg-violet-400", chip: "bg-violet-100 text-violet-700" },
  id: { label: "ID", dot: "bg-rose-400", chip: "bg-rose-100 text-rose-700" },
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function parseHHMM(s: string) {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 3600 + (m || 0) * 60;
}
function fmtClock(secOfDay: number) {
  const h = Math.floor(secOfDay / 3600) % 24;
  const m = Math.floor((secOfDay % 3600) / 60);
  return `${pad(h)}:${pad(m)}`;
}
function fmtRel(min: number) {
  if (min <= 0) return "agora";
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `em ${h}h ${m}m` : `em ${h}h`;
}
function fmtDur(seg: Segmento) {
  return seg.duracaoVariavel ? `~${seg.duracaoSeg} s` : `${seg.duracaoSeg} s`;
}

// Resumo técnico de uma linha (mecanismo + ducking), curto.
function fonteResumo(seg: Segmento) {
  if (seg.fonte.mecanismo === "azuracast") return "AzuraCast (cart)";
  const d = seg.ducking;
  if (!d) return "segments_mix.liq";
  if (seg.tipo === "noticias") {
    return `segments_mix.liq · RSS→TTS 2 vozes · música ↓${d.musicaVolPct}%`;
  }
  const gain = d.segGainPct > 100 ? `+${d.segGainPct - 100}% voz` : "voz -16 LUFS";
  return `injector · ${gain} · bed ${d.bedVolPct}% · música ↓${d.musicaVolPct}%`;
}

export default function SegmentosBoard({ data }: { data: SegmentosData }) {
  const [segs, setSegs] = useState<Segmento[]>(data.segmentos);
  const [selId, setSelId] = useState<string | null>(null);
  const [disparos, setDisparos] = useState(data.resumo.disparosHoje);
  const [heroFired, setHeroFired] = useState(false);

  // relógio de Lisboa (arranca do valor determinístico do seam)
  const baseSec = useMemo(() => parseHHMM(data.agoraLisboa), [data.agoraLisboa]);
  const [nowSec, setNowSec] = useState(baseSec);
  useEffect(() => {
    const id = setInterval(() => setNowSec((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedMin = Math.floor((nowSec - baseSec) / 60);

  const ativos = segs.filter((s) => s.estado === "ativo").length;
  const pausados = segs.filter((s) => s.estado === "pausado").length;

  const selected = selId ? segs.find((s) => s.id === selId) ?? null : null;
  const heroSeg = segs.find((s) => s.id === data.proximo.segId) ?? null;
  const proximoEmMin = Math.max(0, data.proximo.emMin - elapsedMin);

  function toggleEstado(id: string) {
    setSegs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, estado: s.estado === "ativo" ? "pausado" : "ativo" } : s)),
    );
  }
  function dispararNoticias() {
    setDisparos((v) => v + 1);
    setHeroFired(true);
    setTimeout(() => setHeroFired(false), 2200);
  }

  return (
    <div className="space-y-4">
      {/* 1 — Destaque do próximo segmento */}
      <Card className="overflow-hidden p-4 sm:p-5" as="section">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-[var(--gray)]">
              <IconClock className="h-3.5 w-3.5" />
              Próximo segmento
              <span className="opacity-60">· {data.proximo.slotLabel}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${TIPO[data.proximo.tipo].dot}`} />
              <TipoChip tipo={data.proximo.tipo} />
              <span className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">
                {data.proximo.nome}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--gray)]">
              {heroSeg ? fonteResumo(heroSeg) : "segments_mix.liq"}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="font-[family-name:var(--font-logo)] text-[34px] font-semibold leading-none tabular-nums text-[var(--ink)]">
                {data.proximo.abs}
              </div>
              <div className="mt-1 text-xs font-medium text-[var(--gray)]">{fmtRel(proximoEmMin)}</div>
            </div>
            <StatusChip tone={data.injector.ativo ? "live" : "danger"} dot>
              {data.injector.ativo ? "Injetor no ar" : "Injetor parado"}
            </StatusChip>
          </div>
        </div>

        {/* Disparar agora — só notícias (mapeia a `touch .itfm_fire_news`) */}
        {heroSeg?.disparoManual ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={dispararNoticias}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-[#0b3d1a] transition-transform hover:scale-105"
            >
              <IconPlay className="h-4 w-4" />
              Disparar agora (demo)
            </button>
            {heroFired ? (
              <StatusChip tone="ok" dot>
                Disparado — demonstração
              </StatusChip>
            ) : (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--gray)]">
                {heroSeg.disparoManual}
                <span className="font-sans opacity-70">· dispara já, sem restart</span>
              </span>
            )}
          </div>
        ) : null}
      </Card>

      {/* 2 — KPIs compactos */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Segmentos ativos" value={ativos} tone="ok" />
        <MiniStat label="Pausados" value={pausados} tone="neutral" />
        <MiniStat label="Disparos hoje" value={disparos} tone="neutral" />
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-[var(--gray)]">Injetor Liquidsoap</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusChip tone={data.injector.ativo ? "live" : "danger"} dot>
              {data.injector.ativo ? "No ar" : "Parado"}
            </StatusChip>
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--gray)]">
            restart {data.injector.ultimoRestart} · custom_config {data.injector.customConfigChars.toLocaleString("pt-PT")} car.
          </div>
        </Card>
      </div>

      {/* 3 — Lista de segmentos */}
      <Card className="p-4">
        <CardHeader title="Segmentos" hint={`grelha · agora ${fmtClock(nowSec)} Lisboa`} />

        {/* Tabela (>= md) */}
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                <th className="px-2 py-2 font-semibold">Nome / tipo</th>
                <th className="px-2 py-2 font-semibold">Agenda (Lisboa)</th>
                <th className="px-2 py-2 font-semibold">Duração</th>
                <th className="px-2 py-2 font-semibold">Fonte técnica</th>
                <th className="px-2 py-2 font-semibold">Próxima</th>
                <th className="px-2 py-2 font-semibold">Estado</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {segs.map((s) => {
                const emMin = s.proxima ? Math.max(0, s.proxima.emMin - elapsedMin) : null;
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSelId(s.id)}
                    className="cursor-pointer border-b border-[var(--line)] transition-colors last:border-0 hover:bg-[var(--bg)]"
                  >
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${TIPO[s.tipo].dot}`} />
                        <span className="font-medium text-[var(--ink)]">{s.nome}</span>
                      </div>
                      <div className="mt-0.5 pl-4">
                        <TipoChip tipo={s.tipo} />
                      </div>
                    </td>
                    <td className="px-2 py-3 text-xs text-[var(--gray)]">{s.agendaLabel}</td>
                    <td className="px-2 py-3">
                      <span className="tabular-nums text-[var(--ink)]">{fmtDur(s)}</span>
                      {s.duracaoVariavel ? (
                        <div className="text-[10px] text-[var(--gray)]">variável / disparo</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-[var(--gray)]">{fonteResumo(s)}</td>
                    <td className="px-2 py-3 text-xs">
                      {s.proxima ? (
                        <>
                          <span className="font-[family-name:var(--font-logo)] font-semibold tabular-nums text-[var(--ink)]">
                            {s.proxima.abs}
                          </span>
                          <div className="text-[10px] text-[var(--gray)]">{fmtRel(emMin ?? 0)}</div>
                        </>
                      ) : (
                        <span className="text-[var(--gray)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <StatusChip tone={s.estado === "ativo" ? "ok" : "neutral"} dot={s.estado === "ativo"}>
                        {s.estado === "ativo" ? "Ativo" : "Pausado"}
                      </StatusChip>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <IconChevronRight className="ml-auto h-4 w-4 text-[var(--gray)]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Cartões (< md) */}
        <div className="mt-3 space-y-2 md:hidden">
          {segs.map((s) => {
            const emMin = s.proxima ? Math.max(0, s.proxima.emMin - elapsedMin) : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelId(s.id)}
                className="flex w-full items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-left transition-colors hover:bg-[var(--bg)]"
              >
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TIPO[s.tipo].dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[var(--ink)]">{s.nome}</span>
                    <TipoChip tipo={s.tipo} />
                    <StatusChip tone={s.estado === "ativo" ? "ok" : "neutral"} dot={s.estado === "ativo"}>
                      {s.estado === "ativo" ? "Ativo" : "Pausado"}
                    </StatusChip>
                  </div>
                  <div className="mt-1 text-xs text-[var(--gray)]">{s.agendaLabel}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--gray)]">
                    <span className="tabular-nums">{fmtDur(s)}</span>
                    <span className="font-mono opacity-80">{fonteResumo(s)}</span>
                    {s.proxima ? (
                      <span className="tabular-nums">
                        {s.proxima.abs} · {fmtRel(emMin ?? 0)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--gray)]" />
              </button>
            );
          })}
        </div>

        <p className="mt-3 flex items-start gap-2 text-[11px] text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          As horas são de Lisboa (o host/container corre em UTC). Sweeper e ID são geridos pelo AzuraCast e não têm
          grelha :30 do injetor.
        </p>
      </Card>

      {selected ? (
        <SegmentoDrawer
          seg={selected}
          onClose={() => setSelId(null)}
          onToggleEstado={() => toggleEstado(selected.id)}
          onFire={dispararNoticias}
        />
      ) : null}
    </div>
  );
}

// ── Pílula de tipo ──────────────────────────────────────────────────────────
function TipoChip({ tipo }: { tipo: SegTipo }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIPO[tipo].chip}`}>
      {TIPO[tipo].label}
    </span>
  );
}

// ── KPI compacto ──────────────────────────────────────────────────────────
function MiniStat({ label, value, tone }: { label: string; value: number; tone: "ok" | "neutral" }) {
  const color = tone === "ok" ? "text-[#0b3d1a]" : "text-[var(--ink)]";
  return (
    <Card className="p-4">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className={`mt-1.5 font-[family-name:var(--font-logo)] text-[30px] font-semibold leading-none tabular-nums ${color}`}>
        {value}
      </div>
    </Card>
  );
}

// ── Secção do drawer ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">{title}</div>
      {children}
    </div>
  );
}

function KeyVals({ rows }: { rows: { label: string; valor: string }[] }) {
  return (
    <dl className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--bg)]/40">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-3 px-3 py-2">
          <dt className="text-xs text-[var(--gray)]">{r.label}</dt>
          <dd className="text-right text-xs font-medium text-[var(--ink)]">{r.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

// medidor horizontal do ducking (valor / escala, com rótulo à direita)
function Meter({ label, value, max, right }: { label: string; value: number; max: number; right: string }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--ink)]">{label}</span>
        <span className="tabular-nums text-[var(--gray)]">{right}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// waveform determinística (sem Math.random) para o player fake
const WAVE = [
  4, 8, 14, 10, 18, 24, 16, 12, 22, 30, 26, 18, 12, 20, 28, 34, 24, 16, 10, 14, 22, 30, 36, 28, 18, 12, 8, 16, 24,
  32, 26, 20, 14, 10, 18, 26, 22, 16, 10, 6,
];

function Waveform({ progress }: { progress: number }) {
  const filled = Math.round((progress / 100) * WAVE.length);
  return (
    <svg viewBox="0 0 200 40" width="100%" height={40} preserveAspectRatio="none" aria-hidden="true">
      {WAVE.map((h, i) => {
        const x = (i / WAVE.length) * 200;
        const bw = 200 / WAVE.length - 1.2;
        return (
          <rect
            key={i}
            x={x}
            y={20 - h / 2}
            width={Math.max(1, bw)}
            height={h}
            rx={1}
            fill={i < filled ? "var(--brand)" : "var(--line)"}
          />
        );
      })}
    </svg>
  );
}

// ── Drawer do segmento ───────────────────────────────────────────────────────
function SegmentoDrawer({
  seg,
  onClose,
  onToggleEstado,
  onFire,
}: {
  seg: Segmento;
  onClose: () => void;
  onToggleEstado: () => void;
  onFire: () => void;
}) {
  const isInjector = seg.fonte.mecanismo === "injector";
  const d = seg.ducking;

  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const [duckPct, setDuckPct] = useState(d ? d.musicaVolPct : 50);
  const [fired, setFired] = useState(false);
  const [aplic, setAplic] = useState<"idle" | "a_correr" | "feito">("idle");
  const [aplicProg, setAplicProg] = useState(0);
  const [confirmo, setConfirmo] = useState(false);

  // player fake
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setProg((v) => {
        if (v >= 100) {
          setPlaying(false);
          return 100;
        }
        return v + 2;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing]);

  // "Aplicar" simulado (dry-run → restart)
  useEffect(() => {
    if (aplic !== "a_correr") return;
    const id = setInterval(() => {
      setAplicProg((v) => {
        if (v >= 100) {
          clearInterval(id);
          setAplic("feito");
          return 100;
        }
        return v + 5;
      });
    }, 110);
    return () => clearInterval(id);
  }, [aplic]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function fireLocal() {
    onFire();
    setFired(true);
    setTimeout(() => setFired(false), 2200);
  }

  const fonteRows: { label: string; valor: string }[] = [
    { label: "Mecanismo", valor: isInjector ? "Injetor (segments_mix.liq)" : "AzuraCast (cart)" },
    { label: "Ficheiro", valor: seg.fonte.ficheiro },
    { label: "Geração", valor: seg.fonte.geracao },
    { label: "Loudness", valor: seg.fonte.loudness },
  ];
  if (seg.fonte.modeloTTS) fonteRows.push({ label: "Modelo TTS", valor: seg.fonte.modeloTTS });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* cabeçalho */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIPO[seg.tipo].dot}`} />
            <TipoChip tipo={seg.tipo} />
            <StatusChip tone={seg.estado === "ativo" ? "ok" : "neutral"} dot={seg.estado === "ativo"}>
              {seg.estado === "ativo" ? "Ativo" : "Pausado"}
            </StatusChip>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* corpo */}
        <div className="flex-1 overflow-auto px-4 py-4">
          <h3 className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">{seg.nome}</h3>
          <p className="mt-0.5 text-xs text-[var(--gray)]">{seg.descricao}</p>

          {/* Como funciona */}
          <Section title="Como funciona">
            <p className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs leading-relaxed text-[var(--gray)]">
              {isInjector ? (
                <>
                  Corre no injetor <span className="font-mono text-[var(--ink)]">segments_mix.liq</span> — uma thread
                  que lê <span className="font-mono">time.local()</span> a cada 2 s e dispara no flanco{" "}
                  {seg.slots.some((s) => s.minuto === 0) ? ":30 / :00" : ":30"}, baixando a música por baixo.{" "}
                  {seg.tipo === "noticias"
                    ? "O boletim é pré-mixado (voz + bed a -16 LUFS), self-bed, sem reforço de voz."
                    : "A voz entra reforçada sobre a música, com news_bed por baixo."}
                </>
              ) : (
                <>
                  Gerido pelo <span className="text-[var(--ink)]">AzuraCast</span> (playlist de jingles / anúncios de
                  topo de hora). Aqui o AzuraCast corta a música — não passa pelo injetor nem faz ducking.
                </>
              )}
            </p>
          </Section>

          {/* Agenda */}
          <Section title="Agenda (Lisboa)">
            {seg.slots.length ? (
              <div className="space-y-2.5">
                {seg.slots.map((slot, i) => (
                  <div key={i} className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-[var(--ink)] px-1.5 py-0.5 font-[family-name:var(--font-logo)] text-[11px] font-semibold text-white">
                        :{pad(slot.minuto)}
                      </span>
                      <span className="font-medium text-[var(--ink)]">{slot.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {slot.horas.map((h) => (
                        <span
                          key={h}
                          className="rounded-md border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--ink)]"
                        >
                          {pad(h)}h
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs text-[var(--gray)]">
                {seg.agendaLabel}
              </p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--gray)]">
              <IconClock className="mt-0.5 h-3 w-3 shrink-0" />
              Horas de Lisboa — o host/container corre em UTC; a conversão faz-se na ligação.
            </p>
          </Section>

          {/* Fonte técnica */}
          <Section title="Fonte técnica">
            <KeyVals rows={fonteRows} />
            {seg.tipo === "noticias" && seg.fonte.feeds && seg.fonte.vozes ? (
              <div className="mt-2.5 space-y-2.5">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                    Feeds ({seg.fonte.feeds.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {seg.fonte.feeds.map((f) => (
                      <span
                        key={f}
                        className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">Vozes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {seg.fonte.vozes.map((v) => (
                      <span
                        key={v.voiceId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {v.nome}
                        <span className="font-mono text-[10px] text-[var(--gray)]">{v.voiceId}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <p className="flex items-start gap-1.5 text-[11px] text-[var(--gray)]">
                  <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  Regenerado de 3 em 3h (news-live.mjs) — quota ElevenLabs apertada, com hash-skip e guarda de quota.
                </p>
              </div>
            ) : null}
          </Section>

          {/* Mistura / ducking — só injetor com ducking */}
          {isInjector && d ? (
            <Section title="Mistura / ducking">
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
                <Meter label="Música (por baixo)" value={duckPct} max={100} right={`↓ ${duckPct}%`} />
                <Meter
                  label="Segmento (voz)"
                  value={d.segGainPct}
                  max={150}
                  right={d.segGainPct > 100 ? `+${d.segGainPct - 100}%` : "0 dB (-16 LUFS)"}
                />
                <Meter
                  label="News bed"
                  value={d.bedVolPct}
                  max={100}
                  right={d.selfBed ? "self-bed" : `${d.bedVolPct}%`}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] pt-2.5 text-[11px] text-[var(--gray)]">
                  <span>
                    self-bed:{" "}
                    <span className="font-medium text-[var(--ink)]">{d.selfBed ? "sim" : "não"}</span>
                  </span>
                  <span>
                    restauro da música:{" "}
                    <span className="font-medium text-[var(--ink)]">~{d.restauroMs} ms</span>
                  </span>
                </div>
              </div>

              {/* slider editável (simulado) */}
              <label className="mt-3 block">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">
                    Ducking da música
                  </span>
                  <span className="font-[family-name:var(--font-logo)] text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {duckPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={2}
                  value={duckPct}
                  onChange={(e) => {
                    setDuckPct(parseInt(e.target.value, 10));
                    setAplic("idle");
                  }}
                  style={{ accentColor: "var(--brand)" }}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-[10px] text-[var(--gray)]">
                  <span>0% (corta)</span>
                  <span>music_vol {(duckPct / 100).toFixed(2)}</span>
                  <span>100% (sem ducking)</span>
                </div>
              </label>
            </Section>
          ) : null}

          {/* Pré-visualizar (simulado) */}
          <Section title="Pré-visualizar (demonstração)">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPlaying((v) => !v)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white transition-transform hover:scale-105"
                  aria-label={playing ? "Pausar" : "Reproduzir"}
                >
                  {playing ? <span className="text-sm">❚❚</span> : <IconPlay className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <Waveform progress={prog} />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--gray)]">
                    <span className="truncate font-mono">
                      {seg.preview.tipo === "audio" ? seg.preview.corpo : "programas/noticias_live.mp3"}
                    </span>
                    <span className="tabular-nums">{seg.preview.meta}</span>
                  </div>
                </div>
              </div>
            </div>

            {seg.preview.tipo === "texto" ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--gray)]">
                  Guião {seg.preview.meta ? `· ${seg.preview.meta}` : ""}
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-3 font-sans text-sm leading-relaxed text-[var(--ink)]">
                  {seg.preview.corpo}
                </pre>
              </div>
            ) : null}

            {/* Disparar agora — só notícias */}
            {seg.disparoManual ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={fireLocal}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)]/30 hover:bg-[var(--bg)]"
                >
                  <IconPlay className="h-3.5 w-3.5" />
                  Disparar agora (demo)
                </button>
                {fired ? (
                  <StatusChip tone="ok" dot>
                    Disparado — demonstração
                  </StatusChip>
                ) : (
                  <span className="font-mono text-[11px] text-[var(--gray)]">
                    {seg.disparoManual} · sem restart
                  </span>
                )}
              </div>
            ) : null}
          </Section>

          {/* Estado (toggle) */}
          <Section title="Estado">
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
              <div className="text-xs text-[var(--gray)]">
                {seg.estado === "ativo" ? "Vai ao ar na sua grelha." : "Não entra na emissão."}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={seg.estado === "ativo"}
                onClick={onToggleEstado}
                className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  seg.estado === "ativo" ? "bg-brand" : "bg-[var(--line)]"
                }`}
              >
                <span
                  className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    seg.estado === "ativo" ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </Section>

          {/* Aviso do Aplicar */}
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Demonstração.</strong> Ao ligar, "Aplicar" reescreve{" "}
              <span className="font-mono">segments_mix.liq</span> e corre{" "}
              <span className="font-mono">deploy-segments.mjs</span> (PUT <span className="font-mono">custom_config</span>{" "}
              + 1 restart do backend, com backup automático). Uma má edição = dead air no próximo restart.
              {seg.tipo === "noticias" ? (
                <>
                  {" "}
                  A geração do boletim é do <span className="font-mono">news-live.mjs</span> (FEEDS / GEN_HOURS), não se
                  altera aqui.
                </>
              ) : null}
            </span>
          </div>
        </div>

        {/* rodapé — Aplicar (simulado) */}
        <div className="border-t border-[var(--line)] px-4 py-3">
          {aplic === "feito" ? (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-2.5 text-xs text-[#0b3d1a]">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Aplicado (simulação). Ao ligar, grava com backup e faz 1 restart do backend.
            </div>
          ) : null}
          {aplic === "a_correr" ? (
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--bg)]">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
                style={{ width: `${aplicProg}%` }}
              />
            </div>
          ) : null}
          <label className="mb-2 flex items-start gap-2 text-[11px] text-[var(--gray)]">
            <input
              type="checkbox"
              checked={confirmo}
              onChange={(e) => setConfirmo(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-red-600"
            />
            <span>Compreendo: aplicar reinicia o backend e uma má edição pode causar dead air.</span>
          </label>
          <button
            type="button"
            onClick={() => {
              setAplicProg(0);
              setAplic("a_correr");
            }}
            disabled={!confirmo || aplic === "a_correr"}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-[#0b3d1a] transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
          >
            <IconCheck className="h-4 w-4" />
            Aplicar (demonstração)
          </button>
        </div>
      </div>
    </div>
  );
}
