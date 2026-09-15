"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { programaAtual, type ProgramaAtual } from "./programacao";

export default function ProgramaAtualCard() {
  // Só calcula no cliente (depende da hora atual) para não dar mismatch de hidratação.
  const [prog, setProg] = useState<ProgramaAtual | null | undefined>(undefined);

  useEffect(() => {
    const update = () => setProg(programaAtual());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (prog === undefined) return null; // antes de montar

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 backdrop-blur-sm">
      {prog ? (
        <>
          <Image
            src={prog.locutor.foto}
            alt={prog.locutor.nome}
            width={56}
            height={56}
            className="h-14 w-14 rounded-full object-cover ring-2 ring-white/60"
          />
          <div className="text-left">
            <p className="text-xs uppercase tracking-wide text-muted">No ar agora</p>
            <p className="text-base font-semibold leading-tight">{prog.programa}</p>
            <p className="text-sm text-muted">com {prog.locutor.nome}</p>
          </div>
        </>
      ) : (
        <>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl">
            🎧
          </span>
          <div className="text-left">
            <p className="text-xs uppercase tracking-wide text-muted">No ar agora</p>
            <p className="text-base font-semibold leading-tight">Piloto automático</p>
            <p className="text-sm text-muted">Só música, sem parar</p>
          </div>
        </>
      )}
    </div>
  );
}
