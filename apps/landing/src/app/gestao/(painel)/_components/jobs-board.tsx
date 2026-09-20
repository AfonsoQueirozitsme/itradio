"use client";

// Quadro de Jobs. Calendário semanal das execuções agendadas + registo de jobs
// com "Refazer", detalhe por execução (estado-dependente: pedido / ao vivo /
// resultados) e editor manual de scripts. Dados mock via seam _lib/jobs.ts.
// Todas as ações (refazer, validar, aplicar) são SIMULADAS até ligarmos ao
// backend; nada é escrito em disco nem disparado no ar a partir daqui.

import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, StatusChip } from "./ui";
import {
  IconRefresh,
  IconCode,
  IconCheck,
  IconAlert,
  IconClose,
  IconChevronRight,
  IconClock,
} from "./icons";
import type {
  JobsData,
  JobDef,
  JobRun,
  JobState,
  JobRisk,
  Occurrence,
  EditableScript,
  RunStep,
} from "../../_lib/jobs";

type ChipTone = "ok" | "neutral" | "warn" | "danger" | "live";

const STATE_TONE: Record<JobState, ChipTone> = {
  concluido: "ok",
  a_correr: "live",
  agendado: "neutral",
  falhou: "danger",
};
const STATE_LABEL: Record<JobState, string> = {
  concluido: "Concluído",
  a_correr: "A correr",
  agendado: "Agendado",
  falhou: "Falhou",
};
const RISK_LABEL: Record<JobRisk, string> = {
  baixo: "Risco baixo",
  medio: "Risco médio",
  alto: "Risco alto",
};
const RISK_CLASS: Record<JobRisk, string> = {
  baixo: "bg-brand/10 text-[#0b3d1a]",
  medio: "bg-amber-100 text-amber-700",
  alto: "bg-red-100 text-red-700",
};
const TRIGGER_LABEL: Record<JobDef["trigger"], string> = {
  launchd: "launchd (auto)",
  systemd: "systemd (auto)",
  github: "GitHub Actions",
  manual: "manual",
  "sub-job": "sub-job",
};

// resolve uma ocorrência do calendário para uma execução (real ou sintetizada)
function runForOccurrence(occ: Occurrence, runs: JobRun[], jobs: JobDef[]): JobRun {
  const real = runs.find((r) => r.id === occ.id);
  if (real) return real;
  const job = jobs.find((j) => j.key === occ.jobKey);
  return {
    id: occ.id,
    jobKey: occ.jobKey,
    nome: `${occ.nome} · ${occ.hora}`,
    estado: occ.estado,
    gatilho: job ? TRIGGER_LABEL[job.trigger] : "—",
    inicio: occ.estado === "agendado" ? `${occ.hora} (previsto)` : occ.hora,
    fim: null,
    duracao: null,
    pedido: job
      ? [
          { label: "Job", valor: job.name },
          { label: "Agendamento", valor: job.agendamento },
          { label: "Script", valor: job.scriptPath },
        ]
      : [],
    resultado:
      occ.estado === "concluido"
        ? [{ label: "Resultado", valor: job?.ultimoResultado ?? "concluído" }]
        : null,
    passos: [],
    log: [`(sem registo detalhado — ${STATE_LABEL[occ.estado].toLowerCase()})`],
  };
}

function occChipClass(estado: JobState): string {
  switch (estado) {
    case "concluido":
      return "border-transparent bg-brand/10 text-[#0b3d1a]";
    case "a_correr":
      return "border-brand/40 bg-brand/15 text-[#0b3d1a] ring-1 ring-brand/40";
    case "falhou":
      return "border-transparent bg-red-100 text-red-700";
    default:
      return "border-[var(--line)] bg-[var(--bg)] text-[var(--gray)]";
  }
}

