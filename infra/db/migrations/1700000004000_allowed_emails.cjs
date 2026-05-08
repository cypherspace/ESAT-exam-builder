/* eslint-disable camelcase */

// Move the OAuth allowlist out of cloudbuild.yaml (which lives in a
// public repo) into a database table that admins can manage from the UI.
//
//   - allowed_emails(email, role, added_by, created_at)
//
// On first sign-in for a new user, the auth callback consults this table
// to decide whether to admit them and what role to give them. Once a row
// in `users` exists for the email, the allowed_emails entry is no longer
// consulted for that person — existing users always pass.

exports.up = (pgm) => {
  pgm.createTable('allowed_emails', {
    email: { type: 'text', primaryKey: true },
    role: { type: 'user_role', notNull: true, default: 'teacher' },
    added_by: { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Lower-case the email at insert time to keep the lookup deterministic.
  pgm.sql(`CREATE UNIQUE INDEX allowed_emails_lower ON allowed_emails (LOWER(email))`);
};

exports.down = (pgm) => {
  pgm.dropTable('allowed_emails');
};
