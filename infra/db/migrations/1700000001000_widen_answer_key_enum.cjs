/* eslint-disable camelcase */

// Cambridge admissions papers (ENGAA, NSAA) include questions with up to
// 8 options (A–H), and rare longer ranges. Widen the answer_key enum to
// the full A–Z alphabet so the DB doesn't reject these answers.

exports.up = (pgm) => {
  for (const code of 'FGHIJKLMNOPQRSTUVWXYZ') {
    pgm.sql(`ALTER TYPE answer_key ADD VALUE IF NOT EXISTS '${code}'`);
  }
};

exports.down = () => {
  // Postgres has no DROP VALUE for enums; this migration is one-way.
};
