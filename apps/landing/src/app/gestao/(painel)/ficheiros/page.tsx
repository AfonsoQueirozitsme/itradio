import { PageHeader } from "../_components/ui";
import FileExplorer from "../_components/file-explorer";

export default function FicheirosPage() {
  return (
    <div className="space-y-4">
      <PageHeader crumb="Ficheiros" title="Explorador de ficheiros" />
      <FileExplorer />
    </div>
  );
}
