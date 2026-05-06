import { Router } from 'express';
import { query } from '../db.js';
import { composeDraft } from '../services/pdf-composer.js';

export const exportRouter = Router();

interface DraftItem {
  type: 'question' | 'blank';
  question_id?: string;
  label?: string;
}

interface DraftRow {
  id: string;
  name: string;
  items: DraftItem[];
  time_limit_minutes: number | null;
  instructions: string | null;
}

exportRouter.post('/draft/:id', async (req, res, next) => {
  try {
    const row = await query<DraftRow>(
      `SELECT id, name, items, time_limit_minutes, instructions
       FROM paper_drafts WHERE id = $1`,
      [req.params.id],
    );
    const draft = row.rows[0];
    if (!draft) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const items = Array.isArray(draft.items) ? draft.items : [];
    const questionIds = items
      .filter((it): it is DraftItem & { question_id: string } =>
        it.type === 'question' && typeof it.question_id === 'string',
      )
      .map((it) => it.question_id);

    if (questionIds.length === 0) {
      res.status(400).json({ error: 'empty_draft' });
      return;
    }

    const out = await composeDraft({
      draftId: draft.id,
      title: draft.name,
      timeLimitMinutes: draft.time_limit_minutes,
      instructions: draft.instructions,
      itemQuestionIds: questionIds,
    });

    // Persist a saved_papers row so the same export is retrievable later.
    await query(
      `INSERT INTO saved_papers (draft_id, qp_pdf_path, ms_pdf_path)
       VALUES ($1, $2, $3)`,
      [draft.id, out.qp_uri, out.ms_uri],
    );

    res.json(out);
  } catch (err) {
    next(err);
  }
});
