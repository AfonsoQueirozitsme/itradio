import { requireOperator } from "../_lib/auth";
import { getLiveData } from "../_lib/live";
import AppShell from "./_components/app-shell";

// Camada guardada do painel (grupo "(painel)" → não altera o URL; o índice
// continua a ser /gestao). O guard corre em cada render server-side — nunca
// confiamos só no proxy/cliente. O ecrã de login fica FORA deste grupo.
// O shell (rail + top bar + barra "Em direto") é client; recebe o operador e o
// alinhamento ao ar já resolvidos como props. A barra vive aqui (não na página
// Live) para aparecer em TODAS as páginas, sempre colada à navbar.
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const [op, live] = await Promise.all([requireOperator(), getLiveData()]);
  return (
    <AppShell
      operator={{ name: op.name || op.email || "Sessão ativa", email: op.email }}
      live={live}
    >
      {children}
    </AppShell>
  );
}
