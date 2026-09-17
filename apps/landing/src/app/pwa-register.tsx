"use client";

import { useEffect } from "react";

/**
 * Regista o service worker (/sw.js) para a app ser instalável e funcionar
 * offline. Só corre em produção — em dev o cache do SW atrapalha o HMR.
 * Não renderiza nada.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // Registo do SW é best-effort: se falhar, a app funciona na mesma.
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
