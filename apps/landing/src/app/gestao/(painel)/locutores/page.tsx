import { getLocutoresData } from "../../_lib/locutores";
import { PageHeader } from "../_components/ui";
import LocutoresGrid from "../_components/locutores-grid";

export default async function LocutoresPage() {
  const data = await getLocutoresData();

  return (
    <div className="space-y-4">
      <PageHeader crumb="Locutores" title="Locutores" />
      <LocutoresGrid data={data} />
    </div>
  );
}
