import { currentOperator } from "../_lib/auth";

type Estado = "ativo" | "breve";

const FASES: { fase: string; titulo: string; desc: string; estado: Estado }[] = [
  {
    fase: "Fase 0",
    titulo: "Fundações + acesso",
    desc: "Sessão partilhada com o painel (SSO), estrutura do CMS e este painel.",
    estado: "ativo",
  },
  {
    fase: "Fase 1",
    titulo: "Programas + grelha do site",
    desc: "Criar e editar programas; a grelha do site passa a ler daqui.",
    estado: "breve",
  },
  {
    fase: "Fase 2",
    titulo: "Locutores + fotos",
    desc: "Criar locutores e carregar imagens (guardadas fora do git).",
    estado: "breve",
  },
  {
    fase: "Fase 3",
    titulo: "Segmentos & notícias",
    desc: "Horas de trânsito, meteo e notícias :00/:30. Pré-visualizar e aplicar.",
    estado: "breve",
  },
  {
    fase: "Fase 4",
    titulo: "Janelas de música",
    desc: "Quando cada pool toca no ar, sem tocar nas primitivas destrutivas.",
    estado: "breve",
  },
  {
    fase: "Fase 5",
    titulo: "Estilos de música",
    desc: "Que géneros cada programa saca; reconstruir agora (job assíncrono).",
    estado: "breve",
  },
];

export default async function PainelPage() {
  const op = await currentOperator();
  const nome = op?.name || op?.email || "";

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">
          Olá{nome ? `, ${nome.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Painel de gestão da rádio. Vai crescendo por fases — cada uma entra sem
          risco para a emissão no ar.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Roadmap
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FASES.map((f) => (
            <div
              key={f.fase}
              className={
                f.estado === "ativo"
                  ? "rounded-2xl border border-brand/30 bg-white p-4 shadow-sm ring-1 ring-brand/10"
                  : "rounded-2xl border border-slate-200 bg-white p-4"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {f.fase}
                </span>
                {f.estado === "ativo" ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                    ativo
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    em breve
                  </span>
                )}
              </div>
              <h3 className="mt-1 font-semibold text-slate-900">{f.titulo}</h3>
              <p className="mt-1 text-sm text-slate-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="mb-2 font-semibold text-slate-900">Como funciona o acesso</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            O acesso é a tua sessão do painel IT.FM — sem palavra-passe separada.
          </li>
          <li>
            As alterações à estação são feitas por um serviço dedicado com chave
            própria; a tua sessão só autoriza a entrada.
          </li>
          <li>
            Operações destrutivas (apagar ficheiros, limpar programação) nunca
            estão disponíveis por aqui.
          </li>
        </ul>
      </section>
    </div>
  );
}
