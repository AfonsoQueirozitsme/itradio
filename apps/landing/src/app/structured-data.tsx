// JSON-LD (schema.org) da Radio IT — renderizado no servidor, dentro do layout.
//
// Um único @graph com nós ligados por @id: WebSite → Organization/RadioStation
// (com os locutores como `employee`) → BroadcastService (com ListenAction para
// o stream). Mantém-se em sincronia com a grelha via LOCUTORES.

import { LOCUTORES } from "./programacao";
import {
  SITE_URL,
  SITE_NAME,
  SITE_ALT_NAME,
  SITE_DESCRIPTION,
  SITE_TAGLINE,
  SITE_LANG,
  absoluteUrl,
} from "./site";

export default function StructuredData() {
  const orgId = `${SITE_URL}/#organization`;
  const siteId = `${SITE_URL}/#website`;
  const serviceId = `${SITE_URL}/#broadcast`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": siteId,
        url: absoluteUrl("/"),
        name: SITE_NAME,
        alternateName: SITE_ALT_NAME,
        inLanguage: SITE_LANG,
        publisher: { "@id": orgId },
      },
      {
        "@type": ["Organization", "RadioStation"],
        "@id": orgId,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAME,
        url: absoluteUrl("/"),
        logo: absoluteUrl("/icon-512.png"),
        image: absoluteUrl("/opengraph-image"),
        description: SITE_DESCRIPTION,
        slogan: SITE_TAGLINE,
        areaServed: "PT",
        employee: Object.values(LOCUTORES).map((l) => ({
          "@type": "Person",
          name: l.nome,
          image: absoluteUrl(l.foto),
          jobTitle: "Locutor(a)",
          worksFor: { "@id": orgId },
        })),
      },
      {
        "@type": "BroadcastService",
        "@id": serviceId,
        name: SITE_NAME,
        broadcastDisplayName: SITE_ALT_NAME,
        inLanguage: SITE_LANG,
        areaServed: "PT",
        broadcaster: { "@id": orgId },
        description: SITE_DESCRIPTION,
        potentialAction: {
          "@type": "ListenAction",
          target: absoluteUrl("/"),
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON-LD estático e derivado de constantes internas (sem input do
      // utilizador); escapamos "<" na mesma por segurança.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}
