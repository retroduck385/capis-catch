// Copy an application at whatever stage it is in, files included (demo preparation). Synthetic data only.
//
//   node scripts/cloneApplication.mjs HL-2026-000060                 one copy, same applicant account
//   node scripts/cloneApplication.mjs HL-2026-000060 --copies 3      three copies
//   node scripts/cloneApplication.mjs 98 --fresh                     by id; move the copy's timestamps so its latest
//                                                                    event is "now" (turnaround / SLA look fresh)
//   node scripts/cloneApplication.mjs HL-2026-000060 --to someone@gmail.com   copy into another applicant account
//                                                                    (needed for a DRAFT: one draft per account)
//
// Run inside catch/. Needs migration 20261209_clone_application.sql in Supabase. Uses the service-role key from the
// environment (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) or from ocr-service/.env (gitignored), never catch/.env.
// 1. clone_application() copies every row of the application in one transaction (nothing is sent, no notifications).
// 2. This script then copies each file in Storage to the copy's folder. A file that fails is listed at the end; the
//    copy's rows stay (that file just won't open), so delete the copy and run again if it matters.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node scripts/cloneApplication.mjs <HL-YYYY-NNNNNN | id> [--copies N] [--fresh] [--to applicant@email]';

function parseArgs(argv) {
  const opts = { source: null, copies: 1, fresh: false, to: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fresh') opts.fresh = true;
    else if (a === '--copies') opts.copies = Number(argv[++i]);
    else if (a === '--to') opts.to = argv[++i] ?? null;
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (!a.startsWith('--') && opts.source === null) opts.source = a.trim();
    else throw new Error(`Unknown option ${a}\n${USAGE}`);
  }
  if (!opts.source) throw new Error(USAGE);
  if (!Number.isInteger(opts.copies) || opts.copies < 1 || opts.copies > 20) throw new Error('--copies must be 1 to 20');
  if (opts.to !== null && !opts.to.includes('@')) throw new Error('--to needs an applicant e-mail');
  return opts;
}

function loadKeys() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const envFile = path.resolve(here, '../../ocr-service/.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or fill in ocr-service/.env)');
  return { url, key };
}

async function findSource(sb, source) {
  const query = sb.from('loan_applications').select('id, application_no, status');
  const { data, error } = /^\d+$/.test(source)
    ? await query.eq('id', Number(source)).maybeSingle()
    : await query.eq('application_no', source.toUpperCase()).maybeSingle();
  if (error) throw new Error(`Looking up ${source}: ${error.message}`);
  if (!data) throw new Error(`No application ${source}`);
  return data;
}

// Copies the files a few at a time; returns the ones that failed.
async function copyFiles(sb, bucket, files) {
  const failed = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      const { error } = await sb.storage.from(bucket).copy(f.from, f.to);
      if (error) failed.push({ ...f, error: error.message });
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, files.length) }, worker));
  return failed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { url, key } = loadKeys();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const src = await findSource(sb, opts.source);
  console.log(`Copying ${src.application_no ?? `draft #${src.id}`} (id ${src.id}, ${src.status})` +
              `${opts.copies > 1 ? ` x${opts.copies}` : ''}${opts.fresh ? ', fresh timestamps' : ''}` +
              `${opts.to ? `, into ${opts.to}` : ''}`);

  let problems = 0;
  for (let n = 1; n <= opts.copies; n++) {
    const { data: out, error } = await sb.rpc('clone_application', {
      p_application_id: src.id, p_owner_email: opts.to, p_fresh: opts.fresh,
    });
    if (error) throw new Error(`clone_application: ${error.message}`);

    const files = out.files ?? [];
    const failed = await copyFiles(sb, out.bucket, files);
    const rows = Object.values(out.rows ?? {}).reduce((a, b) => a + b, 0);
    console.log(`  ${out.application_no ?? 'draft'} (id ${out.application_id}): ${rows} rows, ` +
                `${files.length - failed.length}/${files.length} files` +
                `${out.shifted_by ? `, timestamps moved by ${out.shifted_by}` : ''}`);
    for (const f of failed) console.log(`    file not copied: ${f.from} (${f.error})`);
    problems += failed.length;
  }
  if (problems) {
    console.log(`\n${problems} file(s) not copied. Usually the source's own file is missing in Storage ` +
                `(e.g. seeded rows without uploads); those don't open in the source either.`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
