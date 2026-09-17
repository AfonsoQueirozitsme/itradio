import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      // O conteúdo "no ar agora" muda ao longo do dia.
      changeFrequency: "hourly",
      priority: 1,
    },
  ];
}
