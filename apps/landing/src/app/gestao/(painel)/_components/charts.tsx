// Gráficos da gestão — SVG à mão, desenhados a partir de dados recebidos por
// props. Sem hooks e sem libs → Server Components (zero JS no cliente). Cores
// pelos tokens do scope: verde var(--brand), preto var(--ink), var(--bg)/(--line).

// ── Gráfico de barras (com destaque + callout no pico) ──────────────────────
export function BarChart({
  data,
  peakIndex,
  peakLabel,
  height = 150,
}: {
  data: number[];
  peakIndex?: number;
  peakLabel?: string;
  height?: number;
}) {
  const W = 340;
  const max = Math.max(...data, 1);
  const gap = 8;
  const bw = (W - gap * (data.length - 1)) / data.length;
  const topPad = peakLabel ? 30 : 8;
  const usable = height - topPad;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} aria-hidden="true">
      {data.map((v, i) => {
        const h = Math.max(3, (v / max) * usable);
        const x = i * (bw + gap);
        const y = height - h;
        const peak = i === peakIndex;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={bw}
            height={h}
            rx={4}
            fill={peak ? "var(--ink)" : "var(--brand)"}
          />
        );
      })}
      {peakLabel && typeof peakIndex === "number" ? (
        <g>
          {(() => {
            const x = peakIndex * (bw + gap) + bw / 2;
            const bx = Math.min(Math.max(x - 26, 0), W - 52);
            return (
              <>
                <rect x={bx} y={2} width={52} height={22} rx={6} fill="var(--ink)" />
                <text
                  x={bx + 26}
                  y={17}
                  textAnchor="middle"
                  fill="#fff"
                  fontFamily="var(--font-logo)"
                  fontSize={12}
                  fontWeight={600}
                >
                  {peakLabel}
                </text>
              </>
            );
          })()}
        </g>
      ) : null}
    </svg>
  );
}

// ── Medidor radial (ocupação / preenchimento) ───────────────────────────────
export function RadialGauge({
  value,
  caption,
  size = 150,
}: {
  value: number; // 0–100
  caption?: string;
  size?: number;
}) {
  const r = 60;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  const cx = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--bg)" strokeWidth={14} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text
        x={cx}
        y={cx - 2}
        textAnchor="middle"
        fill="var(--ink)"
        fontFamily="var(--font-logo)"
        fontSize={30}
        fontWeight={600}
      >
        {Math.round(pct)}%
      </text>
      {caption ? (
        <text x={cx} y={cx + 18} textAnchor="middle" fill="var(--gray)" fontSize={11}>
          {caption}
        </text>
      ) : null}
    </svg>
  );
}

// ── Sparkline (mini tendência) ──────────────────────────────────────────────
export function Sparkline({
  data,
  height = 24,
  stroke = "var(--brand)",
}: {
  data: number[];
  height?: number;
  stroke?: string;
}) {
  const W = 120;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Barra de pool (preenchimento vs capacidade, com tom por saúde) ──────────
export function PoolBar({
  label,
  value,
  cap,
}: {
  label: string;
  value: number;
  cap: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / cap) * 100)));
  const full = pct >= 100;
  const low = pct < 60;
  const barColor = low ? "#fb923c" : full ? "var(--ink)" : "var(--brand)";
  const numColor = low ? "text-amber-600" : full ? "text-[#0b3d1a]" : "text-[var(--gray)]";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--ink)]">{label}</span>
        <span className={numColor}>
          {value}/{cap}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
      </div>
    </div>
  );
}
