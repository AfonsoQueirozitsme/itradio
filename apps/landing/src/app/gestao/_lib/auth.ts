// Auth SSO same-origin da gestão. Reutiliza a sessão do painel AzuraCast: como
// o /gestao é servido no mesmo host do painel (panel.itfm.live), o browser envia
// o cookie de sessão do AzuraCast a estas páginas. Validamos server-side,
// reencaminhando esse cookie cru para a API do AzuraCast em localhost.
//
// O login é só uma PORTA. As escritas na estação NÃO usam esta sessão — usam a
// chave de serviço (Bearer) do lado apps/station, caminho independente e sem CSRF.

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GESTAO_ADMIN_GATE, GESTAO_DEV_BYPASS } from "./config";
// azProbe (GET cookie-forward, fail-closed) vive no leitor de dados — fonte
// única, para o gate de auth e as leituras partilharem exatamente a mesma sonda.
import { azProbe } from "./azuracast-read";

export type Operator = {
  id: number | string;
  name: string | null;
  email: string | null;
  roles: { id: number; name: string }[];
};

// Resolve o operador a partir do cookie de sessão do AzuraCast:
//   1) GET /api/frontend/account/me   → 200 = sessão válida + identidade
//   2) GET <GESTAO_ADMIN_GATE>        → 200 = pode administrar a estação
// Devolve null se qualquer passo falhar. (Uma rota /admin dá 403 tanto a
// não-autenticado como a autenticado-sem-permissão — daí a ordem: primeiro
// confirmar a sessão, depois a permissão.)
export async function operatorFromCookie(cookie: string | null): Promise<Operator | null> {
  if (!cookie) return null;

  const me = await azProbe("/api/frontend/account/me", cookie);
  if (!me || me.status !== 200) return null;

  const gate = await azProbe(GESTAO_ADMIN_GATE, cookie);
  if (!gate || gate.status !== 200) return null;

  let data: Record<string, unknown>;
  try {
    data = (await me.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    id: (data.id as number | string) ?? "",
    name: typeof data.name === "string" ? data.name : null,
    email: typeof data.email === "string" ? data.email : null,
    roles: Array.isArray(data.roles) ? (data.roles as { id: number; name: string }[]) : [],
  };
}

// Operador do pedido atual (RSC, route handlers, server actions). Lê o cookie do
// pedido via next/headers. Memoizado por pedido com React cache() — layout e
// página partilham uma só sondagem ao AzuraCast por render.
export const currentOperator = cache(async (): Promise<Operator | null> => {
  // DEV-ONLY (ver config.ts): sem AzuraCast local, devolve um operador fictício
  // para a UI renderizar. Cadeado duplo garantido no config; aqui é o único
  // ponto por onde tudo passa (guard, páginas, route handler), sem ler cookie.
  if (GESTAO_DEV_BYPASS) {
    return { id: "dev", name: "Dev Operator", email: "dev@local", roles: [] };
  }

  const cookie = (await headers()).get("cookie");
  return operatorFromCookie(cookie);
});

// Guard para páginas: exige operador ou reencaminha para o ecrã de login.
// NUNCA chamar dentro de try/catch — redirect() atira NEXT_REDIRECT.
export async function requireOperator(): Promise<Operator> {
  const op = await currentOperator();
  if (!op) redirect("/gestao/login");
  return op;
}
