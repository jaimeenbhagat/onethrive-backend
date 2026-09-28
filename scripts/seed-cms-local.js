/*
 * Local-only seed helper. It is intentionally opt-in and refuses production.
 * Review cms-seed.local.json and run only with a local Supabase project.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (process.env.NODE_ENV === 'production' || process.env.CMS_SEED_TARGET !== 'local') {
  throw new Error('Refusing CMS seed: set CMS_SEED_TARGET=local and use a non-production environment');
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for a local seed');
if (/onethrive|supabase\.co/i.test(url)) {
  throw new Error('Refusing seed against a hosted project URL; use a local Supabase URL');
}

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cms-seed.local.json'), 'utf8'));
const supabase = createClient(url, key);

(async () => {
  const groups = seed.groups || [seed];
  let seededCount = 0;
  for (const group of groups) {
    for (const record of group.records) {
    const { error } = await supabase.from('cms_content').upsert({
      content_type: group.content_type,
      slug: record.slug,
      payload: record.payload,
      enabled: record.enabled,
      display_order: record.display_order,
    }, { onConflict: 'content_type,slug' });
    if (error) throw error;
      seededCount += 1;
    }
  }
  console.log(`Seeded ${seededCount} CMS records locally.`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
