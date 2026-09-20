import { getSegmentosData } from "../../_lib/segmentos";
import { PageHeader } from "../_components/ui";
import SegmentosBoard from "../_components/segmentos-board";

export default async function SegmentosPage() {
  const data = await getSegmentosData();

  return (
    <div className="space-y-4">
      <PageHeader crumb="Segmentos" title="Segmentos" />
      <SegmentosBoard data={data} />
    </div>
  );
}
