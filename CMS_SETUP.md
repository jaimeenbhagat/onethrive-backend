# OneThrive CMS setup

The CMS is additive to the existing Express/Supabase API. It does not migrate or seed production automatically.

## Local setup

1. Create a local Supabase project and review `migrations/001_cms_content.sql`.
2. Apply that migration only to the local project.
3. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.
4. Set `CMS_SEED_TARGET=local` and run `node scripts/seed-cms-local.js` after reviewing the seed JSON.
5. Create a Supabase Storage bucket matching `CMS_MEDIA_BUCKET` and choose its public/private policy deliberately.
6. Start the backend and frontend locally, then visit `/admin`.

## API

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/cms/:type`
- `POST /api/admin/cms/:type`
- `PUT /api/admin/cms/:type/:id`
- `DELETE /api/admin/cms/:type/:id`
- `GET /api/cms/content?type=:type`
- `POST /api/admin/media/upload`
- `GET /api/admin/media`
- `DELETE /api/admin/media/:id`

Admin mutations require the HttpOnly `onethrive_admin_session` cookie. Public reads return enabled records only.

## Production gate

Before production use, an authorized operator must review the actual Supabase schema/RLS policies, select and configure a media provider, set the admin secrets, apply the migration, and deploy the backend/frontend. None of those actions are performed by this repository change.
