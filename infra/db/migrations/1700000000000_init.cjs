/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  // ---- enums ----
  pgm.createType('test_code', ['ESAT', 'ENGAA', 'NSAA']);
  pgm.createType('section_code', [
    'MATHS1',
    'MATHS2',
    'PHYSICS',
    'CHEMISTRY',
    'BIOLOGY',
    'ADV_MATHS',
  ]);
  pgm.createType('exam_status', ['pending', 'extracting', 'ready', 'error']);
  pgm.createType('question_type', ['multiple_choice', 'short_answer', 'structured']);
  pgm.createType('answer_key', ['A', 'B', 'C', 'D', 'E']);
  pgm.createType('user_role', ['teacher', 'admin', 'student']);
  pgm.createType('flag_status', ['open', 'resolved', 'dismissed']);

  // ---- exams ----
  pgm.createTable('exams', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    test_code: { type: 'test_code', notNull: true },
    year: { type: 'integer', notNull: true },
    sitting: { type: 'text', notNull: true },
    source_pdf_path: { type: 'text', notNull: true },
    ms_pdf_path: { type: 'text' },
    status: { type: 'exam_status', notNull: true, default: 'pending' },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('exams', 'exams_unique', {
    unique: ['test_code', 'year', 'sitting'],
  });

  // ---- sections ----
  pgm.createTable('sections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: {
      type: 'uuid',
      notNull: true,
      references: '"exams"',
      onDelete: 'CASCADE',
    },
    code: { type: 'section_code', notNull: true },
    question_count: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('sections', 'sections_unique', {
    unique: ['exam_id', 'code'],
  });

  // ---- topics (flat list per section) ----
  pgm.createTable('topics', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    section_code: { type: 'section_code', notNull: true },
    code: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
  });
  pgm.addConstraint('topics', 'topics_unique', {
    unique: ['section_code', 'code'],
  });

  // ---- questions ----
  pgm.createTable('questions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    section_id: {
      type: 'uuid',
      notNull: true,
      references: '"sections"',
      onDelete: 'CASCADE',
    },
    number: { type: 'integer', notNull: true },
    image_path: { type: 'text', notNull: true },
    ocr_text: { type: 'text' },
    answer_key: { type: 'answer_key' },
    question_type: { type: 'question_type', notNull: true, default: 'multiple_choice' },
    topic_id: { type: 'uuid', references: '"topics"', onDelete: 'SET NULL' },
    difficulty: { type: 'smallint' },
    summary: { type: 'text' },
    keywords: { type: 'text[]', notNull: true, default: '{}' },
    page_index: { type: 'integer' },
    bbox: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('questions', 'questions_unique', {
    unique: ['section_id', 'number'],
  });
  pgm.createIndex('questions', 'topic_id');
  pgm.createIndex('questions', 'difficulty');

  // ---- many-to-many for secondary topics ----
  pgm.createTable('question_topics', {
    question_id: {
      type: 'uuid',
      notNull: true,
      references: '"questions"',
      onDelete: 'CASCADE',
    },
    topic_id: {
      type: 'uuid',
      notNull: true,
      references: '"topics"',
      onDelete: 'CASCADE',
    },
    confidence: { type: 'real', notNull: true, default: 1.0 },
  });
  pgm.addConstraint('question_topics', 'question_topics_pk', {
    primaryKey: ['question_id', 'topic_id'],
  });

  // ---- users / sessions ----
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    google_id: { type: 'text', unique: true },
    email: { type: 'text', notNull: true, unique: true },
    display_name: { type: 'text' },
    role: { type: 'user_role', notNull: true, default: 'teacher' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_login_at: { type: 'timestamptz' },
  });

  pgm.createTable('sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    token: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  });

  // ---- drafts / saved papers ----
  pgm.createTable('paper_drafts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    items: { type: 'jsonb', notNull: true, default: '[]' },
    time_limit_minutes: { type: 'integer' },
    instructions: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('saved_papers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    draft_id: {
      type: 'uuid',
      notNull: true,
      references: '"paper_drafts"',
      onDelete: 'CASCADE',
    },
    qp_pdf_path: { type: 'text', notNull: true },
    ms_pdf_path: { type: 'text' },
    exported_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---- flags ----
  pgm.createTable('flags', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    question_id: {
      type: 'uuid',
      notNull: true,
      references: '"questions"',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    note: { type: 'text', notNull: true },
    status: { type: 'flag_status', notNull: true, default: 'open' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('flags');
  pgm.dropTable('saved_papers');
  pgm.dropTable('paper_drafts');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
  pgm.dropTable('question_topics');
  pgm.dropTable('questions');
  pgm.dropTable('topics');
  pgm.dropTable('sections');
  pgm.dropTable('exams');
  pgm.dropType('flag_status');
  pgm.dropType('user_role');
  pgm.dropType('answer_key');
  pgm.dropType('question_type');
  pgm.dropType('exam_status');
  pgm.dropType('section_code');
  pgm.dropType('test_code');
};
