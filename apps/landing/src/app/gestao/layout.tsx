import type { Metadata } from "next";

// Camada de topo do /gestao (envolve o ecrã de login E o painel guardado).
// Não valida sessão aqui — o guard vive no grupo (painel). Só garante que a
// gestão nunca é indexada por motores de busca.
export const metadata: Metadata = {
  title: "Gestão · IT.FM",
  robots: { index: false, follow: false },
};

export default function GestaoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
