import { SITE_URL, SITE_NAME } from "../../site";

// Endpoint oEmbed (https://oembed.com): um consumidor (WordPress, Discourse,
// etc.) que encontre um link para itfm.live pede aqui o HTML de incorporação e
// mete o player (via /embed) automaticamente. Descoberta: <link rel="alternate"
// type="application/json+oembed"> no layout.
const DEFAULT_W = 480;
const DEFAULT_H = 152;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // O oEmbed permite json e xml; só implementamos json (→ 501, como manda a spec).
  const format = (searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json") {
    return new Response("oEmbed: apenas o formato json é suportado", { status: 501 });
  }

  const maxwidth = Number(searchParams.get("maxwidth"));
  const maxheight = Number(searchParams.get("maxheight"));
  const width = clamp(maxwidth > 0 ? maxwidth : DEFAULT_W, 240, 960);
  const height = clamp(maxheight > 0 ? maxheight : DEFAULT_H, 120, 400);

  const embedUrl = `${SITE_URL}/embed`;
  const html =
    `<iframe src="${embedUrl}" width="${width}" height="${height}" ` +
    `style="border:0;border-radius:16px;width:100%;max-width:${width}px" ` +
    `loading="lazy" allow="autoplay" title="${SITE_NAME} — em direto"></iframe>`;

  const payload = {
    version: "1.0",
    type: "rich",
    provider_name: SITE_NAME,
    provider_url: SITE_URL,
    title: "Radio IT — em direto (IT.FM)",
    author_name: SITE_NAME,
    author_url: SITE_URL,
    width,
    height,
    html,
    thumbnail_url: `${SITE_URL}/icon-512.png`,
    thumbnail_width: 512,
    thumbnail_height: 512,
  };

  return Response.json(payload, {
    headers: {
      // Cacheável, e legível por consumidores client-side (CORS aberto: é público).
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
