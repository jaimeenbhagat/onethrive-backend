require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.CMS_MEDIA_BUCKET;
const isDryRun = process.argv.includes('--dry-run');

if (!url || !key || !bucket) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CMS_MEDIA_BUCKET');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false }
});

const manifestPath = path.join(__dirname, '..', 'cms-production-import.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const records = (manifest.groups || []).flatMap(g => g.records || []);

console.log(`Starting ${isDryRun ? 'DRY RUN' : 'PRODUCTION'} import...`);
console.log(`Target URL: ${url}`);
console.log(`Target Bucket: ${bucket}`);

// ---------------------------------------------------------
// PRE-FLIGHT VALIDATION
// ---------------------------------------------------------

if (records.length !== 138) {
  console.error(`Validation Error: Manifest contains ${records.length} records, expected 138.`);
  process.exit(1);
}

const keyMap = new Set();
for (const r of records) {
  const compositeKey = `${r.content_type}::${r.slug}`;
  if (keyMap.has(compositeKey)) {
    console.error(`Validation Error: Duplicate key found: ${compositeKey}`);
    process.exit(1);
  }
  keyMap.add(compositeKey);
}
console.log('✅ Validated manifest (138 records, no duplicate keys).');

const mediaFiles = new Set();
const mediaMeta = new Map();

for (const r of records) {
  const pending = r.payload._pendingMediaSourceFiles || [];
  for (const sourcePath of pending) {
    mediaFiles.add(sourcePath);
  }
}

if (mediaFiles.size !== 53) {
  console.error(`Validation Error: Found ${mediaFiles.size} unique media files, expected 53.`);
  process.exit(1);
}

for (const sourcePath of mediaFiles) {
  const absolutePath = path.resolve(__dirname, '../../../', sourcePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Validation Error: Missing media file at ${absolutePath}`);
    process.exit(1);
  }
  
  const originalName = path.basename(absolutePath);
  const ext = path.extname(originalName).toLowerCase();
  const mimeType = ext === '.webp' ? 'image/webp' : 
                   ext === '.png' ? 'image/png' : 
                   (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 
                   ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
  
  // Deterministic object path based on base64url of original path
  const safeSource = Buffer.from(sourcePath).toString('base64url').replace(/=/g, '');
  const objectPath = `imported/${safeSource}/${originalName}`;

  mediaMeta.set(sourcePath, { absolutePath, originalName, mimeType, objectPath });
}
console.log(`✅ Validated all ${mediaFiles.size} media files exist locally.`);

// ---------------------------------------------------------
// EXECUTION PHASE
// ---------------------------------------------------------

async function main() {
  try {
    const uploadedUrls = new Map();

    console.log(`\n--- Processing Media (${mediaFiles.size} files) ---`);
    for (const [sourcePath, meta] of mediaMeta.entries()) {
      const { absolutePath, originalName, mimeType, objectPath } = meta;
      
      const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const publicUrl = publicUrlData.publicUrl;
      uploadedUrls.set(sourcePath, publicUrl);

      if (isDryRun) {
        console.log(`[DRY RUN] Would upload: ${sourcePath} -> ${objectPath}`);
        console.log(`[DRY RUN] Would upsert cms_media: ${objectPath}`);
        continue;
      }

      const buffer = fs.readFileSync(absolutePath);
      console.log(`Uploading: ${objectPath}...`);
      
      const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: true
      });
      if (uploadError) throw new Error(`Storage upload failed for ${objectPath}: ${uploadError.message}`);

      const { error: mediaError } = await supabase.from('cms_media').upsert({
        bucket,
        object_path: objectPath,
        public_url: publicUrl,
        original_name: originalName,
        mime_type: mimeType,
        byte_size: buffer.length
      }, { onConflict: 'object_path' });

      if (mediaError) throw new Error(`cms_media upsert failed for ${objectPath}: ${mediaError.message}`);
    }

    console.log(`\n--- Processing CMS Records (${records.length} records) ---`);
    let upsertedCount = 0;
    
    for (const group of manifest.groups || []) {
      for (const record of group.records || []) {
        const pending = record.payload._pendingMediaSourceFiles;
        if (pending && pending.length) {
          let pendingIdx = 0;
          const replaceMedia = (obj) => {
            if (Array.isArray(obj)) {
              obj.forEach(replaceMedia);
            } else if (obj && typeof obj === 'object') {
              for (const key of Object.keys(obj)) {
                if (obj[key] === null && ['heroImage', 'icon', 'image', 'logo', 'thumbnail', 'url', 'profilePhoto'].includes(key)) {
                  if (pendingIdx < pending.length) {
                    obj[key] = uploadedUrls.get(pending[pendingIdx]);
                    pendingIdx++;
                  }
                } else {
                  replaceMedia(obj[key]);
                }
              }
            }
          };
          replaceMedia(record.payload);
          delete record.payload._pendingMediaSourceFiles;
        }

        const row = {
          content_type: group.content_type,
          slug: record.slug,
          payload: record.payload,
          enabled: record.enabled,
          display_order: record.display_order
        };

        if (isDryRun) {
          console.log(`[DRY RUN] Would upsert content: ${row.content_type}::${row.slug}`);
        } else {
          const { error: upsertError } = await supabase.from('cms_content').upsert(row, { onConflict: 'content_type,slug' });
          if (upsertError) throw new Error(`cms_content upsert failed for ${row.content_type}::${row.slug}: ${upsertError.message}`);
          upsertedCount++;
        }
      }
    }
    
    if (!isDryRun) {
      console.log(`Upserted ${upsertedCount} cms_content records.`);
    }

    if (!isDryRun) {
      console.log(`\n--- Verification ---`);
      const { count: contentCount, error: contentErr } = await supabase.from('cms_content').select('*', { count: 'exact', head: true });
      if (contentErr) throw new Error(`Failed to count cms_content: ${contentErr.message}`);
      
      const { count: mediaCount, error: mediaErr } = await supabase.from('cms_media').select('*', { count: 'exact', head: true });
      if (mediaErr) throw new Error(`Failed to count cms_media: ${mediaErr.message}`);

      console.log(`Final Database State - cms_content: ${contentCount} rows`);
      console.log(`Final Database State - cms_media: ${mediaCount} rows`);
    }

    console.log(`\n✅ Script completed successfully ${isDryRun ? '(Dry Run)' : ''}`);
  } catch (err) {
    console.error('\nFatal Error:', err.message);
    process.exit(1);
  }
}

main();
