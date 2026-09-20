"use client";

// Biblioteca de música por programa. Uma pool por programa (6), cada uma com a
// sua playlist AzuraCast "Música <nome>" que substitui a rotação geral só dentro
// da janela de Lisboa. Lista clicável → drawer com as faixas (recência desc) e o
// botão "Reconstruir agora" (build → deploy). Dados reais via seam _lib/musica.ts.
// A pré-visualização de faixa e o "Reconstruir agora" continuam SIMULADOS: não
// fazem pedidos — mostram estado local (como as páginas Jobs/Live). Segredos/.env
// nunca aparecem aqui. Valores de "em janela / no ar" vêm do seam (relógio de
// Lisboa no servidor) → sem mismatch de hidratação.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardHeader, StatusChip } from "./ui";
import { PoolBar } from "./charts";
import {
  IconClock,
  IconClose,
  IconChevronRight,
  IconCheck,
  IconAlert,
  IconRefresh,
  IconPlay,
  IconJobs,
  IconMusica,
} from "./icons";
import type { MusicaData, Pool, Track, TrackEstado } from "../../_lib/musica";

// Retorno do botão demo "Reconstruir agora" (NÃO persiste; puro e client-safe —
// vive aqui e não no seam _lib/musica.ts, que é server-only por importar
// azuracast-read/next/headers). Aponta para os jobs reais de _lib/jobs.ts; a
// página Jobs mostra a execução real ao ligar.
type ReconstruirResult = {
  jobKey: "music-build" | "music-deploy";
  runId: string;
  nota: string;
};

// Simula o disparo do botão "Reconstruir agora" (build → deploy). NÃO persiste;
// devolve um runId determinístico que aponta para a página Jobs.
function demoReconstruir(slug: string): ReconstruirResult {
  return {
    jobKey: "music-build",
    runId: `music-build-${slug}-demo`,
    nota: "demonstração — dispara music-build → music-deploy (rotação com teto), sem restart",
  };
}

type ChipTone = "ok" | "neutral" | "warn" | "danger" | "live";

const TRACK_TONE: Record<TrackEstado, ChipTone> = {
  normalizado: "ok",
  pendente: "warn",
  falhou: "danger",
};
const TRACK_LABEL: Record<TrackEstado, string> = {
  normalizado: "Normalizado",
  pendente: "Pendente",
  falhou: "Falhou",
};

function byRecencia(a: Track, b: Track) {
  return b.addedAt.localeCompare(a.addedAt);
}

