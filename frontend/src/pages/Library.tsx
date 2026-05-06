import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Library() {
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.exams() });

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Question Library</h2>
      <p className="text-sm text-slate-600 mb-4">
        Filters by section/topic/year/difficulty arrive in Phase 4. For now,
        you can see ingested exams and their extraction status.
      </p>

      {exams.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {exams.isError && (
        <p className="text-sm text-red-600">
          {(exams.error as Error).message}
        </p>
      )}
      {exams.data && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Test</th>
              <th className="py-2 pr-4">Year</th>
              <th className="py-2 pr-4">Sitting</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">QP</th>
              <th className="py-2 pr-4">MS</th>
            </tr>
          </thead>
          <tbody>
            {exams.data.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-slate-500">
                  No exams uploaded yet.
                </td>
              </tr>
            ) : (
              exams.data.data.map((e) => (
                <tr key={e.id} className="border-b">
                  <td className="py-2 pr-4">{e.test_code}</td>
                  <td className="py-2 pr-4">{e.year}</td>
                  <td className="py-2 pr-4">{e.sitting}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        e.status === 'ready'
                          ? 'text-green-700'
                          : e.status === 'error'
                          ? 'text-red-600'
                          : 'text-slate-600'
                      }
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{e.source_pdf_path ? 'yes' : '—'}</td>
                  <td className="py-2 pr-4">{e.ms_pdf_path ? 'yes' : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
