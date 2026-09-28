/*
 * Production CMS import preview.
 *
 * Default behavior is read-only: it loads the proposed manifest and performs
 * SELECT queries only. It never writes, deletes, seeds, migrates, or touches
 * tables other than cms_content.
 *
 * To review a production plan without applying it:
 *   node scripts/preview-cms-production-import.js
 *
 * Applying is intentionally blocked unless both explicit flags are supplied:
 *   CMS_IMPORT_APPLY=YES CMS_IMPORT_CONFIRM=I_UNDERSTAND node scripts/preview-cms-production-import.js
 *
 * Do not use the apply mode until the printed plan has been reviewed and
 * production authorization has been granted.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const manifestPath = process.env.CMS_IMPORT_MANIFEST
  ? path.resolve(process.env.CMS_IMPORT_MANIFEST)
  : path.join(__dirname, '..', 'cms-production-import.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const groups = manifest.groups || [];
const proposed = groups.flatMap((group) => (group.records || []).map((record) => ({
  content_type: group.content_type,
  slug: record.slug,
  payload: record.payload,
  enabled: record.enabled ?? true,
  display_order: record.display_order ?? 0,
})));
const pendingMedia = proposed.filter((record) => Array.isArray(record.payload?._pendingMediaSourceFiles) && record.payload._pendingMediaSourceFiles.length > 0);

const keyFor = (record) => `${record.content_type}::${record.slug}`;
const duplicateKeys = proposed.filter((record, index) => proposed.findIndex((item) => keyFor(item) === keyFor(record)) !== index);
if (duplicateKeys.length > 0) {
  throw new Error(`Manifest contains duplicate CMS keys: ${duplicateKeys.map(keyFor).join(', ')}`);
}

const applyRequested = process.env.CMS_IMPORT_APPLY === 'YES';
const applyConfirmed = process.env.CMS_IMPORT_CONFIRM === 'I_UNDERSTAND';
if (applyRequested !== applyConfirmed) {
  throw new Error('Refusing import: preview mode requires no apply flag; apply mode requires both CMS_IMPORT_APPLY=YES and CMS_IMPORT_CONFIRM=I_UNDERSTAND');
}
if (applyRequested && process.env.NODE_ENV !== 'production') {
  throw new Error('Refusing apply mode unless NODE_ENV=production is explicitly set');
}
if (applyRequested && pendingMedia.length > 0) {
  throw new Error(`Refusing apply: ${pendingMedia.length} records still reference bundled media that has not been mapped into cms_media/Storage`);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const supabase = createClient(url, key);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const diff = (current, next) => ({
  payload: !same(current.payload, next.payload) ? { before: current.payload, after: next.payload } : undefined,
  enabled: current.enabled !== next.enabled ? { before: current.enabled, after: next.enabled } : undefined,
  display_order: current.display_order !== next.display_order ? { before: current.display_order, after: next.display_order } : undefined,
});

(async () => {
  const contentTypes = [...new Set(proposed.map((record) => record.content_type))];
  const { data: existing, error } = await supabase
    .from('cms_content')
    .select('content_type,slug,payload,enabled,display_order')
    .in('content_type', contentTypes);
  if (error) throw error;

  const existingByKey = new Map((existing || []).map((record) => [keyFor(record), record]));
  const inserts = [];
  const updates = [];
  const unchanged = [];

  for (const record of proposed) {
    const current = existingByKey.get(keyFor(record));
    if (!current) inserts.push(record);
    else if (same(current.payload, record.payload) && current.enabled === record.enabled && current.display_order === record.display_order) unchanged.push(record);
    else updates.push({ key: keyFor(record), changes: diff(current, record) });
  }

  const manifestKeys = new Set(proposed.map(keyFor));
  const unrelatedExisting = (existing || []).filter((record) => !manifestKeys.has(keyFor(record)));

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: applyRequested ? 'APPLY_REQUESTED' : 'PREVIEW_ONLY',
    targetTable: 'public.cms_content',
    counts: {
      proposed: proposed.length,
      inserts: inserts.length,
      updates: updates.length,
      unchanged: unchanged.length,
      unrelatedExistingUntouched: unrelatedExisting.length,
    },
    inserts,
    updates,
    unchanged: unchanged.map(keyFor),
    unrelatedExistingUntouched: unrelatedExisting.map(keyFor),
    safety: {
      writesAllowed: applyRequested,
      deletes: 0,
      tablesWritten: applyRequested ? ['public.cms_content'] : [],
      tablesRead: ['public.cms_content'],
      unmatchedExistingRecordsAreUntouched: true,
      mediaDeleted: 0,
    },
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!applyRequested) return;

  for (const record of proposed) {
    const { error: upsertError } = await supabase.from('cms_content').upsert(record, { onConflict: 'content_type,slug' });
    if (upsertError) throw upsertError;
  }
  console.error(`Applied ${proposed.length} scoped cms_content records after explicit confirmation.`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
