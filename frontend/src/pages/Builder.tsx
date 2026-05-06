import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { DraftItem, SectionCode } from '@esat/shared-types';
import { api, fileUrl, type QuestionFilter, type QuestionListItem } from '../lib/api';
import { SECTION_CODES, SECTION_LABEL, TEST_CODES } from '../lib/labels';

interface ItemWithKey {
  key: string;
  item: DraftItem;
}

export function Builder() {
  const { draftId } = useParams<{ draftId?: string }>();
  const qc = useQueryClient();

  const [name, setName] = useState('Untitled paper');
  const [timeLimit, setTimeLimit] = useState<number | ''>('');
  const [instructions, setInstructions] = useState('');
  const [items, setItems] = useState<ItemWithKey[]>([]);
  const [filter, setFilter] = useState<QuestionFilter>({ page: 1, limit: 20 });

  const draft = useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => api.draft(draftId!),
    enabled: Boolean(draftId),
  });

  // Hydrate the form once the draft loads.
  useEffect(() => {
    if (draft.data) {
      setName(draft.data.name);
      setTimeLimit(draft.data.time_limit_minutes ?? '');
      setInstructions(draft.data.instructions ?? '');
      setItems(
        draft.data.items.map((it, i) => ({ key: `${i}-${Math.random().toString(36).slice(2, 8)}`, item: it })),
      );
    }
  }, [draft.data]);

  const questions = useQuery({
    queryKey: ['questions', filter],
    queryFn: () => api.questions(filter),
  });

  const idsInDraft = useMemo(
    () => new Set(items.flatMap((it) => (it.item.type === 'question' ? [it.item.question_id] : []))),
    [items],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        items: items.map((it) => it.item),
        time_limit_minutes: timeLimit === '' ? null : Number(timeLimit),
        instructions: instructions.trim() === '' ? null : instructions,
      };
      if (draftId) {
        return api.patchDraft(draftId, body);
      }
      return api.createDraft(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
      qc.invalidateQueries({ queryKey: ['draft', draftId] });
    },
  });

  function addQuestion(q: QuestionListItem) {
    if (idsInDraft.has(q.id)) return;
    setItems((prev) => [
      ...prev,
      {
        key: `q-${q.id}-${Date.now()}`,
        item: { type: 'question', question_id: q.id },
      },
    ]);
  }

  function addBlank() {
    setItems((prev) => [
      ...prev,
      { key: `blank-${Date.now()}`, item: { type: 'blank' } },
    ]);
  }

  function remove(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((it) => it.key === active.id);
      const to = prev.findIndex((it) => it.key === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
      {/* Left: draft state + draft items */}
      <section className="grid gap-3">
        <header className="grid gap-2">
          <input
            className="text-xl font-semibold border-b border-transparent focus:border-slate-300 focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-slate-500">Time limit (min)</span>
              <input
                type="number"
                className="border rounded px-2 py-1 w-28"
                value={timeLimit}
                onChange={(e) =>
                  setTimeLimit(e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
            <label className="grid gap-1 flex-1">
              <span className="text-xs text-slate-500">Instructions</span>
              <input
                className="border rounded px-2 py-1"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="bg-blue-600 text-white rounded px-3 py-1.5 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : draftId ? 'Save' : 'Create draft'}
            </button>
            <button
              onClick={addBlank}
              className="border rounded px-3 py-1.5 text-slate-700"
            >
              + Blank slot
            </button>
            {save.isSuccess && !draftId && (
              <span className="text-xs text-green-700 self-center">
                Created — open under the Builder route to keep editing.
              </span>
            )}
            {save.isError && (
              <span className="text-xs text-red-600 self-center">
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </header>

        <div className="text-xs text-slate-500">
          {items.length} item{items.length === 1 ? '' : 's'}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((it) => it.key)} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-2">
              {items.map((it, idx) => (
                <DraftRow
                  key={it.key}
                  id={it.key}
                  item={it.item}
                  display={idx + 1}
                  onRemove={() => remove(it.key)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </section>

      {/* Right: question picker */}
      <section className="grid gap-2">
        <h3 className="text-lg font-semibold">Add questions</h3>
        <FilterRow filter={filter} onFilter={setFilter} />
        {questions.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {questions.isError && (
          <p className="text-sm text-red-600">{(questions.error as Error).message}</p>
        )}
        {questions.data && (
          <ul className="grid gap-2">
            {questions.data.data.map((q) => (
              <li key={q.id} className="border rounded p-2 flex gap-3 bg-white">
                {q.image_path && (
                  <img
                    src={fileUrl(q.image_path)}
                    alt=""
                    className="w-32 h-auto object-contain border border-slate-100 rounded"
                    loading="lazy"
                  />
                )}
                <div className="flex-1 grid gap-1 min-w-0">
                  <div className="text-xs text-slate-500">
                    {q.test_code} {q.year} {q.sitting} · {SECTION_LABEL[q.section_code]} ·
                    Q{q.number}
                    {q.difficulty ? ` · ★ ${q.difficulty}` : ''}
                  </div>
                  <div className="text-sm">{q.summary ?? '(no summary)'}</div>
                </div>
                <button
                  onClick={() => addQuestion(q)}
                  disabled={idsInDraft.has(q.id)}
                  className="self-center text-sm border rounded px-2 py-1 disabled:opacity-40"
                >
                  {idsInDraft.has(q.id) ? 'Added' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DraftRow({
  id,
  item,
  display,
  onRemove,
}: {
  id: string;
  item: DraftItem;
  display: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border rounded p-2 bg-white flex items-center gap-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-400"
        aria-label="reorder"
      >
        ⋮⋮
      </button>
      <span className="text-xs text-slate-500 w-6 text-right">{display}</span>
      {item.type === 'question' ? (
        <QuestionPreview questionId={item.question_id} />
      ) : (
        <span className="flex-1 text-sm italic text-slate-500">
          Blank slot{item.label ? ` — ${item.label}` : ''}
        </span>
      )}
      <button onClick={onRemove} className="text-xs text-red-600 hover:underline">
        Remove
      </button>
    </li>
  );
}

function QuestionPreview({ questionId }: { questionId: string }) {
  const q = useQuery({
    queryKey: ['question', questionId],
    queryFn: () => api.question(questionId),
    staleTime: 60_000,
  });
  if (q.isLoading) return <span className="text-sm text-slate-400">loading…</span>;
  if (q.isError) return <span className="text-sm text-red-600">load failed</span>;
  if (!q.data) return null;
  return (
    <div className="flex-1 grid gap-0.5 min-w-0">
      <div className="text-xs text-slate-500">
        {q.data.test_code} {q.data.year} {q.data.sitting} ·{' '}
        {SECTION_LABEL[q.data.section_code]} · Q{q.data.number}
      </div>
      <div className="text-sm truncate">{q.data.summary ?? '(no summary)'}</div>
    </div>
  );
}

function FilterRow({
  filter,
  onFilter,
}: {
  filter: QuestionFilter;
  onFilter: (f: QuestionFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <select
        className="border rounded px-2 py-1"
        value={filter.test_code ?? ''}
        onChange={(e) => onFilter({ ...filter, test_code: (e.target.value || undefined) as typeof filter.test_code, page: 1 })}
      >
        <option value="">all tests</option>
        {TEST_CODES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select
        className="border rounded px-2 py-1"
        value={filter.section ?? ''}
        onChange={(e) =>
          onFilter({ ...filter, section: (e.target.value || undefined) as SectionCode | undefined, topic_id: undefined, page: 1 })
        }
      >
        <option value="">all sections</option>
        {SECTION_CODES.map((c) => (
          <option key={c} value={c}>{SECTION_LABEL[c]}</option>
        ))}
      </select>
      <input
        className="border rounded px-2 py-1 w-24"
        type="number"
        placeholder="year"
        value={filter.year ?? ''}
        onChange={(e) =>
          onFilter({ ...filter, year: e.target.value ? Number(e.target.value) : undefined, page: 1 })
        }
      />
    </div>
  );
}
