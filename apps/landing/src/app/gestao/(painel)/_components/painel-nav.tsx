"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navegação do painel. As secções por construir ficam visíveis mas desativadas
// ("em breve") para dar já o mapa completo do CMS.
type Item = { href: string; label: string; ready: boolean };

const ITEMS: Item[] = [
  { href: "/gestao", label: "Painel", ready: true },
  { href: "/gestao/programas", label: "Programas", ready: false },
  { href: "/gestao/locutores", label: "Locutores", ready: false },
  { href: "/gestao/segmentos", label: "Segmentos", ready: false },
  { href: "/gestao/musica", label: "Música", ready: false },
];

export default function PainelNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        if (!item.ready) {
          return (
            <span
              key={item.href}
              aria-disabled
              title="Em breve"
              className="cursor-not-allowed rounded-full px-3 py-1.5 text-sm text-slate-400"
            >
              {item.label}
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                em breve
              </span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white"
                : "rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
