import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Difficulty,
  ExamStatus,
  SectionCode,
  TestCode,
} from '@esat/shared-types';
import { api, fileUrl, type QuestionFilter, type QuestionListItem } from '../lib/api';
import { SECTION_CODES, SECTION_LABEL, TEST_CODES } from '../lib/labels';

const STATUS_STYLE: Record<ExamStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  extracting: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-700',
};

export function Library() {
  const [filter, setFilter] = useState<QuestionFilter>({ page: 1, limit: 24 });
  const exams = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.exams(),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const inFlight = data.data.some(
        (e) => e.status === 'pending' || e.status === 'extracting',
      );
      return inFlight ? 2000 : false;
    },
  });

  const topics = useQuery({
    queryKey: ['topics', filter.section ?? 'all'],
    queryFn: () => api.topics(filter.section),
  });

  const questions = useQuery({
    queryKey: ['questions', filter],
    queryFn: () => api.questions(filter),
  });

  function update<K extends keyof QuestionFilter>(key: K, value: QuestionFilter[K]) {
    setFilter((f) => ({ ...f, [key]: value, page: 1 }));
  }

  return (
    <div className="grid gap-6">
      <ExamStrip
        exams={exams.data?.data ?? []}
        loading={exams.isLoading}
        error={exams.isError ? (exams.error as Error).message : null}
      />

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Question Library</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Select<TestCode | ''>
            label="Test"
            value={filter.test_code ?? ''}
            onChange={(v) => update('test_code', v || undefined)}
            options={[['', 'all'], ...TEST_CODES.map((c) => [c, c] as [TestCode, string])]}
          />
          <Select<SectionCode | ''>
            label="Section"
            value={filter.section ?? ''}
            onChange={(v) => {
              setFilter((f) => ({
                ...f,
                section: v || undefined,
                topic_id: undefined,
                page: 1,
              }));
            }}
            options={[['', 'all'], ...SECTION_CODES.map((c) => [c, SECTION_LABEL[c]] as [SectionCode, string])]}
          />
          <Select<string>
            label="Topic"
            value={filter.topic_id ?? ''}
            onChange={(v) => update('topic_id', v || undefined)}
            options={[
              ['', 'all'],
              ...(topics.data?.data ?? []).map(
                (t) => [t.id, `${t.code}. ${t.name}`] as [string, string],
              ),
            ]}
            disabled={!filter.section}
          />
          <NumberInput
            label="Year"
            value={filter.year ?? ''}
            onChange={(v) => update('year', v ? Number(v) : undefined)}
          />
          <Select<string>
            label="Min difficulty"
            value={String(filter.difficulty_min ?? '')}
            onChange={(v) =>
              update('difficulty_min', v ? (Number(v) as Difficulty) : undefined)
            }
            options={[['', 'any'], ...['1', '2', '3', '4', '5'].map((d) => [d, d] as [string, string])]}
          />
          <Select<string>
            label="Max difficulty"
            value={String(filter.difficulty_max ?? '')}
            onChange={(v) =>
              update('difficulty_max', v ? (Number(v) as Difficulty) : undefined)
            }
            options={[['', 'any'], ...['1', '2', '3', '4', '5'].map((d) => [d, d] as [string, string])]}
          />
        </div>

        {questions.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {questions.isError && (
          <p className="text-sm text-red-600">{(questions.error as Error).message}</p>
        )}
        {questions.data && (
          <>
            <p className="text-xs text-slate-500">
              {questions.data.meta.total} matches
              {questions.data.meta.total > questions.data.data.length
                ? ` · showing ${questions.data.data.length}`
                : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {questions.data.data.map((q) => (
                <QuestionCard key={q.id} q={q} />
              ))}
            </div>
            <Pagination
              page={questions.data.meta.page}
              limit={questions.data.meta.limit}
              total={questions.data.meta.total}
              onPage={(p) => setFilter((f) => ({ ...f, page: p }))}
            />
          </>
        )}
      </section>
    </div>
  );

  function ExamStrip({
    exams,
    loading,
    error,
  }: {
    exams: { id: string; test_code: TestCode; year: number; sitting: string; status: ExamStatus }[];
    loading: boolean;
    error: string | null;
  }) {
    return (
      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Ingested exams</h3>
          {loading && <span className="text-xs text-slate-500">loading…</span>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {exams.length === 0 && !loading && (
            <span className="text-sm text-slate-500">None yet — head to Upload.</span>
          )}
          {exams.map((e) => (
            <span
              key={e.id}
              className={`inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs ${STATUS_STYLE[e.status]}`}
            >
              <span className="font-medium text-slate-700">
                {e.test_code} {e.year} {e.sitting}
              </span>
              <span>· {e.status}</span>
            </span>
          ))}
        </div>
      </section>
    );
  }
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <select
        className="border rounded px-2 py-1 disabled:bg-slate-50 disabled:text-slate-400"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <input
        type="number"
        className="border rounded px-2 py-1 w-24"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function QuestionCard({ q }: { q: QuestionListItem }) {
  const qc = useQueryClient();
  const [showFlag, setShowFlag] = useState(false);
  const [note, setNote] = useState('');

  const flag = useMutation({
    mutationFn: (n: string) => api.flagQuestion(q.id, n),
    onSuccess: () => {
      setNote('');
      setShowFlag(false);
      qc.invalidateQueries({ queryKey: ['flags'] });
    },
  });

  const meta = useMemo(
    () => [
      `${q.test_code} ${q.year} ${q.sitting}`,
      SECTION_LABEL[q.section_code],
      `Q${q.number}`,
      q.difficulty ? `★ ${q.difficulty}` : null,
      q.answer_key ? `key ${q.answer_key}` : null,
    ].filter(Boolean).join(' · '),
    [q],
  );

  return (
    <article className="border rounded bg-white p-3 grid gap-2">
      <div className="text-xs text-slate-500">{meta}</div>
      {q.image_path ? (
        <a href={fileUrl(q.image_path)} target="_blank" rel="noreferrer">
          <img
            src={fileUrl(q.image_path)}
            alt={`Q${q.number}`}
            className="w-full rounded border border-slate-100"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="text-xs text-slate-400 italic">no clip</div>
      )}
      {q.summary && <div className="text-sm">{q.summary}</div>}
      {q.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {q.keywords.map((k) => (
            <span key={k} className="text-xs bg-slate-100 rounded px-1.5 py-0.5">
              {k}
            </span>
          ))}
        </div>
      )}
      <div className="flex justify-between text-xs">
        <a href={`/edit/${q.id}`} className="text-blue-600 hover:underline">
          Edit
        </a>
        <button
          type="button"
          onClick={() => setShowFlag((s) => !s)}
          className="text-amber-700 hover:underline"
        >
          Flag
        </button>
      </div>
      {showFlag && (
        <form
          className="grid gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) flag.mutate(note);
          }}
        >
          <textarea
            className="border rounded p-1 text-xs"
            rows={2}
            placeholder="What's wrong with this question?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="submit"
            className="bg-amber-600 text-white text-xs rounded px-2 py-1 disabled:opacity-50"
            disabled={!note.trim() || flag.isPending}
          >
            {flag.isPending ? 'Submitting…' : 'Submit flag'}
          </button>
        </form>
      )}
    </article>
  );
}

function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const last = Math.max(1, Math.ceil(total / limit));
  if (last <= 1) return null;
  return (
    <div className="flex justify-center gap-2 text-sm">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="px-2 py-1 border rounded disabled:opacity-50"
      >
        ← Prev
      </button>
      <span className="px-2 py-1 text-slate-600">
        page {page} / {last}
      </span>
      <button
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
        className="px-2 py-1 border rounded disabled:opacity-50"
      >
        Next →
      </button>
    </div>
  );
}
