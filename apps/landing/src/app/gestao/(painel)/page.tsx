import { getPainelData } from "../_lib/painel";
import { Card, CardHeader, PageHeader, Stat, StatusChip } from "./_components/ui";
import { BarChart, RadialGauge, Sparkline, PoolBar } from "./_components/charts";
import RangeToggle from "./_components/range-toggle";
import { IconClock } from "./_components/icons";

const PROX_TONE = {
  noticias: "ok",
  programa: "neutral",
  segmento: "warn",
} as const;

export default async function PainelPage() {
  const d = await getPainelData();

  return (
    <div className="space-y-4">
      <PageHeader crumb="Painel" title="Painel" action={<RangeToggle />} />

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ouvintes agora" value={d.ouvintesAgora.value} delta={d.ouvintesAgora.delta}>
          <Sparkline data={d.ouvintesAgora.spark} />
        </Stat>

        <Card className="p-4">
          <StatusChip tone="live" dot>
            No ar
          </StatusChip>
          <div className="mt-2 font-[family-name:var(--font-logo)] text-[19px] font-semibold text-[var(--ink)]">
            {d.noAr.programa}
          </div>
          <div className="mt-0.5 text-xs text-[var(--gray)]">
            {d.noAr.locutor} · até {d.noAr.ate}
          </div>
        </Card>

        <Stat label="Ocupação da grelha" value={d.ocupacaoGrelha.pct} unit="%">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
            <div
              className="h-full rounded-full bg-[var(--ink)]"
              style={{ width: `${d.ocupacaoGrelha.pct}%` }}
            />
          </div>
        </Stat>

        <Card className="p-4">
          <div className="text-xs text-[var(--gray)]">Próximo segmento</div>
          <div className="mt-2 font-[family-name:var(--font-logo)] text-[19px] font-semibold text-[var(--ink)]">
            {d.proximoSegmento.tipo}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--gray)]">
            <IconClock className="h-3.5 w-3.5" />
            {d.proximoSegmento.hora} · em {d.proximoSegmento.emMin} min
          </div>
        </Card>
      </div>

      {/* Gráfico + medidor */}
      <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr]">
        <Card className="p-4">
          <CardHeader title="Ouvintes hoje" hint={`pico ${d.ouvintesHoje.picoHora} · ${d.ouvintesHoje.picoLabel}`} />
          <div className="mt-2">
            <BarChart
              data={d.ouvintesHoje.serie}
              peakIndex={d.ouvintesHoje.picoIndex}
              peakLabel={d.ouvintesHoje.picoLabel}
            />
          </div>
        </Card>

        <Card className="flex flex-col items-center p-4">
          <div className="w-full">
            <CardHeader title="Ocupação da grelha" />
          </div>
          <div className="flex flex-1 items-center">
            <RadialGauge
              value={d.ocupacaoGrelha.pct}
              caption={`${d.ocupacaoGrelha.horasCobertas} de ${d.ocupacaoGrelha.totalHoras} h`}
            />
          </div>
        </Card>
      </div>

      {/* Pools de música */}
      <Card className="p-4">
        <CardHeader title="Estado dos pools de música" hint="atualizado há 3 h" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {d.pools.map((p) => (
            <PoolBar key={p.label} label={p.label} value={p.value} cap={p.cap} />
          ))}
        </div>
      </Card>

      {/* Próximos na grelha */}
      <Card className="p-4">
        <CardHeader title="Próximos na grelha" />
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {d.proximos.map((p, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5">
              <span className="font-[family-name:var(--font-logo)] text-sm font-semibold tabular-nums text-[var(--ink)]">
                {p.hora}
              </span>
              <span className="flex-1 text-sm text-[var(--ink)]">{p.titulo}</span>
              <StatusChip tone={PROX_TONE[p.tipo]}>{p.tipo}</StatusChip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
