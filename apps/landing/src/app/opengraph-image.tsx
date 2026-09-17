import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_ALT_NAME, SITE_TAGLINE } from "./site";

// Precisa do runtime Node para ler a fonte do disco.
export const runtime = "nodejs";

export const alt = "Radio IT (IT.FM) — a rádio online. Música sem parar, ao vivo.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let fredoka: Buffer | null = null;
  try {
    fredoka = await readFile(join(process.cwd(), "assets/Fredoka.ttf"));
  } catch {
    fredoka = null; // sem a fonte, o satori usa o tipo de letra por defeito.
  }

  const fonts = fredoka
    ? [{ name: "Fredoka", data: fredoka, weight: 600 as const, style: "normal" as const }]
    : undefined;
  const fontFamily = fredoka ? "Fredoka" : undefined;

  // Barras de equalizador decorativas (alturas variadas).
  const bars = [46, 78, 120, 64, 150, 90, 54, 110, 72];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 84px",
          color: "#ffffff",
          fontFamily,
          backgroundColor: "#ec5a57",
          backgroundImage:
            "linear-gradient(135deg, #ff5c8a 0%, #ec5a57 32%, #ff8a3d 70%, #cfe0f3 100%)",
        }}
      >
        {/* topo: chip da marca */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 26px",
              borderRadius: 9999,
              backgroundColor: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.45)",
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 16,
                height: 16,
                borderRadius: 9999,
                backgroundColor: "#ffffff",
              }}
            />
            {SITE_ALT_NAME} · rádio online · ao vivo
          </div>
        </div>

        {/* centro: wordmark + tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ display: "flex", fontSize: 168, fontWeight: 600, lineHeight: 1 }}>
              Radio
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 168,
                padding: "0 44px",
                borderRadius: 9999,
                backgroundColor: "#ffffff",
                color: "#ec5a57",
                fontSize: 150,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              IT
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 500, opacity: 0.95, maxWidth: 900 }}>
            {SITE_TAGLINE}
          </div>
        </div>

        {/* rodapé: domínio + equalizador */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 600, opacity: 0.95 }}>
            itfm.live
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 150 }}>
            {bars.map((h, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  width: 18,
                  height: h,
                  borderRadius: 9999,
                  backgroundColor: "#ffffff",
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
