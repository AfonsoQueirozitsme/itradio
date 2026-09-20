import { getProgramasData } from "../../_lib/programas";
import { PageHeader } from "../_components/ui";
import ProgramasBoard from "../_components/programas-board";

// Página PROGRAMAS (Server Component): busca o seam e compõe. Toda a
// interatividade (timeline, lista, drawer) vive no client ProgramasBoard.
export default async function ProgramasPage() {
  const data = await getProgramasData();

  return (
    <div className="space-y-4">
      <PageHeader crumb="Programas" title="Grelha & programas" />
      <ProgramasBoard data={data} />
    </div>
  );
}
