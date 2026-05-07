import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AnswerKey } from '@esat/shared-types';
import { api, fileUrl } from '../lib/api';
import { SECTION_LABEL } from '../lib/labels';

// Cambridge admissions papers use up to ~8 options on some questions.
// Show the full A–H range in the picker; the DB enum already covers A–Z.
const ANSWER_KEYS: AnswerKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function Edit() {
  const { questionId } = useParams<{ questionId: string }>();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['question', questionId],
    queryFn: () => api.question(questionId!),
    enabled: Boolean(questionId),
  });

  const topics = useQuery({
    queryKey: ['topics', q.data?.section_code ?? 'none'],
    queryFn: () => api.topics(q.data?.section_code),
    enabled: Boolean(q.data?.section_code),
  });

  const [answerKey, setAnswerKey] = useState<AnswerKey | ''>('');
  const [topicId, setTopicId] = useState<string>('');
  const [summary, setSummary] = useState('');
  const [keywords, setKeywords] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setAnswerKey(q.data.answer_key ?? '');
    setTopicId(q.data.topic_id ?? '');
    setSummary(q.data.summary ?? '');
    setKeywords(q.data.keywords.join(', '));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patchQuestion(questionId!, {
        answer_key: answerKey === '' ? null : answerKey,
        topic_id: topicId === '' ? null : topicId,
        summary: summary.trim() === '' ? null : summary,
        keywords: keywords
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['question', questionId] });
      qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (q.isError) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  if (!q.data) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">
          {q.data.test_code} {q.data.year} {q.data.sitting} · {SECTION_LABEL[q.data.section_code]}
          {' '}· Q{q.data.number}
        </h2>
        {q.data.image_path ? (
          <img
            src={fileUrl(q.data.image_path)}
            alt=""
            className="border rounded max-w-full"
          />
        ) : (
          <p className="text-sm text-slate-500 italic">no clipped image on record</p>
        )}
        {q.data.ocr_text && (
          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer">OCR text</summary>
            <pre className="whitespace-pre-wrap mt-1 bg-slate-50 p-2 rounded border">
              {q.data.ocr_text}
            </pre>
          </details>
        )}
      </div>

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="grid gap-1">
          <span className="text-sm font-medium">Answer key</span>
          <select
            className="border rounded px-2 py-1"
            value={answerKey}
            onChange={(e) => setAnswerKey(e.target.value as AnswerKey | '')}
          >
            <option value="">— unset —</option>
            {ANSWER_KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Topic</span>
          <select
            className="border rounded px-2 py-1"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
          >
            <option value="">— unset —</option>
            {(topics.data?.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}. {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Summary</span>
          <textarea
            className="border rounded px-2 py-1"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Keywords (comma-separated)</span>
          <input
            className="border rounded px-2 py-1"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>

        <button
          type="submit"
          disabled={save.isPending}
          className="bg-blue-600 text-white rounded px-3 py-2 disabled:opacity-50 justify-self-start"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {save.isError && (
          <p className="text-sm text-red-600">{(save.error as Error).message}</p>
        )}
        {save.isSuccess && (
          <p className="text-sm text-green-700">Saved.</p>
        )}
      </form>
    </div>
  );
}
