import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Difficulty, SectionCode, TestCode } from '@esat/shared-types';
import { api } from '../lib/api';
import { SECTION_LABEL, SECTION_CODES, TEST_CODES } from '../lib/labels';

interface SectionRow {
  enabled: boolean;
  count: number;
  difficulty_min: Difficulty | '';
  difficulty_max: Difficulty | '';
}

export function Generate() {
  const nav = useNavigate();
  const [testCode, setTestCode] = useState<TestCode>('ESAT');
  const [name, setName] = useState('');
  const [avoidDup, setAvoidDup] = useState(true);
  const [rows, setRows] = useState<Record<SectionCode, SectionRow>>(
    Object.fromEntries(
      SECTION_CODES.map((c) => [
        c,
        { enabled: false, count: 10, difficulty_min: '', difficulty_max: '' },
      ]),
    ) as Record<SectionCode, SectionRow>,
  );

  const run = useMutation({
    mutationFn: () => {
      const section_mix: Parameters<typeof api.generate>[0]['section_mix'] = {};
      for (const code of SECTION_CODES) {
        const r = rows[code];
        if (!r.enabled) continue;
        const range =
          r.difficulty_min !== '' && r.difficulty_max !== ''
            ? ([r.difficulty_min, r.difficulty_max] as [Difficulty, Difficulty])
            : undefined;
        section_mix[code] = { count: r.count, difficulty_range: range };
      }
      return api.generate({
        test_code: testCode,
        name: name || undefined,
        section_mix,
        avoid_duplicate_topics: avoidDup,
        save_as_draft: true,
      });
    },
    onSuccess: (out) => {
      if (out.draft_id) nav(`/builder/${out.draft_id}`);
    },
  });

  function update(code: SectionCode, patch: Partial<SectionRow>) {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  return (
    <div className="grid gap-4 max-w-2xl">
      <h2 className="text-xl font-semibold">Random paper</h2>
      <p className="text-sm text-slate-600">
        Picks questions matching the per-section constraints, optionally
        avoiding repeated topics. Saves a draft and opens it in the Builder.
      </p>

      <div className="flex gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-slate-600">Test</span>
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
        <label className="grid gap-1 flex-1">
          <span className="text-xs text-slate-600">Draft name</span>
          <input
            className="border rounded px-2 py-1"
            value={name}
            placeholder={`Generated ${testCode} paper`}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="self-end flex items-center gap-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={avoidDup}
            onChange={(e) => setAvoidDup(e.target.checked)}
          />
          avoid duplicate topics
        </label>
      </div>

      <table className="text-sm border-collapse w-full">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-3">Section</th>
            <th className="py-2 pr-3">Include</th>
            <th className="py-2 pr-3">Count</th>
            <th className="py-2 pr-3">Min ★</th>
            <th className="py-2 pr-3">Max ★</th>
          </tr>
        </thead>
        <tbody>
          {SECTION_CODES.map((code) => {
            const r = rows[code];
            return (
              <tr key={code} className="border-b">
                <td className="py-2 pr-3">{SECTION_LABEL[code]}</td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => update(code, { enabled: e.target.checked })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-20"
                    value={r.count}
                    min={1}
                    max={200}
                    disabled={!r.enabled}
                    onChange={(e) => update(code, { count: Number(e.target.value) })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <select
                    className="border rounded px-2 py-1"
                    value={String(r.difficulty_min)}
                    disabled={!r.enabled}
                    onChange={(e) =>
                      update(code, {
                        difficulty_min:
                          e.target.value === '' ? '' : (Number(e.target.value) as Difficulty),
                      })
                    }
                  >
                    <option value="">any</option>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <select
                    className="border rounded px-2 py-1"
                    value={String(r.difficulty_max)}
                    disabled={!r.enabled}
                    onChange={(e) =>
                      update(code, {
                        difficulty_max:
                          e.target.value === '' ? '' : (Number(e.target.value) as Difficulty),
                      })
                    }
                  >
                    <option value="">any</option>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center gap-3">
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="bg-blue-600 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {run.isPending ? 'Generating…' : 'Generate'}
        </button>
        {run.isError && (
          <span className="text-sm text-red-600">{(run.error as Error).message}</span>
        )}
        {run.data && (
          <span className="text-sm text-slate-600">
            picked {run.data.question_ids.length} questions
            {run.data.unfilled.length > 0
              ? ` · ${run.data.unfilled.length} sections short`
              : ''}
          </span>
        )}
      </div>
    </div>
  );
}
