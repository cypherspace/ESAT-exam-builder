import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TestCode } from '@esat/shared-types';
import { api } from '../lib/api';

const TEST_CODES: TestCode[] = ['ESAT', 'ENGAA', 'NSAA'];

export function Upload() {
  const qc = useQueryClient();
  const [testCode, setTestCode] = useState<TestCode>('ESAT');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [sitting, setSitting] = useState('October');
  const [qp, setQp] = useState<File | null>(null);
  const [ms, setMs] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: api.uploadExam,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] });
      window.dispatchEvent(new CustomEvent('esat:exam-uploaded'));
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!qp) return;
    mutation.mutate({ test_code: testCode, year, sitting, qp, ms });
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">Upload Past Paper</h2>
      <p className="text-sm text-slate-600 mb-4">
        Drop a question paper PDF + (optional) mark scheme PDF. The MS answer
        key is parsed inline; full clipping runs in Phase 2.
      </p>
      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Test</span>
          <select
            className="border rounded px-2 py-1"
            value={testCode}
            onChange={(e) => setTestCode(e.target.value as TestCode)}
          >
            {TEST_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Year</span>
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Sitting</span>
          <input
            type="text"
            className="border rounded px-2 py-1"
            value={sitting}
            onChange={(e) => setSitting(e.target.value)}
            placeholder="October / Specimen / etc."
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Question paper PDF (required)</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setQp(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Mark scheme PDF (optional)</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setMs(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          disabled={!qp || mutation.isPending}
          className="bg-blue-600 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {mutation.isPending ? 'Uploading…' : 'Upload'}
        </button>
        {mutation.isError && (
          <p className="text-sm text-red-600">
            {(mutation.error as Error).message}
          </p>
        )}
        {mutation.isSuccess && (
          <p className="text-sm text-green-700">
            Created exam {mutation.data.id} ({mutation.data.status}).
          </p>
        )}
      </form>
    </div>
  );
}
