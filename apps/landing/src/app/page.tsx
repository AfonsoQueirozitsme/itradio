import Logo from "./logo";
import PlayButton from "./play-button";
import PlayerBar from "./player-bar";
import ProgramaAtualCard from "./programa-atual";
import { PlayerProvider } from "./player-context";

const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL ??
  "http://localhost:8080/listen/it.fm/radio.mp3";

export default function Home() {
  return (
    <PlayerProvider streamUrl={STREAM_URL}>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 pb-32 text-center">
        <div className="mb-10">
          <ProgramaAtualCard />
        </div>

        <Logo />

        <p className="mt-8 max-w-xl text-lg text-muted sm:text-xl">
          Música sem parar, ao vivo, onde estiveres. Carrega em play e deixa a
          Radio IT tocar.
        </p>

        <div className="mt-10">
          <PlayButton />
        </div>
      </main>

      <PlayerBar />
    </PlayerProvider>
  );
}
