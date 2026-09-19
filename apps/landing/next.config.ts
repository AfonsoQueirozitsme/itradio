import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Cabeçalhos de segurança base — todas as rotas EXCETO /embed (que é
        // um widget para incorporar noutros sites, logo não pode ter X-Frame-Options).
        source: "/((?!embed).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Widget exportável: pode ser posto em <iframe> em qualquer site.
        // Sem X-Frame-Options; frame-ancestors * autoriza a incorporação.
        source: "/embed",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        // O service worker nunca deve ficar em cache no browser, para os
        // utilizadores apanharem sempre a versão mais recente.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
