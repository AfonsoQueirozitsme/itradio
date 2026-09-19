import { currentOperator } from "@/app/gestao/_lib/auth";

// Estado da sessão da gestão (para o cliente detetar expiração/logout).
// Reavalia sempre server-side — nunca confia no cliente.
export async function GET() {
  const op = await currentOperator();

  if (!op) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      authenticated: true,
      operator: { id: op.id, name: op.name, email: op.email },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
