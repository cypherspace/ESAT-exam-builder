import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Exam, ExamStatus } from '@esat/shared-types';
import { api } from '../lib/api';

const STATUS_STYLE: Record<ExamStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  extracting: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-700',
};

export function Library() {
  const qc = useQueryClient();
  const exams = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.exams(),
    // Poll while anything is mid-extract so the status pill updates live.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const inFlight = data.data.some(
        (e) => e.status === 'pending' || e.status === 'extracting',
      );
      return inFlight ? 2000 : false;
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.retryExtract(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exams'] }),
  });

  // Bust the query cache when a fresh upload finishes so totals update
  // even if the polling interval is paused.
  useEffect(() => {
    function onUploaded() {
      qc.invalidateQueries({ queryKey: ['exams'] });
    }
    window.addEventListener('esat:exam-uploaded', onUploaded);
    return () => window.removeEventListener('esat:exam-uploaded', onUploaded);
  }, [qc]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Question Library</h2>
      <p className="text-sm text-slate-600 mb-4">
        Filters by section/topic/year/difficulty arrive in Phase 4. For now
        you can see ingested exams and their extraction status. Click
        <span className="px-1 font-mono">Retry</span> on a row to re-run
        the clipper after tuning the extractor heuristics.
      </p>

      {exams.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {exams.isError && (
        <p className="text-sm text-red-600">{(exams.error as Error).message}</p>
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
              <th className="py-2 pr-4 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {exams.data.data.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-slate-500">
                  No exams uploaded yet.
                </td>
              </tr>
            ) : (
              exams.data.data.map((e) => <ExamRow key={e.id} exam={e} retry={retry} />)
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ExamRow({
  exam,
  retry,
}: {
  exam: Exam;
  retry: ReturnType<typeof useMutation<{ questions_inserted: number; warnings: string[] }, Error, string>>;
}) {
  const detail = useQuery({
    queryKey: ['exam', exam.id],
    queryFn: () => api.exam(exam.id),
    enabled: exam.status === 'ready',
    staleTime: 30_000,
  });
  const counts = detail.data?.sections ?? [];
  const totalQs = counts.reduce((sum, s) => sum + (s.question_count ?? 0), 0);
  return (
    <>
      <tr className="border-b">
        <td className="py-2 pr-4">{exam.test_code}</td>
        <td className="py-2 pr-4">{exam.year}</td>
        <td className="py-2 pr-4">{exam.sitting}</td>
        <td className="py-2 pr-4">
          <span
            className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[exam.status]}`}
          >
            {exam.status}
            {exam.status === 'ready' && totalQs > 0 ? ` · ${totalQs} qs` : ''}
          </span>
        </td>
        <td className="py-2 pr-4">{exam.source_pdf_path ? 'yes' : '—'}</td>
        <td className="py-2 pr-4">{exam.ms_pdf_path ? 'yes' : '—'}</td>
        <td className="py-2 pr-4">
          <button
            type="button"
            onClick={() => retry.mutate(exam.id)}
            disabled={retry.isPending && retry.variables === exam.id}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {retry.isPending && retry.variables === exam.id ? 'retrying…' : 'Retry'}
          </button>
        </td>
      </tr>
      {exam.status === 'ready' && counts.length > 0 && (
        <tr>
          <td colSpan={7} className="pb-2 pl-2 text-xs text-slate-500">
            {counts
              .filter((s) => (s.question_count ?? 0) > 0)
              .map((s) => `${s.code}: ${s.question_count}`)
              .join('  ·  ') || 'no questions clipped'}
          </td>
        </tr>
      )}
    </>
  );
}
