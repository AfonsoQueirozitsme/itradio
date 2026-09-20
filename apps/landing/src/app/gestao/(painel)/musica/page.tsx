import { getMusicaData } from "../../_lib/musica";
import { Card, CardHeader, PageHeader, Stat } from "../_components/ui";
import { BarChart } from "../_components/charts";
import { IconMusica, IconGrid, IconLog, IconClock, IconRefresh } from "../_components/icons";
import MusicLibrary from "../_components/musica-library";

// Converte "AAAA-MM-DD HH:MM" para "DD/MM" (dia/mês) para as sublinhas dos KPIs.
function diaMes(datetime: string): string {
  const data = datetime.split(" ")[0];
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}
function hora(datetime: string): string {
  return datetime.split(" ")[1] ?? datetime;
}

export default async function MusicaPage() {
  const data = await getMusicaData();
  const k = data.kpis;

  // gráfico "faixas por pool": leitura directa do estado atual (value vs teto)
  const chartData = data.pools.map((p) => p.faixas);
  const peak = chartData.indexOf(Math.max(...chartData));

  return (
    <div className="space-y-4">
      <PageHeader crumb="Música" title="Música & estilos" />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Faixas totais" value={k.faixasTotais} icon={<IconMusica className="h-4 w-4" />}>
          <span className="text-[11px] text-[var(--gray)]">nos 6 pools</span>
        </Stat>
        <Stat label="Pools" value={k.pools} icon={<IconGrid className="h-4 w-4" />}>
          <span className="text-[11px] text-[var(--gray)]">1 playlist por programa</span>
        </Stat>
        <Stat label="LUFS alvo" value="−16" unit=" LUFS" icon={<IconLog className="h-4 w-4" />}>
          <span className="text-[11px] text-[var(--gray)]">{k.encode} · sem polish</span>
        </Stat>
        <Stat label="Última atualização" value={hora(k.ultimaAtualizacao)} icon={<IconClock className="h-4 w-4" />}>
          <span className="text-[11px] tabular-nums text-[var(--gray)]">
            {diaMes(k.ultimaAtualizacao)}
            {k.ultimaAtualizacaoRel ? ` · ${k.ultimaAtualizacaoRel}` : ""} · Lisboa
          </span>
        </Stat>
        <Stat label="Próximo rebuild" value={hora(k.proximoRebuild)} icon={<IconRefresh className="h-4 w-4" />}>
          <span className="text-[11px] tabular-nums text-[var(--gray)]">
            {diaMes(k.proximoRebuild)} · systemd · itfm-music-daily
          </span>
        </Stat>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--gray)]">
        <IconRefresh className="h-3.5 w-3.5" />
        Rebuild + redeploy diário às 05:00 Lisboa · 6 pools em série (sem restart).
      </p>

      {/* Pools + drawer + reconstruir */}
      <MusicLibrary data={data} />

      {/* Gráfico: faixas por pool (vs teto) */}
      <Card className="p-4">
        <CardHeader title="Faixas por pool" hint="teto 60 (Tuga 30) · estado atual" />
        <div className="mt-3">
          <BarChart data={chartData} peakIndex={peak} peakLabel={`${chartData[peak]}`} />
          <div className="mt-1 grid grid-cols-6 gap-2 text-center text-[10px] text-[var(--gray)]">
            {data.pools.map((p) => (
              <div key={p.slug} className="truncate">
                <div className="truncate font-medium text-[var(--ink)]">{p.nome.split(/[ +]/)[0]}</div>
                <div className="tabular-nums">
                  {p.faixas}/{p.cap}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
