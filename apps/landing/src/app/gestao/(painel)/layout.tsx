import Logo from "../../logo";
import { requireOperator } from "../_lib/auth";
import PainelNav from "./_components/painel-nav";

// Camada guardada do painel (grupo de rotas "(painel)" → não altera o URL, o
// índice continua a ser /gestao). O guard corre em cada render server-side;
// nunca confiamos só no proxy/cliente. O ecrã de login fica fora deste grupo.
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const op = await requireOperator();
  const quem = op.name || op.email || "sessão ativa";

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo className="[&_span:first-child]:text-xl [&_span:last-child]:px-2 [&_span:last-child]:text-lg [&_span]:!text-slate-800" />
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand">
              Gestão
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline" title={op.email ?? undefined}>
              {quem}
            </span>
            <a
              href="/logout"
              className="rounded-full border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-100"
            >
              Sair
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <PainelNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
