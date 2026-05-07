/* eslint-disable camelcase */

// Add the PAT (Oxford Physics Aptitude Test) value to the test_code enum
// so the upload + ingest pipelines can accept PAT papers.

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE test_code ADD VALUE IF NOT EXISTS 'PAT'`);
};

exports.down = () => {
  // Postgres has no DROP VALUE for enums — one-way migration.
};
