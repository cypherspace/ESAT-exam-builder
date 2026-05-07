import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, fileUrl } from '../lib/api';

export function Drafts() {
  const qc = useQueryClient();
  const drafts = useQuery({ queryKey: ['drafts'], queryFn: () => api.drafts() });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteDraft(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drafts'] }),
  });
  const exportDraft = useMutation({
    mutationFn: (id: string) => api.exportDraft(id),
    onSuccess: (out) => {
      // Open every URL the API returned. Default mode 'separate' returns
      // qp + ms; combined modes return combined_uri.
      if (out.qp_uri) window.open(fileUrl(out.qp_uri), '_blank');
      if (out.ms_uri) window.open(fileUrl(out.ms_uri), '_blank');
      if (out.combined_uri) window.open(fileUrl(out.combined_uri), '_blank');
    },
  });

  return (
    <div className="grid gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Drafts</h2>
        <Link to="/builder" className="text-sm text-blue-600 hover:underline">
          + New
        </Link>
      </header>
      {drafts.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {drafts.isError && (
        <p className="text-sm text-red-600">{(drafts.error as Error).message}</p>
      )}
      {drafts.data && (
        <ul className="grid gap-2">
          {drafts.data.data.length === 0 ? (
            <li className="text-sm text-slate-500">No drafts yet.</li>
          ) : (
            drafts.data.data.map((d) => (
              <li
                key={d.id}
                className="border rounded bg-white px-3 py-2 flex items-center justify-between"
              >
                <Link to={`/builder/${d.id}`} className="font-medium">
                  {d.name}
                </Link>
                <span className="text-xs text-slate-500">
                  {d.items.length} items · updated {new Date(d.updated_at).toLocaleDateString()}
                </span>
                <div className="flex gap-3">
                  <button
                    onClick={() => exportDraft.mutate(d.id)}
                    disabled={exportDraft.isPending && exportDraft.variables === d.id}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {exportDraft.isPending && exportDraft.variables === d.id
                      ? 'exporting…'
                      : 'Export PDF'}
                  </button>
                  <button
                    onClick={() => del.mutate(d.id)}
                    className="text-xs text-red-600 hover:underline"
                    disabled={del.isPending && del.variables === d.id}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
