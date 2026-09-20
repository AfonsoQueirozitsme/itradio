import { getJobsData } from "../../_lib/jobs";
import { PageHeader } from "../_components/ui";
import JobsBoard from "../_components/jobs-board";

export default async function JobsPage() {
  const data = await getJobsData();

  return (
    <div className="space-y-4">
      <PageHeader crumb="Jobs" title="Jobs & agenda" />
      <JobsBoard data={data} />
    </div>
  );
}
