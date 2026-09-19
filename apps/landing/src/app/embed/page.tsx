import type { Metadata } from "next";
import { PlayerProvider } from "../player-context";
import EmbedPlayer from "./embed-player";
import { STREAM_URL } from "../site";

// Widget exportável: página mínima, sem cromado do site, para <iframe> noutros
// sites. Não indexável (o conteúdo canónico é a home).
export const metadata: Metadata = {
  title: "Player",
  robots: { index: false, follow: false },
  alternates: { canonical: "/embed" },
};

export default function EmbedPage() {
  return (
    <PlayerProvider streamUrl={STREAM_URL}>
      <EmbedPlayer />
    </PlayerProvider>
  );
}
