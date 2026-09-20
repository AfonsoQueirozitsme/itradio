"use client";

// Grelha de Locutores — as vozes VIRTUAIS da estação (TTS clonadas ElevenLabs,
// não humanos). Mostra cada voz (identidade, voice id mascarado, programa(s),
// janela em Lisboa) + a quota apertada do plano Starter. Ao clicar num card abre
// um drawer com sample SIMULADO (play/pause + barra), bloco "Voz" (id mascarado,
// envKey, modelo, settings, output, loudness) e upload de foto simulado. Dados
// mock via seam _lib/locutores.ts.
//
// Nada aqui é real: o sample não toca áudio (barra animada a partir de sample.dur),
// e todas as ações (regenerar, carregar foto, novo locutor) são DEMONSTRAÇÃO —
// como nas páginas Jobs/Live. Voice IDs NUNCA aparecem por inteiro. A "vida" é
// simulada no cliente a partir de constantes do seam (sem mismatch de hidratação).

import { useEffect, useState } from "react";
import { StatusChip } from "./ui";
import { IconClock, IconClose, IconPlay, IconRefresh, IconAlert, IconCheck, IconBell } from "./icons";
import type { Locutor, LocutorEstado, LocutoresData, QuotaEL } from "../../_lib/locutores";

type ChipTone = "ok" | "neutral" | "warn" | "danger" | "live";

const ESTADO_TONE: Record<LocutorEstado, ChipTone> = {
  no_ar: "live",
  ativo: "ok",
  em_pausa: "warn",
  rascunho: "neutral",
};
const ESTADO_LABEL: Record<LocutorEstado, string> = {
  no_ar: "No ar",
  ativo: "Ativo",
  em_pausa: "Em pausa",
  rascunho: "Rascunho",
};

