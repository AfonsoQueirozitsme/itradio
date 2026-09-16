// Grelha de locutores da Radio IT.
//
// Cada turno é [horaInício, horaFim) em horas locais (0–24). Fora dos turnos
// definidos assume-se piloto automático (só música).
//
// >>> EDITA AQUI os horários reais de cada locutor. <<<
// Os `dias` são opcionais (0 = domingo … 6 = sábado). Sem `dias`, o turno
// aplica-se todos os dias.

export type Locutor = {
  slug: string;
  nome: string;
  foto: string; // caminho em /public
};

export type Turno = {
  locutor: string; // slug
  programa: string;
  inicio: number; // hora local, 0–24
  fim: number; // hora local, 0–24 (exclusivo)
  dias?: number[]; // 0=dom … 6=sáb; ausente = todos os dias
};

export const LOCUTORES: Record<string, Locutor> = {
  beatriz_lima: { slug: "beatriz_lima", nome: "Beatriz Lima", foto: "/locutores/beatriz_lima.jpg" },
  diogo_silva: { slug: "diogo_silva", nome: "Diogo Silva", foto: "/locutores/diogo_silva.jpg" },
  goncalo_pires: { slug: "goncalo_pires", nome: "Gonçalo Pires", foto: "/locutores/goncalo_pires.jpg" },
  sofia_martins: { slug: "sofia_martins", nome: "Sofia Martins", foto: "/locutores/sofia_martins.jpg" },
  tomas_rocha: { slug: "tomas_rocha", nome: "Tomás Rocha", foto: "/locutores/tomas_rocha.jpg" },
};

// Grelha real da IT.FM (turnos = [início, fim) em hora local de Lisboa).
export const GRELHA: Turno[] = [
  { locutor: "diogo_silva", programa: "Boot Matinal", inicio: 7, fim: 10 },
  { locutor: "sofia_martins", programa: "Ctrl+Alt+Ritmo", inicio: 10, fim: 13 },
  { locutor: "tomas_rocha", programa: "Pause & Play", inicio: 13, fim: 16 },
  { locutor: "beatriz_lima", programa: "Hora de Ponta", inicio: 16, fim: 20 },
  { locutor: "goncalo_pires", programa: "Modo Noturno", inicio: 20, fim: 23 },
  // 23–07: piloto automático (madrugada — só música).
];

export type ProgramaAtual = {
  locutor: Locutor;
  programa: string;
};

/** Devolve o programa/locutor a dar agora, ou null (piloto automático). */
export function programaAtual(date: Date = new Date()): ProgramaAtual | null {
  const hora = date.getHours();
  const dia = date.getDay();
  const turno = GRELHA.find(
    (t) =>
      hora >= t.inicio &&
      hora < t.fim &&
      (t.dias === undefined || t.dias.includes(dia)),
  );
  if (!turno) return null;
  const locutor = LOCUTORES[turno.locutor];
  if (!locutor) return null;
  return { locutor, programa: turno.programa };
}
