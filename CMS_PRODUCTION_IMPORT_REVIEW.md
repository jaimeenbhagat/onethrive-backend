# Production CMS import review

This is a review artifact only. No production query, write, migration, seed, deployment, or environment change is performed by this file.

## Final inventory

The proposed manifest is `cms-production-import.json`.

It contains 138 records for `public.cms_content` across 19 content types. The complete per-record payloads and source references are in the manifest.

| Content type | Records |
|---|---|
| `sections` | 7 |
| `carousels` | 1 |
| `testimonials` | 5 |
| `client-logos` | 17 |
| `about-process` | 1 |
| `team` | 3 |
| `service-categories` | 7 |
| `services` | 64 |
| `contact` | 1 |
| `navigation` | 5 |
| `footer` | 1 |
| `blogs` | 9 |
| `policies` | 3 |
| `roi-calculator` | 3 |
| `pages` | 3 |
| `resources` | 3 |
| `quiz` | 1 |
| `quiz-results` | 1 |
| `seo` | 3 |

Local bundled images are represented as `_pendingMediaSourceFiles` and their runtime URL fields are set to `null`. This is deliberate: the requested import must not modify `cms_media` or Storage, and local `src/assets` paths are not valid production URLs. Services, logos, team/process images, moments, and blog image blocks therefore require an authorized media upload/mapping step before those CMS records can safely replace the existing bundled assets.
The payload, enabled flag, and display order for every proposed record are present in the manifest and will be printed by the preview script.

## Conflict behavior

The unique key is `(content_type, slug)`.

For each proposed key, the preview script performs a read-only lookup and classifies it as:

- `insert`: no existing row has the same `(content_type, slug)`.
- `update`: a matching row exists and payload, enabled state, or display order differs. The script prints before/after values.
- `unchanged`: the matching row is identical. No write is needed.

The import does not delete rows. Existing `cms_content` rows whose keys are not in the manifest are reported as `unrelatedExistingUntouched` and are not modified. Tables other than `public.cms_content` are never written. `cms_media` is not touched and no media asset is deleted.

## Preview command

Run from `Backend/onethrive-backend` with production read-only credentials available in the environment:

```sh
node scripts/preview-cms-production-import.js > cms-production-import-plan.json
```

This performs SELECT-only reads against `public.cms_content` and writes only the local plan file through shell redirection. It does not apply changes.

## Apply protection

The script refuses to write unless all of the following are true:

- `CMS_IMPORT_APPLY=YES`
- `CMS_IMPORT_CONFIRM=I_UNDERSTAND`
- `NODE_ENV=production`

Those flags are not set by this repository and the apply command must not be run without explicit approval.

## Content limitation

All currently implemented CMS-supported content families are represented. Every record includes a source-file reference; validation found 138 records, 37 source files, zero duplicate keys, zero missing source files, nine complete blog bodies, and 64 services.

The three policy records preserve the complete original JSX source in `payload.sourceSnapshot`, but `payload.html` is empty because JSX-to-sanitized-HTML conversion was not automated. The existing policy JSX remains the safe public fallback. Review and convert those three policies before relying on CMS-rendered policy HTML.