export default function MusicLibrary({ data }: { data: MusicaData }) {
  const [selected, setSelected] = useState<Pool | null>(null);

  return (
    <>
      <Card className="p-4">
        <CardHeader title="Pools por programa" hint="janela vs agora · Lisboa" />
        <ul className="mt-3 space-y-2">
          {data.pools.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className={[
                  "flex w-full flex-col gap-3 rounded-xl border p-3 text-left transition-colors md:flex-row md:items-center",
                  p.noAr
                    ? "border-brand bg-brand/5 ring-1 ring-brand/40"
                    : "border-[var(--line)] bg-[var(--card)] hover:border-[var(--ink)]/20 hover:bg-[var(--bg)]",
                ].join(" ")}
              >
                {/* identidade + chips */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {p.nome} · <span className="text-[var(--gray)]">{p.locutor}</span>
                    </span>
                    {p.noAr ? (
                      <StatusChip tone="live" dot>
                        No ar
                      </StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Fora de janela</StatusChip>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--gray)]">{p.playlist}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--gray)]">
                    <span
                      title={`Alternativas: ${p.generoAlts.join(", ")}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 font-semibold text-[var(--ink)]"
                    >
                      <IconMusica className="h-3 w-3" />
                      {p.genero}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <IconClock className="h-3 w-3" />
                      {p.janela}
                    </span>
                    <span>{p.lufs}</span>
                  </div>
                </div>

                {/* saúde da pool */}
                <div className="md:w-52">
                  <PoolBar label="faixas no ar" value={p.faixas} cap={p.cap} />
                </div>

                <IconChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--gray)] md:block" />
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-start gap-2 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--gray)]">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Cada pool é uma playlist Standard, shuffle e NÃO-interrupt: substitui a rotação geral só na sua janela
          (Lisboa) e cede a vez ao topo da hora e aos segmentos/notícias dos :30. A madrugada (23:00–07:00) é
          coberta pelo deployer da programação.
        </p>
      </Card>

      {selected ? <PoolDrawer pool={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

// ── Drawer da pool (faixas + reconstruir) ────────────────────────────────────
function PoolDrawer({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tracks = [...pool.tracks].sort(byRecencia);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="animate-panel-up flex h-dvh w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* cabeçalho */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--ink)]">
              <IconMusica className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--ink)]">{pool.nome}</div>
              <div className="truncate font-mono text-[11px] text-[var(--gray)]">{pool.playlist}</div>
            </div>
            {pool.noAr ? (
              <StatusChip tone="live" dot>
                No ar
              </StatusChip>
            ) : null}
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
          {/* metadados da pool */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={`Alternativas: ${pool.generoAlts.join(", ")}`}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-[#0b3d1a]"
            >
              {pool.genero}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--gray)]">
              <IconClock className="h-3 w-3" />
              {pool.janela}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--gray)]">
            Alternativas de género: {pool.generoAlts.join(" · ")}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Meta label="Faixas no ar" valor={`${pool.faixas} / ${pool.cap}`} nota="teto (poolCap)" />
            <Meta label="Novas por refresh" valor={`+${pool.poolSize}`} nota="poolSize" />
            <Meta label="Duração alvo" valor={pool.durLabel} nota="min–max" />
            <Meta label="Loudness" valor={pool.lufs} nota="MP3 192k" />
          </dl>
          <p className="mt-2 text-[11px] tabular-nums text-[var(--gray)]">
            Última atualização: {pool.ultimaAtualizacao} (Lisboa)
          </p>

          {/* faixas */}
          <div className="mb-2 mt-5 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">Faixas</div>
            <span className="text-[11px] text-[var(--gray)]">{tracks.length} recentes · por recência</span>
          </div>
          <ul className="space-y-1.5">
            {tracks.map((t) => (
              <TrackRow key={t.videoId} track={t} />
            ))}
          </ul>
        </div>

        {/* rodapé — reconstruir */}
        <div className="border-t border-[var(--line)] px-4 py-3">
          <Reconstruir pool={pool} />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, valor, nota }: { label: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-[var(--gray)]">{label}</dt>
      <dd className="font-[family-name:var(--font-logo)] text-base font-semibold text-[var(--ink)]">{valor}</dd>
      <div className="text-[10px] text-[var(--gray)]">{nota}</div>
    </div>
  );
}

// ── Linha de faixa (com pré-visualização simulada) ───────────────────────────
function TrackRow({ track }: { track: Track }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setProg((v) => {
        if (v >= 100) {
          setPlaying(false);
          return 0;
        }
        return v + 2;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <li className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            setProg(0);
            setPlaying((v) => !v);
          }}
          aria-label={playing ? "Pausar (demonstração)" : "Reproduzir (demonstração)"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white transition-transform hover:scale-105"
        >
          {playing ? <span className="text-[11px]">❚❚</span> : <IconPlay className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--ink)]">
            {track.artista} — {track.titulo}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--gray)]">
            <span className="tabular-nums">{track.duracaoLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="rounded bg-[var(--bg)] px-1 font-semibold text-[var(--ink)]">{track.lufs}</span>
            <span aria-hidden="true">·</span>
            <span>{track.fonte}</span>
          </div>
        </div>
        <div className="shrink-0">
          <StatusChip tone={TRACK_TONE[track.estado]}>{TRACK_LABEL[track.estado]}</StatusChip>
        </div>
      </div>

      <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--gray)]">{track.path}</div>

      {playing ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
            style={{ width: `${prog}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}

// ── Reconstruir agora (confirm → enfileirado) ────────────────────────────────
function Reconstruir({ pool }: { pool: Pool }) {
  type Fase = "plano" | "confirmar" | "a_enfileirar" | "enfileirado";
  const [fase, setFase] = useState<Fase>("plano");
  const [prog, setProg] = useState(0);
  const result = demoReconstruir(pool.slug);

  useEffect(() => {
    if (fase !== "a_enfileirar") return;
    const id = setInterval(() => {
      setProg((v) => {
        if (v >= 100) {
          clearInterval(id);
          setFase("enfileirado");
          return 100;
        }
        return v + 10;
      });
    }, 90);
    return () => clearInterval(id);
  }, [fase]);

  if (fase === "enfileirado") {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-3 text-xs text-[#0b3d1a]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Job enfileirado (demonstração)</div>
            <div className="mt-0.5 font-mono text-[11px] opacity-80">
              {result.jobKey} · {result.runId}
            </div>
          </div>
        </div>
        <Link
          href="/gestao/jobs"
          className="flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <IconJobs className="h-4 w-4" />
          Ver na página Jobs
        </Link>
        <p className="text-[11px] text-[var(--gray)]">
          Ao ligar, isto dispara o build/deploy real e a execução aparece em Jobs com o log ao vivo.
        </p>
      </div>
    );
  }

  if (fase === "a_enfileirar") {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--ink)]">A enfileirar…</div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-100 ease-linear"
            style={{ width: `${prog}%` }}
          />
        </div>
      </div>
    );
  }

  if (fase === "confirmar") {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{result.nota}</div>
            <div className="mt-1">
              As faixas novas sobem in-place; ao passar o teto ({pool.cap}), o deploy retira as mais antigas sob{" "}
              <span className="font-mono">musica/{pool.slug}/</span> (rotação em cascata, sem restart).
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFase("plano")}
            className="flex-1 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bg)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              setProg(0);
              setFase("a_enfileirar");
            }}
            className="flex-1 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Confirmar e enfileirar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setFase("confirmar")}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-[#0b3d1a] transition-transform hover:scale-[1.01]"
      >
        <IconRefresh className="h-4 w-4" />
        Reconstruir agora (job assíncrono)
      </button>
      <p className="flex items-start gap-2 text-[11px] text-[var(--gray)]">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Demonstração: dispara <span className="font-mono">music-build → music-deploy</span>. Novas faixas sobem
        in-place; ao passar o teto, as mais antigas saem (rotação, sem restart).
      </p>
    </div>
  );
}
