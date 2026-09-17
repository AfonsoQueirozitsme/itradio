// A imagem do Twitter/X é a mesma do Open Graph (summary_large_image).
// `runtime` é declarado localmente (o Next não analisa re-exports deste campo).
export const runtime = "nodejs";
export { default, alt, size, contentType } from "./opengraph-image";
