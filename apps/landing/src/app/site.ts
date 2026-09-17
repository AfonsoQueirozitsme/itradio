// Configuração central de SEO / identidade da Radio IT (IT.FM).
//
// Fonte única de verdade para metadata, Open Graph, sitemap, robots, manifest e
// JSON-LD. Muda aqui e tudo o resto acompanha. O domínio público é
// sobreponível por env (NEXT_PUBLIC_SITE_URL) para staging/preview.

/** URL pública canónica, sem barra final. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://itfm.live"
).replace(/\/+$/, "");

/** Marca curta (wordmark) usada em og:site_name, títulos e ícones. */
export const SITE_NAME = "Radio IT";

/** Nome alternativo / shortcode (domínio, it.fm). */
export const SITE_ALT_NAME = "IT.FM";

/** Título por defeito da home (a home usa `title.default`). */
export const SITE_TITLE = "Radio IT · a rádio online (IT.FM)";

/** Slogan curto. */
export const SITE_TAGLINE = "Música sem parar, ao vivo, onde estiveres.";

/** Descrição para <meta description>, Open Graph e JSON-LD. */
export const SITE_DESCRIPTION =
  "Radio IT (IT.FM) — a rádio online portuguesa. Música sem parar, notícias ao " +
  "vivo e programas com locutores reais, 24 horas por dia. Carrega em play e ouve " +
  "onde estiveres.";

/** Locale no formato Open Graph (língua_PAÍS). */
export const SITE_OG_LOCALE = "pt_PT";

/** Locale BCP-47 (para <html lang>, JSON-LD inLanguage, hreflang). */
export const SITE_LANG = "pt-PT";

/** Cor da marca (chrome do browser, theme_color, splash). */
export const BRAND_COLOR = "#ec5a57";

/** URL do stream (partilhada com o player). */
export const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL ??
  "http://localhost:8080/listen/it.fm/radio.mp3";

/** Palavras-chave (baixo peso no Google, mas inofensivas e coerentes). */
export const SITE_KEYWORDS = [
  "Radio IT",
  "IT.FM",
  "rádio online",
  "rádio portuguesa",
  "rádio ao vivo",
  "rádio em direto",
  "música online",
  "streaming de rádio",
  "webradio",
  "rádio 24 horas",
];

/** Constrói um URL absoluto a partir de um caminho relativo à raiz do site. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL + "/").toString();
}
