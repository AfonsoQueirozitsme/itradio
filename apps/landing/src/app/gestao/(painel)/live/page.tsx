import { getLiveData } from "../../_lib/live";
import { getSettingsData } from "../../_lib/settings";
import LiveConsole from "../_components/live-console";

export default async function LivePage() {
  const [data, settings] = await Promise.all([getLiveData(), getSettingsData()]);
  return <LiveConsole data={data} pads={settings.pads} />;
}
