import type { SopListResponse } from '@h09a/types';
// import { getPublishedSops } from '@/lib/api';

const mockData: SopListResponse = {
  sops: [
    {
      id: '1',
      title: 'Reset Jira Password',
      workflow_category: null,
      step_count: 5,
      published_at: '2026-07-06T10:00:00Z',
    },
    {
      id: '2',
      title: 'Create New Employee Account',
      workflow_category: null,
      step_count: 8,
      published_at: '2026-07-05T15:30:00Z',
    },
    {
      id: '3',
      title: 'Submit Weekly Timesheet',
      workflow_category: null,
      step_count: 4,
      published_at: '2026-07-03T09:15:00Z',
    },
  ],
};

export default async function LibraryPage() {
  // TODO(H09AAPPLE-44):
  // Replace mock data with getPublishedSops() once frontend
  // authentication is available.
  // const data = await getPublishedSops();

  const data = mockData;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-6 text-3xl font-bold">SOP Library</h1>

      {data.sops.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold">
            No published SOPs yet.
          </h2>
          <p className="text-gray-500">
            Record your first workflow.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.sops.map((sop) => (
            <div
              key={sop.id}
              className="rounded-lg border p-5 shadow-sm transition hover:shadow-md"
            >
              <h2 className="mb-3 text-lg font-semibold">
                {sop.title}
              </h2>

              <p className="text-sm text-gray-600">
                {sop.step_count} steps
              </p>

              <p className="mt-2 text-sm text-gray-600">
                Published{' '}
                {sop.published_at
                  ? new Date(sop.published_at).toLocaleDateString()
                  : '-'}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}