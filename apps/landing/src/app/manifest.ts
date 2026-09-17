import type { MetadataRoute } from "next";
import {
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_LANG,
  BRAND_COLOR,
} from "./site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_TITLE,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: SITE_LANG,
    dir: "ltr",
    background_color: BRAND_COLOR,
    theme_color: BRAND_COLOR,
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
