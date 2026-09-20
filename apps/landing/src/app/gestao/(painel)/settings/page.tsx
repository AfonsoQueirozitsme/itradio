import { getSettingsData } from "../../_lib/settings";
import { PageHeader } from "../_components/ui";
import SettingsPanel from "../_components/settings-panel";

export default async function SettingsPage() {
  const data = await getSettingsData();
  return (
    <div className="space-y-4">
      <PageHeader crumb="Settings" title="Definições · Cartões" />
      <SettingsPanel data={data} />
    </div>
  );
}
