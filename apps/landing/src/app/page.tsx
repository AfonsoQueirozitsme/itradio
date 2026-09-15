import PlayButton from "./play-button";
import PlayerBar from "./player-bar";
import ProgramaAtualCard from "./programa-atual";
import { PlayerProvider } from "./player-context";

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

export default function Home() {
  return (
    <PlayerProvider streamUrl={STREAM_URL}>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 pb-32 text-center">
        <Logo />

        <p className="mt-8 max-w-xl text-lg text-muted sm:text-xl">
          Música sem parar, ao vivo, onde estiveres. Carrega em play e deixa a
          Radio IT tocar.
        </p>

        <div className="mt-10">
          <ProgramaAtualCard />
        </div>

        <div className="mt-8">
          <PlayButton />
        </div>
      </main>

      <PlayerBar />
    </PlayerProvider>
  );
}
