/**
 * Seed `topics` from ../../syllabus/syllabus.seed.json.
 * Idempotent: ON CONFLICT (section_code, code) DO UPDATE SET name = EXCLUDED.name.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

interface SyllabusTopic {
  code: string;
  name: string;
}
interface SyllabusFile {
  sections: Record<string, SyllabusTopic[]>;
}

async function main() {
  const seedPath = resolve(__dirname, '../../../syllabus/syllabus.seed.json');
  const raw = await readFile(seedPath, 'utf8');
  const seed = JSON.parse(raw) as SyllabusFile;

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let total = 0;
  for (const [sectionCode, topics] of Object.entries(seed.sections)) {
    for (const t of topics) {
      await client.query(
        `INSERT INTO topics (section_code, code, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (section_code, code) DO UPDATE SET name = EXCLUDED.name`,
        [sectionCode, t.code, t.name],
      );
      total += 1;
    }
  }

  await client.end();
  console.log(`[seed] upserted ${total} topics across ${Object.keys(seed.sections).length} sections`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
