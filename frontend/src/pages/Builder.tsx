import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DraftItem, SectionCode, TestCode } from '@esat/shared-types';
import {
  api,
  fileUrl,
  triggerDownload,
  type QuestionFilter,
  type QuestionListItem,
} from '../lib/api';
import { SECTION_CODES, SECTION_LABEL, TEST_CODES } from '../lib/labels';

interface ItemWithKey {
  key: string;
  item: DraftItem;
}

const newKey = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function Builder() {
  const { draftId } = useParams<{ draftId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('Untitled paper');
  const [timeLimit, setTimeLimit] = useState<number | ''>('');
  const [instructions, setInstructions] = useState('');
  const [items, setItems] = useState<ItemWithKey[]>([]);
  const [filter, setFilter] = useState<QuestionFilter>({ page: 1, limit: 100 });
  const [selected, setSelected] = useState<QuestionListItem | null>(null);
  const [tab, setTab] = useState<'q' | 'ms'>('q');

  const draft = useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => api.draft(draftId!),
    enabled: Boolean(draftId),
  });

  useEffect(() => {
    if (draft.data) {
      setName(draft.data.name);
      setTimeLimit(draft.data.time_limit_minutes ?? '');
      setInstructions(draft.data.instructions ?? '');
      setItems(draft.data.items.map((it) => ({ key: newKey('it'), item: it })));
    }
  }, [draft.data]);

  const topicsQ = useQuery({
    queryKey: ['topics', filter.section],
    queryFn: () => api.topics(filter.section),
  });
  const questionsQ = useQuery({
    queryKey: ['questions', filter],
    queryFn: () => api.questions(filter),
  });

  const idsInDraft = useMemo(
    () => new Set(items.flatMap((it) => (it.item.type === 'question' ? [it.item.question_id] : []))),
    [items],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const save = useMutation({
    mutationFn: async (): Promise<{ id: string }> => {
      const body = {
        name,
        items: items.map((it) => it.item),
        time_limit_minutes: timeLimit === '' ? null : Number(timeLimit),
        instructions: instructions.trim() === '' ? null : instructions,
      };
      return draftId ? api.patchDraft(draftId, body) : api.createDraft(body);
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
      qc.invalidateQueries({ queryKey: ['draft', out.id] });
      // First Save on a new draft created the row — push the URL forward
      // so the Export button (which needs draftId) can use it.
      if (!draftId && out.id) {
        navigate(`/builder/${out.id}`, { replace: true });
      }
    },
  });

  const [exportOpen, setExportOpen] = useState(false);
  const exportDraft = useMutation({
    mutationFn: async (opts: {
      mode: 'separate' | 'interleaved' | 'sequential';
      include_cover: boolean;
    }) => {
      // Auto-save if the draft hasn't been persisted yet — the Export
      // endpoint can only operate on a saved paper_drafts row. We pull
      // the current items / name straight from local state so the user
      // never has to think about the two-step Save → Export dance.
      let id = draftId;
      if (!id) {
        const created = await api.createDraft({
          name,
          items: items.map((it) => it.item),
          time_limit_minutes: timeLimit === '' ? null : Number(timeLimit),
          instructions: instructions.trim() === '' ? null : instructions,
        });
        id = created.id;
        qc.invalidateQueries({ queryKey: ['drafts'] });
        navigate(`/builder/${id}`, { replace: true });
      }
      return api.exportDraft(id, opts);
    },
    onSuccess: (out) => {
      // /files sends Content-Disposition: attachment for PDFs, so any
      // navigation to the URL triggers a download. window.open() is
      // unreliable here — browsers treat it as a popup when it fires
      // from an async fetch callback (the user-gesture has left the
      // stack), so the second open() in 'separate' mode gets blocked
      // even when the first slips through. A programmatic <a download>
      // click is the documented browser-friendly way to start a
      // download from JS without a popup-blocker hit.
      const downloads = [out.qp_uri, out.ms_uri, out.combined_uri]
        .filter((u): u is string => Boolean(u));
      for (const uri of downloads) triggerDownload(fileUrl(uri));
      setExportOpen(false);
    },
  });

  const addQuestion = (q: QuestionListItem) => {
    if (idsInDraft.has(q.id)) return;
    setItems((prev) => [...prev, { key: newKey('q'), item: { type: 'question', question_id: q.id } }]);
  };
  const addBlank = () =>
    setItems((prev) => [...prev, { key: newKey('blank'), item: { type: 'blank' } }]);
  const remove = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key));
  const clearItems = () => setItems([]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((it) => it.key === active.id);
      const to = prev.findIndex((it) => it.key === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const setF = <K extends keyof QuestionFilter>(k: K, v: QuestionFilter[K]) =>
    setFilter((f) => ({ ...f, [k]: v, page: 1 }));

  const total = questionsQ.data?.meta?.total ?? 0;
  const shown = questionsQ.data?.data.length ?? 0;

  return (
    <div className="grid h-full grid-cols-[minmax(420px,1fr)_2fr] gap-2 p-2">
      {/* LEFT: Questions list + Draft panel */}
      <div className="flex min-h-0 flex-col gap-2">
        <section className="flex min-h-0 flex-1 flex-col rounded border bg-white shadow-sm">
          <header className="flex items-center justify-between bg-purple-700 px-3 py-2 text-white">
            <h2 className="font-semibold">Questions</h2>
            <span className="text-xs opacity-80">
              {questionsQ.data ? `${shown} shown · ${total} total` : '…'}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-2 border-b bg-slate-50 p-2 text-sm">
            <select
              className="rounded border px-2 py-1"
              value={filter.test_code ?? ''}
              onChange={(e) =>
                setF('test_code', (e.target.value || undefined) as TestCode | undefined)
              }
            >
              <option value="">Any test</option>
              {TEST_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="rounded border px-2 py-1"
              value={filter.section ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  section: (e.target.value || undefined) as SectionCode | undefined,
                  topic_id: undefined,
                  page: 1,
                }))
              }
            >
              <option value="">Any section</option>
              {SECTION_CODES.map((c) => (
                <option key={c} value={c}>
                  {SECTION_LABEL[c]}
                </option>
              ))}
            </select>
            <select
              className="col-span-2 rounded border px-2 py-1"
              value={filter.topic_id ?? ''}
              onChange={(e) => setF('topic_id', e.target.value || undefined)}
            >
              <option value="">Any topic</option>
              {topicsQ.data?.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} · {t.name}
                </option>
              ))}
            </select>
            <input
              className="rounded border px-2 py-1"
              placeholder="Year"
              inputMode="numeric"
              value={filter.year ?? ''}
              onChange={(e) =>
                setF('year', e.target.value ? Number(e.target.value) : undefined)
              }
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={filter.categorised === 'false'}
                onChange={(e) =>
                  setF('categorised', e.target.checked ? 'false' : undefined)
                }
              />
              Uncategorised only
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {questionsQ.isLoading && (
              <div className="p-4 text-sm text-slate-500">Loading…</div>
            )}
            {!questionsQ.isLoading && shown === 0 && (
              <div className="p-4 text-sm text-slate-500">
                No questions match. Adjust filters or upload a paper.
              </div>
            )}
            <ul className="divide-y">
              {questionsQ.data?.data.map((q) => {
                const inDraft = idsInDraft.has(q.id);
                const isSelected = selected?.id === q.id;
                return (
                  <li
                    key={q.id}
                    onClick={() => {
                      setSelected(q);
                      setTab('q');
                    }}
                    className={`cursor-pointer px-3 py-2 ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 font-mono text-xs text-purple-900">
                          {SECTION_LABEL[q.section_code]}
                        </span>
                        <span className="font-semibold">Q{q.number}</span>
                        {q.answer_key && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-xs text-emerald-900">
                            key {q.answer_key}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-xs text-slate-500">
                        {q.test_code} {q.year} {q.sitting}
                      </span>
                    </div>
                    {q.summary && (
                      <div className="mt-1 line-clamp-2 text-xs text-slate-600">{q.summary}</div>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      {q.keywords && q.keywords.length > 0 && (
                        <span className="line-clamp-1">{q.keywords.slice(0, 4).join(' · ')}</span>
                      )}
                      <button
                        className={`ml-auto rounded px-2 py-0.5 text-xs ${inDraft ? 'bg-slate-100 text-slate-400' : 'bg-slate-200 hover:bg-slate-300'}`}
                        disabled={inDraft}
                        onClick={(e) => {
                          e.stopPropagation();
                          addQuestion(q);
                        }}
                      >
                        {inDraft ? 'added' : '+ draft'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {total > shown && (
              <div className="border-t bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
                Showing {shown} of {total} — refine filters to narrow.
              </div>
            )}
          </div>
        </section>

        <DraftPanel
          name={name}
          onName={setName}
          timeLimit={timeLimit}
          onTimeLimit={setTimeLimit}
          instructions={instructions}
          onInstructions={setInstructions}
          items={items}
          onDragEnd={onDragEnd}
          onRemove={remove}
          onClear={clearItems}
          onAddBlank={addBlank}
          onSave={() => save.mutate()}
          onExport={() => setExportOpen(true)}
          saving={save.isPending}
          savedId={draftId ?? null}
          exportPending={exportDraft.isPending}
          exportResult={exportDraft.data ?? null}
          previewedQuestionId={selected?.id ?? null}
          onPreview={async (id) => {
            if (selected?.id === id) return;
            const cached = qc.getQueryData<QuestionListItem>(['question', id]);
            if (cached) {
              setSelected(cached);
              setTab('q');
              return;
            }
            try {
              const r = await qc.fetchQuery({
                queryKey: ['question', id],
                queryFn: () => api.question(id),
              });
              setSelected(r);
              setTab('q');
            } catch {
              /* ignore */
            }
          }}
          sensors={sensors}
        />
      </div>

      {/* RIGHT: Content window */}
      <section className="flex min-h-0 flex-col rounded border bg-white shadow-sm">
        <header className="flex items-center gap-4 bg-purple-700 px-3 py-2 text-white">
          <h2 className="font-semibold">Content window</h2>
          {selected && (
            <span className="font-mono text-xs opacity-80">
              {selected.test_code} {selected.year} {selected.sitting} · {SECTION_LABEL[selected.section_code]} · Q{selected.number}
            </span>
          )}
          <nav className="ml-auto flex items-center gap-3 text-sm">
            <button
              className={tab === 'q' ? 'font-semibold underline underline-offset-4' : 'opacity-70'}
              onClick={() => setTab('q')}
            >
              Question
            </button>
            <button
              className={tab === 'ms' ? 'font-semibold underline underline-offset-4' : 'opacity-70'}
              onClick={() => setTab('ms')}
            >
              Mark Scheme
            </button>
          </nav>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
          {!selected && <div className="text-sm text-slate-500">Select a question from the list.</div>}
          {selected && tab === 'q' && selected.image_path && (
            <img
              src={fileUrl(selected.image_path)}
              alt="question"
              className="mx-auto max-w-3xl bg-white shadow"
            />
          )}
          {selected && tab === 'ms' && (
            <div className="mx-auto max-w-3xl rounded bg-white p-6 text-center shadow">
              <div className="text-xs uppercase tracking-wide text-slate-500">Answer key</div>
              <div className="mt-2 text-6xl font-bold text-emerald-600">
                {selected.answer_key ?? '—'}
              </div>
              {!selected.answer_key && (
                <div className="mt-3 text-xs text-slate-500">
                  No answer key recorded for this question.
                </div>
              )}
              {selected.summary && (
                <div className="mt-6 text-left text-sm text-slate-700">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Summary
                  </div>
                  {selected.summary}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          onSubmit={(opts) => exportDraft.mutate(opts)}
          pending={exportDraft.isPending}
        />
      )}
    </div>
  );
}

function ExportDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (opts: {
    mode: 'separate' | 'interleaved' | 'sequential';
    include_cover: boolean;
  }) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<'separate' | 'interleaved' | 'sequential'>('separate');
  const [includeCover, setIncludeCover] = useState(true);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[460px] rounded bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">Export draft</h3>
        <div className="space-y-2 text-sm">
          {(
            [
              { v: 'separate' as const, l: 'Separate paper + mark scheme PDFs' },
              { v: 'interleaved' as const, l: 'One PDF: Q1, MS1, Q2, MS2, …' },
              { v: 'sequential' as const, l: 'One PDF: all questions, then all answers' },
            ]
          ).map((o) => (
            <label key={o.v} className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === o.v}
                onChange={() => setMode(o.v)}
              />
              {o.l}
            </label>
          ))}
        </div>
        <div className="mt-4 border-t pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCover}
              onChange={(e) => setIncludeCover(e.target.checked)}
            />
            Include cover page
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2 text-sm">
          <button className="rounded px-3 py-1 hover:bg-slate-100" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-white disabled:bg-slate-400"
            disabled={pending}
            onClick={() => onSubmit({ mode, include_cover: includeCover })}
          >
            {pending ? 'Generating…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DraftPanel({
  name,
  onName,
  timeLimit,
  onTimeLimit,
  instructions,
  onInstructions,
  items,
  onDragEnd,
  onRemove,
  onClear,
  onAddBlank,
  onSave,
  onExport,
  saving,
  savedId,
  exportPending,
  exportResult,
  previewedQuestionId,
  onPreview,
  sensors,
}: {
  name: string;
  onName: (s: string) => void;
  timeLimit: number | '';
  onTimeLimit: (n: number | '') => void;
  instructions: string;
  onInstructions: (s: string) => void;
  items: ItemWithKey[];
  onDragEnd: (e: DragEndEvent) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onAddBlank: () => void;
  onSave: () => void;
  onExport: () => void;
  saving: boolean;
  savedId: string | null;
  exportPending: boolean;
  exportResult: {
    qp_uri?: string;
    ms_uri?: string;
    combined_uri?: string;
  } | null;
  previewedQuestionId: string | null;
  onPreview: (id: string) => void;
  sensors: ReturnType<typeof useSensors>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const empty = items.length === 0;
  const questionCount = items.filter((it) => it.item.type === 'question').length;
  const blankCount = items.length - questionCount;

  return (
    <section className="flex min-h-0 max-h-[45vh] flex-col rounded border bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 bg-purple-700 px-3 py-2 text-white">
        <h2 className="font-semibold">Draft paper</h2>
        <input
          ref={nameRef}
          className="flex-1 min-w-[12rem] rounded bg-purple-800 px-2 py-0.5 text-sm placeholder-purple-200"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Draft name"
        />
        <input
          className="w-20 rounded bg-purple-800 px-2 py-0.5 text-sm placeholder-purple-200"
          type="number"
          placeholder="min"
          value={timeLimit}
          onChange={(e) => onTimeLimit(e.target.value === '' ? '' : Number(e.target.value))}
          title="Time limit (minutes)"
        />
        <button
          className="rounded bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25"
          onClick={onAddBlank}
        >
          + blank
        </button>
        <button
          className="rounded bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25 disabled:opacity-40"
          onClick={onClear}
          disabled={empty}
        >
          Clear
        </button>
        <button
          className="rounded bg-white px-2 py-0.5 text-xs text-purple-900 hover:bg-slate-100 disabled:opacity-40"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : savedId ? 'Save' : 'Create draft'}
        </button>
        <button
          className="rounded bg-white px-2 py-0.5 text-xs text-purple-900 hover:bg-slate-100 disabled:opacity-40"
          onClick={onExport}
          disabled={empty || exportPending}
          title={empty ? 'Add at least one question first' : 'Export QP + MS PDFs'}
        >
          {exportPending ? 'Exporting…' : 'Export'}
        </button>
      </header>

      <div className="border-b bg-slate-50 px-3 py-1">
        <input
          className="w-full bg-transparent text-xs italic text-slate-600 placeholder-slate-400 focus:outline-none"
          placeholder="Instructions (optional)…"
          value={instructions}
          onChange={(e) => onInstructions(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {empty ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-slate-400">
            Click <span className="mx-1 font-mono">+ draft</span> on a question to add it here
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((it) => it.key)} strategy={verticalListSortingStrategy}>
              <ol>
                {items.map((it, idx) => (
                  <SortableDraftItem
                    key={it.key}
                    id={it.key}
                    item={it.item}
                    runningNumber={runningNumberFor(items, idx)}
                    isPreviewed={
                      it.item.type === 'question' && it.item.question_id === previewedQuestionId
                    }
                    onRemove={() => onRemove(it.key)}
                    onPreview={onPreview}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t bg-slate-50 px-3 py-1 text-xs text-slate-600">
        <span>
          Qs: <strong>{questionCount}</strong>
        </span>
        {blankCount > 0 && (
          <span>
            Blanks: <strong>{blankCount}</strong>
          </span>
        )}
        {exportResult && (
          <span className="ml-auto text-emerald-700">
            Exported · downloads opened in new tabs
          </span>
        )}
      </footer>
    </section>
  );
}

function runningNumberFor(items: ItemWithKey[], idx: number): number | null {
  if (items[idx]?.item.type !== 'question') return null;
  let n = 0;
  for (let i = 0; i <= idx; i++) {
    if (items[i]!.item.type === 'question') n += 1;
  }
  return n;
}

function SortableDraftItem({
  id,
  item,
  runningNumber,
  isPreviewed,
  onRemove,
  onPreview,
}: {
  id: string;
  item: DraftItem;
  runningNumber: number | null;
  isPreviewed: boolean;
  onRemove: () => void;
  onPreview: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (item.type === 'blank') {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-2 border-t bg-slate-100 px-3 py-2 text-sm italic text-slate-500"
      >
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-400 hover:text-slate-700"
          title="Drag to reorder"
        >
          ⋮⋮
        </button>
        <span className="w-6 font-mono text-xs">—</span>
        <span className="flex-1 truncate">— blank page —{item.label ? ` (${item.label})` : ''}</span>
        <button className="text-xs text-red-600 hover:underline" onClick={onRemove}>
          remove
        </button>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={() => onPreview(item.question_id)}
      title="Click to preview"
      className={`flex cursor-pointer items-center gap-2 border-t px-3 py-2 text-sm ${isPreviewed ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab text-slate-400 hover:text-slate-700"
        title="Drag to reorder"
      >
        ⋮⋮
      </button>
      <span className="w-6 font-mono text-xs text-slate-500">{runningNumber}.</span>
      <DraftQuestionPreview questionId={item.question_id} />
      <button
        className="text-xs text-red-600 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        remove
      </button>
    </li>
  );
}

function DraftQuestionPreview({ questionId }: { questionId: string }) {
  const q = useQuery({
    queryKey: ['question', questionId],
    queryFn: () => api.question(questionId),
    staleTime: 60_000,
  });
  if (q.isLoading) return <span className="flex-1 text-xs text-slate-400">loading…</span>;
  if (q.isError || !q.data)
    return <span className="flex-1 text-xs text-red-600">load failed</span>;
  return (
    <span className="flex-1 truncate">
      <span className="font-mono text-xs text-slate-500">
        {q.data.test_code} {q.data.year} {q.data.sitting} · {SECTION_LABEL[q.data.section_code]} · Q
        {q.data.number}
      </span>
      {q.data.summary && (
        <span className="ml-2 text-xs text-slate-600">— {q.data.summary}</span>
      )}
    </span>
  );
}
