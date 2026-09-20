// Helpers PUROS do alinhamento LIVE — partilhados entre a consola Live
// (live-console.tsx) e a barra "Em direto" global do shell (app-shell.tsx).
// Sem React, sem estado: só cálculo. As horas de cada item são derivadas da
// ordem + durações a partir do início do bloco; `nowSec` (segundos decorridos
// no bloco) determina o que já foi ao ar / está a tocar / ainda vai.
// NB: horas de Lisboa (host/container em UTC → converter na ligação).

import type { LiveItem } from "./live";

export type Estado = "aired" | "playing" | "scheduled";

export type Row = {
  item: LiveItem;
  estado: Estado;
  startAbs: number; // segundos do dia
  relStart: number; // segundos desde o início do bloco
  progress: number; // 0..100 (só relevante em playing)
};

export function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function fmtClock(secOfDay: number) {
  const h = Math.floor(secOfDay / 3600) % 24;
  const m = Math.floor((secOfDay % 3600) / 60);
  return `${pad(h)}:${pad(m)}`;
}

export function fmtDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${pad(s)}`;
}

export function parseHHMM(s: string) {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 3600 + (m || 0) * 60;
}

export function buildSchedule(items: LiveItem[], blocoInicioSec: number, nowSec: number): Row[] {
  const rows: Row[] = [];
  let rel = 0;
  for (const item of items) {
    const relStart = rel;
    const relEnd = rel + item.duracao;
    let estado: Estado;
    let progress = 0;
    if (nowSec >= relEnd) estado = "aired";
    else if (nowSec >= relStart) {
      estado = "playing";
      progress = Math.min(100, Math.max(0, ((nowSec - relStart) / item.duracao) * 100));
    } else estado = "scheduled";
    rows.push({ item, estado, startAbs: blocoInicioSec + relStart, relStart, progress });
    rel = relEnd;
  }
  return rows;
}
