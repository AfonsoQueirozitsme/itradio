import LivePlayer from "./live-player";

const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL ??
  "http://localhost:8080/listen/it.fm/radio.mp3";

function Logo() {
  return (
    <div className="flex items-center gap-3 font-[family-name:var(--font-logo)] font-semibold text-white sm:gap-4">
      <span className="text-6xl leading-none tracking-tight sm:text-8xl">
        Radio
      </span>
      <span className="flex aspect-square items-center justify-center rounded-full bg-white px-5 text-5xl leading-none text-brand sm:text-7xl">
        IT
      </span>
    </div>
  );
}

function Equalizer() {
  const bars = [0, 0.15, 0.3, 0.1, 0.25, 0.05, 0.2];
  return (
    <div className="flex h-6 items-end gap-1" aria-hidden>
      {bars.map((delay, i) => (
        <span
          key={i}
          className="eq-bar w-1.5 rounded-full bg-white"
          style={{ height: "100%", animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="mb-10 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-xs font-medium backdrop-blur-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        EM DIRETO
      </span>

      <Logo />

      <p className="mt-8 max-w-xl text-lg text-muted sm:text-xl">
        Música sem parar, ao vivo, onde estiveres. Carrega em play e deixa a
        Radio IT tocar.
      </p>

      <div className="mt-10 flex flex-col items-center gap-5 sm:flex-row">
        <LivePlayer streamUrl={STREAM_URL} />
        <div className="flex items-center gap-3 rounded-full border border-white/30 bg-white/10 px-5 py-3 backdrop-blur-sm">
          <Equalizer />
          <span className="text-sm font-medium">Agora a tocar</span>
        </div>
      </div>
    </main>
  );
}
