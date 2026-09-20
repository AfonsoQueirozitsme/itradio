"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { programaAtual, type ProgramaAtual } from "./programacao";
import { STREAM_URL } from "./site";

/**
 * Cartão "No ar agora".
 *
 * O valor inicial é calculado no servidor (hora de Lisboa) e passado por prop,
 * por isso o cartão já vem no HTML inicial (sem "pop-in" nem mismatch de
 * hidratação). No cliente reavalia ao montar e a cada 60 s para acompanhar a
 * mudança de turno sem recarregar a página.
 */
export default function ProgramaAtualCard({
  initial = null,
}: {
  initial?: ProgramaAtual | null;
}) {
  const [prog, setProg] = useState<ProgramaAtual | null>(initial);
  const [ouvintes, setOuvintes] = useState(0);

  useEffect(() => {
    const update = () => setProg(programaAtual());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    const npUrl = (() => {
      try {
        const u = new URL(STREAM_URL);
        const parts = u.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("listen");
        const sc = idx >= 0 ? parts[idx + 1] : parts[0];
        return sc ? `${u.origin}/api/nowplaying/${sc}` : null;
      } catch { return null; }
    })();
    if (!npUrl) return;
    async function poll() {
      try {
        const res = await fetch(npUrl!, { cache: "no-store" });
        if (!res.ok || cancel) return;
        const data = await res.json();
        if (cancel) return;
        const n = data?.listeners?.total;
        if (typeof n === "number") setOuvintes(n);
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  const foto = prog ? prog.locutor.foto : "/piloto-automatico.jpg";
  const nomeFoto = prog ? prog.locutor.nome : "Piloto automático";
  const titulo = prog ? prog.programa : "Piloto automático";
  const legenda = prog
    ? `com ${prog.locutor.nome} · até às ${prog.fim}h`
    : "Só música, sem parar";

  return (
    <section
      aria-label="No ar agora"
      aria-live="polite"
      className="flex items-center gap-4 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 backdrop-blur-sm"
    >
      <Image
        key={foto}
        src={foto}
        alt={nomeFoto}
        width={56}
        height={56}
        className="h-14 w-14 rounded-full object-cover ring-2 ring-white/60"
      />
      <div className="text-left">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          No ar agora
        </p>
        <p className="text-base font-semibold leading-tight">{titulo}</p>
        <p className="text-sm text-muted">{legenda}</p>
        {ouvintes > 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/80" />
            </span>
            <span className="tabular-nums">{ouvintes}</span> a ouvir agora
          </p>
        ) : null}
      </div>
    </section>
  );
}
