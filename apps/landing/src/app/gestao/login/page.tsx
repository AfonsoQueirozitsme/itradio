import { redirect } from "next/navigation";
import Logo from "../../logo";
import { currentOperator } from "../_lib/auth";

// Ecrã de entrada da gestão (público, sem guard). Como o /gestao é servido no
// mesmo host do painel AzuraCast, "iniciar sessão" é simplesmente iniciar
// sessão no painel — a sessão passa a valer aqui automaticamente (SSO).
export default async function GestaoLoginPage() {
  // Já autenticado? entra direto no painel.
  const op = await currentOperator();
  if (op) redirect("/gestao");

  return (
    <div className="app-gradient flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo className="[&_span:first-child]:text-4xl [&_span:last-child]:px-3 [&_span:last-child]:text-3xl" />
        </div>

        <div className="rounded-3xl bg-white/12 p-8 shadow-2xl ring-1 ring-white/20 backdrop-blur-md">
          <h1 className="text-2xl font-semibold">Gestão da rádio</h1>
          <p className="mt-2 text-sm text-white/80">
            A gestão usa a tua sessão do painel IT.FM. Inicia sessão no painel e
            volta aqui — não há palavra-passe separada.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <a
              href="/login"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand shadow-lg transition-transform hover:scale-[1.02]"
            >
              Iniciar sessão no painel
            </a>
            <a
              href="/gestao"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Já iniciei sessão — entrar
            </a>
          </div>

          <p className="mt-6 text-xs text-white/60">
            Precisas de permissão para administrar a estação. Se iniciaste sessão
            e mesmo assim não entras, a tua conta não tem esse nível de acesso.
          </p>
        </div>
      </div>
    </div>
  );
}