// agrupa milhares com espaço fino (determinístico → sem depender de locale)
function fmtNum(n: number) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function fmtDur(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
// turbo/flash = 0.5 créd/car; restantes modelos = 1×
function credPorCar(modelo: string) {
  return /turbo|flash/i.test(modelo) ? 0.5 : 1;
}
function modeloCusto(modelo: string) {
  return credPorCar(modelo) === 0.5 ? "0.5 créd/car" : "1× créd/car";
}

export default function LocutoresGrid({ data }: { data: LocutoresData }) {
  const [selected, setSelected] = useState<Locutor | null>(null);
  const [novoNota, setNovoNota] = useState(false);

  const noAr = data.locutores.filter((l) => l.estado === "no_ar").length;
  const noticias = data.locutores.filter((l) => l.tipo === "noticias").length;

  return (
    <div className="space-y-4">
      {/* 1. Faixa de quota ElevenLabs (topo, subtil) */}
      <QuotaStrip quota={data.quota} />

      {/* Cabeçalho da grelha + ação (simulada) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--gray)]">
          <span className="font-medium text-[var(--ink)]">{data.locutores.length} vozes</span> · {noAr} no ar ·{" "}
          {noticias} em co-locução de notícias
        </div>
        <button
          type="button"
          onClick={() => setNovoNota((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          + Novo locutor
        </button>
      </div>

      {novoNota ? (
        <p className="flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Demonstração: criar uma voz nova pede um voice ID clonado (guardado no{" "}
          <span className="font-mono">.env</span>, nunca aqui) e consome o plafond ElevenLabs. Ao ligar, isto abre o
          formulário de clonagem com validação.
        </p>
      ) : null}

      {/* 2. Grelha de cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.locutores.map((l) => (
          <LocutorCard key={l.slug} l={l} onOpen={() => setSelected(l)} />
        ))}
      </div>

      {/* 3. Drawer de detalhe */}
      {selected ? <LocutorDrawer l={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

// ── Faixa de quota ──────────────────────────────────────────────────────────
function QuotaStrip({ quota }: { quota: QuotaEL }) {
  const usadoPct = Math.max(0, Math.min(100, Math.round((quota.usados / quota.limite) * 100)));
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusChip tone="warn" dot>
          Quota ElevenLabs apertada · plano {quota.plano}
        </StatusChip>
        <span className="font-[family-name:var(--font-logo)] text-sm font-semibold tabular-nums text-[var(--ink)]">
          {fmtNum(quota.usados)} / {fmtNum(quota.limite)} créd.
        </span>
        <span className="text-xs text-[var(--gray)]">
          · <span className="font-semibold text-amber-600">{quota.restantePct}% restante</span> (
          {fmtNum(quota.restantes)} créd.)
        </span>
      </div>
      {/* barrinha fina: consumido vs limite */}
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${usadoPct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-[var(--gray)]">
        Cada geração de notícias consome ~350 créd. (turbo 0.5×/car); gerar samples/vozes novas gasta o mesmo
        plafond.
      </p>
    </div>
  );
}

// ── Avatar de iniciais (sem foto real) ──────────────────────────────────────
function Avatar({ iniciais, size = "md", live = false }: { iniciais: string; size?: "md" | "lg"; live?: boolean }) {
  const dim = size === "lg" ? "h-14 w-14 text-lg" : "h-11 w-11 text-sm";
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`inline-flex items-center justify-center rounded-full bg-[var(--ink)] font-[family-name:var(--font-logo)] font-semibold text-white ${dim} ${
          live ? "ring-2 ring-brand ring-offset-2 ring-offset-[var(--card)]" : ""
        }`}
      >
        {iniciais}
      </span>
      {live ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[var(--card)] bg-brand" />
        </span>
      ) : null}
    </span>
  );
}

// ── Card de locutor ──────────────────────────────────────────────────────────
function LocutorCard({ l, onOpen }: { l: Locutor; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 text-left transition-colors hover:border-[var(--ink)]/20 hover:bg-[var(--bg)]/40"
    >
      <div className="flex items-start gap-3">
        <Avatar iniciais={l.iniciais} live={l.estado === "no_ar"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-[family-name:var(--font-logo)] text-base font-semibold text-[var(--ink)]">
              {l.nome}
            </h3>
            <StatusChip tone={ESTADO_TONE[l.estado]} dot>
              {ESTADO_LABEL[l.estado]}
            </StatusChip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--gray)]">{l.voz}</span>
            <span className="rounded-full bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gray)]">
              voz
            </span>
          </div>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-[var(--gray)]">{l.bio}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {l.tipo === "noticias" ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            Notícias LIVE
          </span>
        ) : null}
        {l.programas.map((p) => (
          <span
            key={p}
            className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-[#0b3d1a]"
          >
            {p}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--line)] pt-3 text-[11px] text-[var(--gray)]">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <IconClock className="h-3.5 w-3.5" />
          {l.janela}
        </span>
        <span className="tabular-nums">≈{l.horasNoArDia.toFixed(1)} h/dia</span>
      </div>
    </button>
  );
}

// ── Sample simulado (play/pause + barra, sem áudio real) ────────────────────
function SamplePlayer({ l }: { l: Locutor }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0); // 0..100
  const [regNota, setRegNota] = useState(false);

  // avança de forma a que a reprodução completa dure ~sample.dur segundos
  useEffect(() => {
    if (!playing) return;
    const step = 100 / (l.sample.dur * 10); // tick a cada 100ms
    const id = setInterval(() => {
      setProg((v) => {
        if (v >= 100) {
          setPlaying(false);
          return 100;
        }
        return Math.min(100, v + step);
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, l.sample.dur]);

  const elapsed = (prog / 100) * l.sample.dur;
  const custoSample = Math.round(l.sample.texto.length * credPorCar(l.modelo));

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">Sample de voz</span>
        <span className="rounded-full bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--gray)]">
          sample simulado
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing && prog >= 100) setProg(0);
            setPlaying((v) => !v);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white transition-transform hover:scale-105"
          aria-label={playing ? "Pausar" : "Reproduzir"}
        >
          {playing ? <span className="text-sm">❚❚</span> : <IconPlay className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
              style={{ width: `${prog}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-[var(--gray)]">
            <span>{fmtDur(elapsed)}</span>
            <span>{fmtDur(l.sample.dur)}</span>
          </div>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-[var(--card)] p-2.5 text-sm italic leading-relaxed text-[var(--ink)]">
        “{l.sample.texto}”
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRegNota(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)]/30 hover:bg-[var(--bg)]"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          Regenerar sample
        </button>
        <span className="text-[11px] text-[var(--gray)]">
          {l.sample.texto.length} car. · ≈{custoSample} créd.
        </span>
      </div>
      {regNota ? (
        <p className="mt-2 flex items-start gap-2 text-[11px] text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Demonstração: nada é gerado. Ao ligar, chama o TTS ({l.modelo}) e consome ≈{custoSample} créd. do plafond
          ElevenLabs.
        </p>
      ) : null}
    </div>
  );
}

// ── Drawer de detalhe ─────────────────────────────────────────────────────────
function LocutorDrawer({ l, onClose }: { l: Locutor; onClose: () => void }) {
  const [fotoNota, setFotoNota] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = l.settings;
  const vozRows: { label: string; valor: string; hint?: string }[] = [
    { label: "Voice ID", valor: l.voiceIdMasked, hint: "mascarado — nunca exposto" },
    {
      label: "Env",
      valor: l.envKey,
      hint: l.tipo === "noticias" ? "no .env (co-locução ao vivo)" : "binding proposto (voz é clip pré-gerado)",
    },
    { label: "Modelo", valor: l.modelo, hint: modeloCusto(l.modelo) },
    {
      label: "Settings",
      valor: `stability ${s.stability} · similarity ${s.similarity} · style ${s.style} · speaker boost ${
        s.speakerBoost ? "on" : "off"
      }`,
    },
    { label: "Output", valor: l.outputFormat },
    { label: "Loudness", valor: l.loudness, hint: "bake I=-16 · TP=-1.5 · LRA=11" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* cabeçalho */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusChip tone={ESTADO_TONE[l.estado]} dot>
              {ESTADO_LABEL[l.estado]}
            </StatusChip>
            <span className="text-xs text-[var(--gray)]">{l.voz}</span>
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
          <div className="flex items-center gap-3">
            <Avatar iniciais={l.iniciais} size="lg" live={l.estado === "no_ar"} />
            <div className="min-w-0">
              <h3 className="font-[family-name:var(--font-logo)] text-xl font-semibold text-[var(--ink)]">
                {l.nome}
              </h3>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--gray)]">
                <IconClock className="h-3.5 w-3.5" />
                <span className="tabular-nums">{l.janela}</span>
                <span>· ≈{l.horasNoArDia.toFixed(1)} h/dia</span>
              </div>
            </div>
          </div>

          {l.tipo === "noticias" ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">
              <IconBell className="mt-0.5 h-4 w-4 shrink-0" />
              <span>co-locução · Notícias LIVE (gerada ao vivo, 3/3h)</span>
            </div>
          ) : null}

          <p className="mt-3 text-sm leading-relaxed text-[var(--ink)]">{l.bio}</p>

          {/* sample simulado */}
          <div className="mt-4">
            <SamplePlayer l={l} />
          </div>

          {/* bloco "Voz" */}
          <Section title="Voz">
            <dl className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--bg)]/40">
              {vozRows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 px-3 py-2">
                  <dt className="shrink-0 text-xs text-[var(--gray)]">{r.label}</dt>
                  <dd className="min-w-0 text-right">
                    <div className="break-words font-mono text-xs font-medium text-[var(--ink)]">{r.valor}</div>
                    {r.hint ? <div className="text-[10px] text-[var(--gray)]">{r.hint}</div> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* programas atribuídos */}
          <Section title={l.tipo === "noticias" ? "Atribuição" : "Programas atribuídos"}>
            <ul className="space-y-1.5">
              {l.programas.map((p) => (
                <li
                  key={p}
                  className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2"
                >
                  <span className="text-sm font-medium text-[var(--ink)]">{p}</span>
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums text-[var(--gray)]">
                    <IconClock className="h-3.5 w-3.5" />
                    {l.janela}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {/* upload de foto (simulado) */}
          <Section title="Foto">
            <button
              type="button"
              onClick={() => setFotoNota(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
            >
              Carregar foto
            </button>
            {fotoNota ? (
              <p className="mt-2 flex items-start gap-2 text-[11px] text-[#0b3d1a]">
                <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Ficheiro selecionado (demonstração — sem upload). As fotos são guardadas fora do git (via sharp,
                quando ligado).
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-[var(--gray)]">
                Sem foto. As fotos são guardadas fora do git (via sharp, quando ligado).
              </p>
            )}
          </Section>
        </div>

        {/* rodapé — nota de demonstração */}
        <div className="border-t border-[var(--line)] px-4 py-3">
          <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Demonstração: sample e ações são simulados; o voice ID nunca aparece por inteiro. Ao ligar, os dados vêm
            de news-live.mjs + programs.mjs e a quota de <span className="font-mono">/v1/user/subscription</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">{title}</div>
      {children}
    </div>
  );
}
