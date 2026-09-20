"use client";

import { useState } from "react";

// Toggle segmentado de intervalo temporal (Ledgerix: Week/Month/Quarter/Year).
// UI-first: por agora só faz a seleção visual — os dados são mock. Quando ligar
// a dados reais, passa a escrever o intervalo no URL (?range=) e o server lê.

const RANGES = ["Hoje", "Semana", "Mês", "Ano"] as const;
type Range = (typeof RANGES)[number];

export default function RangeToggle({ initial = "Hoje" }: { initial?: Range }) {
  const [active, setActive] = useState<Range>(initial);
  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--card)] p-1 text-xs">
      {RANGES.map((r) => {
        const on = r === active;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            onClick={() => setActive(r)}
            className={
              on
                ? "rounded-full bg-[var(--ink)] px-3.5 py-1.5 font-medium text-white"
                : "rounded-full px-3.5 py-1.5 font-medium text-[var(--gray)] transition-colors hover:text-[var(--ink)]"
            }
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