export default function JobsBoard({ data }: { data: JobsData }) {
  const [run, setRun] = useState<JobRun | null>(null);
  const [rerun, setRerun] = useState<JobDef | null>(null);
  const [script, setScript] = useState<EditableScript | null>(null);

  const resumo = data.resumo;

  return (
    <div className="space-y-4">
      {/* Resumo do dia */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat label="Agendados hoje" value={resumo.agendadosHoje} tone="neutral" />
        <SummaryStat label="Concluídos" value={resumo.concluidos} tone="ok" />
        <SummaryStat label="A correr" value={resumo.aCorrer} tone="live" dot />
        <SummaryStat label="Falhas" value={resumo.falhas} tone={resumo.falhas ? "danger" : "ok"} />
      </div>

      {/* Calendário da semana */}
      <Card className="p-4">
        <CardHeader title="Semana" hint="jobs agendados · horas de Lisboa" />
        <div className="mt-3 overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7 gap-2">
            {data.week.map((d) => (
              <div key={d.dia} className="min-w-0">
                <div
                  className={
                    d.hoje
                      ? "mb-2 rounded-lg bg-[var(--ink)] px-2 py-1.5 text-center text-white"
                      : "mb-2 rounded-lg px-2 py-1.5 text-center"
                  }
                >
                  <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                    {d.weekday}
                  </div>
                  <div className="font-[family-name:var(--font-logo)] text-lg font-semibold leading-none tabular-nums">
                    {d.dia}
                  </div>
                </div>
                <div className="space-y-1">
                  {d.ocorrencias.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setRun(runForOccurrence(o, data.runs, data.jobs))}
                      className={`flex w-full items-center gap-1 rounded-lg border px-1.5 py-1 text-left transition-transform hover:scale-[1.02] ${occChipClass(
                        o.estado
                      )}`}
                    >
                      {o.estado === "a_correr" ? (
                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                        </span>
                      ) : (
                        <span className="shrink-0 font-[family-name:var(--font-logo)] text-[10px] font-semibold tabular-nums opacity-80">
                          {o.hora}
                        </span>
                      )}
                      <span className="truncate text-[11px] font-medium">{o.nome}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Legend />
      </Card>

      {/* Registo de jobs */}
      <Card className="p-4">
        <CardHeader title="Jobs" hint="agendadores + manuais" />
        <div className="mt-3 space-y-2">
          {data.jobs.map((j) => (
            <div
              key={j.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">{j.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${RISK_CLASS[j.risk]}`}>
                    {RISK_LABEL[j.risk]}
                  </span>
                  {j.destrutivo ? (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                      destrutivo
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 line-clamp-1 text-xs text-[var(--gray)]">{j.descricao}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--gray)]">
                  <span className="inline-flex items-center gap-1">
                    <IconClock className="h-3 w-3" />
                    {j.agendamento}
                  </span>
                  <span className="font-mono opacity-80">{j.scriptPath}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {j.ultimoEstado ? (
                  <div className="text-right">
                    <StatusChip tone={STATE_TONE[j.ultimoEstado]} dot={j.ultimoEstado === "a_correr"}>
                      {STATE_LABEL[j.ultimoEstado]}
                    </StatusChip>
                    {j.ultimaExec ? (
                      <div className="mt-0.5 text-[10px] tabular-nums text-[var(--gray)]">{j.ultimaExec}</div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRerun(j)}
                  disabled={!j.rerunnable}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)]/30 hover:bg-[var(--bg)] disabled:opacity-40"
                >
                  <IconRefresh className="h-3.5 w-3.5" />
                  Refazer
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Execuções recentes */}
      <Card className="p-4">
        <CardHeader title="Execuções recentes" hint="clica para ver o detalhe" />
        <ul className="mt-3 space-y-1.5">
          {data.runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setRun(r)}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-2.5 text-left transition-colors hover:bg-[var(--bg)]"
              >
                <StatusChip tone={STATE_TONE[r.estado]} dot={r.estado === "a_correr"}>
                  {STATE_LABEL[r.estado]}
                </StatusChip>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">{r.nome}</div>
                  <div className="text-[11px] tabular-nums text-[var(--gray)]">
                    {r.inicio}
                    {r.duracao ? ` · ${r.duracao}` : ""} · {r.gatilho}
                  </div>
                </div>
                <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--gray)]" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Scripts editáveis */}
      <Card className="p-4">
        <CardHeader title="Scripts & configuração" hint="edição manual (simulada)" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.scripts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScript(s)}
              className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-left transition-colors hover:bg-[var(--bg)]"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--ink)]">
                <IconCode className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">{s.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${RISK_CLASS[s.risk]}`}>
                    {RISK_LABEL[s.risk]}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--gray)]">{s.path}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3 text-xs text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Segredos (<span className="font-mono">.env</span>) nunca aparecem aqui nem são editáveis. A edição é
          uma demonstração — ao ligar, guardar valida e escreve via um endpoint com backup e permissões.
        </p>
      </Card>

      {run ? <RunDrawer run={run} onClose={() => setRun(null)} /> : null}
      {rerun ? <RerunDrawer job={rerun} onClose={() => setRerun(null)} /> : null}
      {script ? <ScriptDrawer script={script} onClose={() => setScript(null)} /> : null}
    </div>
  );
}

// ── Resumo ──────────────────────────────────────────────────────────────────
function SummaryStat({
  label,
  value,
  tone,
  dot,
}: {
  label: string;
  value: number;
  tone: ChipTone;
  dot?: boolean;
}) {
  const color =
    tone === "danger"
      ? "text-red-600"
      : tone === "live"
        ? "text-[#0b3d1a]"
        : tone === "ok"
          ? "text-[#0b3d1a]"
          : "text-[var(--ink)]";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-[var(--gray)]">
        {dot ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
        ) : null}
        {label}
      </div>
      <div className={`mt-1.5 font-[family-name:var(--font-logo)] text-[30px] font-semibold leading-none tabular-nums ${color}`}>
        {value}
      </div>
    </Card>
  );
}

function Legend() {
  const items: { estado: JobState }[] = [
    { estado: "concluido" },
    { estado: "a_correr" },
    { estado: "agendado" },
    { estado: "falhou" },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--gray)]">
      {items.map((i) => (
        <span key={i.estado} className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              i.estado === "concluido"
                ? "bg-brand"
                : i.estado === "a_correr"
                  ? "bg-brand ring-2 ring-brand/40"
                  : i.estado === "falhou"
                    ? "bg-red-400"
                    : "bg-[var(--line)]"
            }`}
          />
          {STATE_LABEL[i.estado]}
        </span>
      ))}
    </div>
  );
}

// ── Base do drawer (slide-over à direita) ───────────────────────────────────
function Drawer({
  children,
  onClose,
  head,
}: {
  children: React.ReactNode;
  onClose: () => void;
  head: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          {head}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--gray)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>
      </div>
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

function StepRow({ s }: { s: RunStep }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {s.estado === "concluido" ? (
          <IconCheck className="h-4 w-4 text-[#0b3d1a]" />
        ) : s.estado === "falhou" ? (
          <IconAlert className="h-4 w-4 text-red-500" />
        ) : s.estado === "a_correr" ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-[var(--line)]" />
        )}
      </span>
      <div className="min-w-0">
        <div
          className={`text-sm ${
            s.estado === "pendente" ? "text-[var(--gray)]" : "font-medium text-[var(--ink)]"
          }`}
        >
          {s.label}
        </div>
        {s.detalhe ? <div className="text-[11px] text-[var(--gray)]">{s.detalhe}</div> : null}
      </div>
    </li>
  );
}

function LogBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-auto rounded-xl border border-[var(--line)] bg-[#0a0a0a] p-3 font-mono text-[12px] leading-relaxed text-[#c9f7d2]">
      {lines.join("\n")}
    </pre>
  );
}

// ── Detalhe de execução (estado-dependente) ─────────────────────────────────
function RunDrawer({ run, onClose }: { run: JobRun; onClose: () => void }) {
  const aCorrer = run.estado === "a_correr";
  const [elapsed, setElapsed] = useState(0);

  // cronómetro ao vivo enquanto a execução decorre (só no cliente)
  useEffect(() => {
    if (!aCorrer) return;
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [aCorrer]);

  return (
    <Drawer
      onClose={onClose}
      head={
        <div className="flex items-center gap-2">
          <StatusChip tone={STATE_TONE[run.estado]} dot={aCorrer}>
            {STATE_LABEL[run.estado]}
          </StatusChip>
          <span className="text-xs text-[var(--gray)]">{run.inicio}</span>
        </div>
      }
    >
      <h3 className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">{run.nome}</h3>
      <p className="mt-0.5 text-xs text-[var(--gray)]">
        Gatilho: {run.gatilho}
        {run.duracao ? ` · duração ${run.duracao}` : ""}
        {aCorrer ? ` · a decorrer há ${elapsed}s` : ""}
      </p>

      {/* AGENDADO → detalhes do pedido (o que vai usar) */}
      {run.estado === "agendado" ? (
        <Section title="Pedido (o que vai correr)">
          <KeyVals rows={run.pedido} />
        </Section>
      ) : null}

      {/* A CORRER → passos ao vivo + log */}
      {aCorrer ? (
        <>
          <Section title="Ao vivo">
            <ul className="space-y-2.5">
              {run.passos.map((s, i) => (
                <StepRow key={i} s={s} />
              ))}
            </ul>
          </Section>
          <Section title="Log (a fluir)">
            <LogBlock lines={run.log} />
          </Section>
        </>
      ) : null}

      {/* CONCLUÍDO / FALHOU → resultados + passos + log */}
      {(run.estado === "concluido" || run.estado === "falhou") ? (
        <>
          {run.estado === "falhou" ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              A execução terminou com erros. Vê os passos e o log; podes voltar a correr a partir do registo.
            </div>
          ) : null}
          {run.resultado ? (
            <Section title="Resultados">
              <KeyVals rows={run.resultado} />
            </Section>
          ) : null}
          {run.passos.length ? (
            <Section title="Passos">
              <ul className="space-y-2.5">
                {run.passos.map((s, i) => (
                  <StepRow key={i} s={s} />
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title="Log">
            <LogBlock lines={run.log} />
          </Section>
        </>
      ) : null}
    </Drawer>
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

// ── Refazer job (dry-run → aplicar, com gate de risco) ──────────────────────
function RerunDrawer({ job, onClose }: { job: JobDef; onClose: () => void }) {
  type Fase = "plano" | "validado" | "a_correr" | "feito";
  const [fase, setFase] = useState<Fase>("plano");
  const [confirmo, setConfirmo] = useState(false);
  const [prog, setProg] = useState(0);
  const precisaConfirmar = job.destrutivo || job.risk === "alto";

  const plano = [
    `[dry-run] ${job.name}`,
    ` · script: ${job.scriptPath}`,
    ` · gatilho: ${job.agendamento} (${TRIGGER_LABEL[job.trigger]})`,
    job.destrutivo
      ? " · ATENÇÃO: operação com rotação/remoção — afeta a emissão ao vivo"
      : " · sem efeitos destrutivos",
    " · alvo: AzuraCast localhost · in-place",
    "Concluído dry-run — nada foi alterado.",
  ];

  useEffect(() => {
    if (fase !== "a_correr") return;
    const id = setInterval(() => {
      setProg((v) => {
        if (v >= 100) {
          clearInterval(id);
          setFase("feito");
          return 100;
        }
        return v + 5;
      });
    }, 120);
    return () => clearInterval(id);
  }, [fase]);

  return (
    <Drawer
      onClose={onClose}
      head={
        <div className="flex items-center gap-2">
          <IconRefresh className="h-4 w-4 text-[var(--ink)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Refazer</span>
        </div>
      }
    >
      <h3 className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">{job.name}</h3>
      <p className="mt-0.5 text-xs text-[var(--gray)]">{job.descricao}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_CLASS[job.risk]}`}>
          {RISK_LABEL[job.risk]}
        </span>
        {job.destrutivo ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
            destrutivo
          </span>
        ) : null}
      </div>

      <Section title="Plano">
        <LogBlock lines={plano} />
      </Section>

      {fase === "validado" ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3 text-xs text-[#0b3d1a]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Dry-run validado. Nada foi alterado. Podes aplicar para correr a sério.
        </div>
      ) : null}

      {fase === "a_correr" ? (
        <Section title="A correr (simulação)">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
              style={{ width: `${prog}%` }}
            />
          </div>
        </Section>
      ) : null}

      {fase === "feito" ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3 text-xs text-[#0b3d1a]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Execução simulada concluída. Ao ligar, isto dispara o script real e transmite o log ao vivo.
        </div>
      ) : null}

      {precisaConfirmar && (fase === "plano" || fase === "validado") ? (
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <input
            type="checkbox"
            checked={confirmo}
            onChange={(e) => setConfirmo(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-red-600"
          />
          <span>
            Compreendo o risco: este job {job.destrutivo ? "remove faixas em rotação e " : ""}afeta a emissão ao
            vivo. Confirmo que quero refazer.
          </span>
        </label>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setFase("validado")}
          disabled={fase === "a_correr"}
          className="flex-1 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bg)] disabled:opacity-40"
        >
          Validar (dry-run)
        </button>
        <button
          type="button"
          onClick={() => {
            setProg(0);
            setFase("a_correr");
          }}
          disabled={fase === "a_correr" || (precisaConfirmar && !confirmo)}
          className="flex-1 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Refazer agora
        </button>
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] text-[var(--gray)]">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Demonstração: nada é disparado no ar. Ao ligar, "Refazer agora" chama o script via um endpoint com
        permissões e regista a execução aqui.
      </p>
    </Drawer>
  );
}

// ── Editor de script (validar → aplicar, com gate de risco) ─────────────────
function ScriptDrawer({ script, onClose }: { script: EditableScript; onClose: () => void }) {
  const [texto, setTexto] = useState(script.conteudo);
  const [confirmo, setConfirmo] = useState(false);
  const [estado, setEstado] = useState<"idle" | "validado" | "aplicado">("idle");
  const original = useRef(script.conteudo);
  const sujo = texto !== original.current;
  const precisaConfirmar = script.risk === "alto";

  return (
    <Drawer
      onClose={onClose}
      head={
        <div className="flex items-center gap-2">
          <IconCode className="h-4 w-4 text-[var(--ink)]" />
          <span className="text-sm font-semibold text-[var(--ink)]">Editar</span>
        </div>
      }
    >
      <h3 className="font-[family-name:var(--font-logo)] text-lg font-semibold text-[var(--ink)]">{script.name}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--gray)]">{script.path}</span>
        <span className="rounded-full bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--gray)]">
          {script.formato}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${RISK_CLASS[script.risk]}`}>
          {RISK_LABEL[script.risk]}
        </span>
      </div>

      <div
        className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs ${
          script.risk === "alto"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-[var(--line)] bg-[var(--bg)]/40 text-[var(--gray)]"
        }`}
      >
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {script.nota}
      </div>

      <Section title="Conteúdo">
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setEstado("idle");
          }}
          spellCheck={false}
          rows={14}
          className="w-full resize-y rounded-xl border border-[var(--line)] bg-[#0a0a0a] p-3 font-mono text-[12px] leading-relaxed text-[#c9f7d2] outline-none focus:border-brand/50"
        />
      </Section>

      {estado === "validado" ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3 text-xs text-[#0b3d1a]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Validação (dry-run) OK — sintaxe {script.formato} coerente. Nada foi escrito.
        </div>
      ) : null}
      {estado === "aplicado" ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3 text-xs text-[#0b3d1a]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Aplicado (simulação). Ao ligar, isto grava com backup do ficheiro anterior e regista quem alterou.
        </div>
      ) : null}

      {precisaConfirmar && sujo && estado !== "aplicado" ? (
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <input
            type="checkbox"
            checked={confirmo}
            onChange={(e) => setConfirmo(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-red-600"
          />
          <span>Compreendo o risco: uma edição inválida pode partir a emissão no próximo ciclo/restart.</span>
        </label>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setEstado("validado")}
          disabled={!sujo}
          className="flex-1 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bg)] disabled:opacity-40"
        >
          Validar (dry-run)
        </button>
        <button
          type="button"
          onClick={() => setEstado("aplicado")}
          disabled={!sujo || (precisaConfirmar && !confirmo)}
          className="flex-1 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Aplicar
        </button>
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] text-[var(--gray)]">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Demonstração: as alterações não são gravadas em disco. Segredos (<span className="font-mono">.env</span>)
        nunca são mostrados nem editáveis aqui.
      </p>
    </Drawer>
  );
}
