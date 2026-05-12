import { useState } from 'react';
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

  // Remember the most recent export per draft id so each row can show
  // its own "Open QP / Open MS" links. We deliberately don't auto-open
  // both PDFs — most browsers' popup blockers reject the second
  // window.open() under a single user gesture and silently keep only one
  // of the two tabs open. Instead we auto-open the QP (a single tab is
  // never blocked) and surface the MS as an explicit link.
  const [exportedById, setExportedById] = useState<
    Record<string, { qp_uri: string; ms_uri: string }>
  >({});

  const exportDraft = useMutation({
    mutationFn: (id: string) => api.exportDraft(id),
    onSuccess: (out, id) => {
      setExportedById((prev) => ({ ...prev, [id]: out }));
      window.open(fileUrl(out.qp_uri), '_blank', 'noopener');
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
            drafts.data.data.map((d) => {
              const exported = exportedById[d.id];
              const exporting = exportDraft.isPending && exportDraft.variables === d.id;
              return (
                <li
                  key={d.id}
                  className="border rounded bg-white px-3 py-2 flex items-center justify-between gap-3"
                >
                  <Link to={`/builder/${d.id}`} className="font-medium">
                    {d.name}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {d.items.length} items · updated{' '}
                    {new Date(d.updated_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-3">
                    {exported ? (
                      <span className="flex items-center gap-2 text-xs text-emerald-700">
                        <a
                          className="underline hover:text-emerald-800"
                          href={fileUrl(exported.qp_uri)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open QP
                        </a>
                        <a
                          className="underline hover:text-emerald-800"
                          href={fileUrl(exported.ms_uri)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open MS
                        </a>
                        <button
                          onClick={() => exportDraft.mutate(d.id)}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                          disabled={exporting}
                        >
                          {exporting ? 'exporting…' : 're-export'}
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => exportDraft.mutate(d.id)}
                        disabled={exporting}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {exporting ? 'exporting…' : 'Export PDF'}
                      </button>
                    )}
                    <button
                      onClick={() => del.mutate(d.id)}
                      className="text-xs text-red-600 hover:underline"
                      disabled={del.isPending && del.variables === d.id}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
