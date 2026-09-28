const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const supabase = require('./supabaseClient');
const {
  clearSessionCookie,
  createSession,
  requireAdmin,
  setSessionCookie,
} = require('./cmsAuth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowed = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    callback(allowed ? null : new Error('Only image and video files are supported'), allowed);
  },
});
const mediaBucket = process.env.CMS_MEDIA_BUCKET || 'cms-media';
const allowedTypes = new Set([
  'pages',
  'sections',
  'services',
  'service-categories',
  'about-process',
  'team',
  'testimonials',
  'client-logos',
  'carousels',
  'blogs',
  'navigation',
  'footer',
  'seo',
  'contact',
  'resources',
  'policies',
  'quiz',
  'quiz-results',
  'roi-calculator',
]);

const serialize = (row) => ({
  id: row.id,
  type: row.content_type,
  slug: row.slug,
  data: row.payload || {},
  enabled: row.enabled,
  order: row.display_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateType = (req, res, next) => {
  if (!allowedTypes.has(req.params.type)) {
    return res.status(400).json({ success: false, error: 'Unsupported CMS content type' });
  }
  return next();
};

const contentQuery = (type) => supabase
  .from('cms_content')
  .select('*')
  .eq('content_type', type)
  .order('display_order', { ascending: true })
  .order('created_at', { ascending: true });

// Public reads contain only enabled content and never expose admin metadata beyond timestamps/order.
router.get('/api/cms/content', async (req, res) => {
  const type = String(req.query.type || '');
  if (!allowedTypes.has(type)) {
    return res.status(400).json({ success: false, error: 'A valid CMS content type is required' });
  }

  const { data, error } = await contentQuery(type).eq('enabled', true);
  if (error) return res.status(500).json({ success: false, error: 'Unable to load CMS content' });
  return res.json({ success: true, data: data.map(serialize) });
});

router.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return res.status(503).json({ success: false, error: 'Admin authentication is not configured' });
  }

  const passwordBuffer = Buffer.from(String(password || ''));
  const configuredBuffer = Buffer.from(configuredPassword);
  const valid = passwordBuffer.length === configuredBuffer.length && require('crypto').timingSafeEqual(passwordBuffer, configuredBuffer);
  if (!valid) return res.status(401).json({ success: false, error: 'Incorrect password' });

  setSessionCookie(res, createSession());
  return res.json({ success: true, data: { role: 'admin' } });
});

router.post('/api/admin/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

router.get('/api/admin/me', requireAdmin, (req, res) => res.json({ success: true, data: { role: 'admin' } }));

router.post('/api/admin/media/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'A media file is required' });

  const extension = req.file.originalname.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const storage = supabase.storage.from(mediaBucket);
  const { error: uploadError } = await storage.upload(objectPath, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: false,
  });
  if (uploadError) return res.status(502).json({ success: false, error: uploadError.message || 'Media upload failed' });

  const { data: publicUrl } = storage.getPublicUrl(objectPath);
  const { data: media, error: mediaError } = await supabase.from('cms_media').insert({
    bucket: mediaBucket,
    object_path: objectPath,
    public_url: publicUrl.publicUrl,
    original_name: req.file.originalname,
    mime_type: req.file.mimetype,
    byte_size: req.file.size,
  }).select('*').single();

  if (mediaError) return res.status(500).json({ success: false, error: 'Media uploaded but metadata could not be saved' });
  return res.status(201).json({ success: true, data: media });
});

router.get('/api/admin/media', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('cms_media').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: 'Unable to load media' });
  return res.json({ success: true, data });
});

router.delete('/api/admin/media/:id', requireAdmin, async (req, res) => {
  const { data: media, error: lookupError } = await supabase.from('cms_media').select('*').eq('id', req.params.id).single();
  if (lookupError || !media) return res.status(404).json({ success: false, error: 'Media not found' });

  const { error: storageError } = await supabase.storage.from(media.bucket).remove([media.object_path]);
  if (storageError) return res.status(502).json({ success: false, error: 'Storage asset could not be deleted' });
  const { error: deleteError } = await supabase.from('cms_media').delete().eq('id', req.params.id);
  if (deleteError) return res.status(500).json({ success: false, error: 'Media metadata could not be deleted' });
  return res.json({ success: true });
});

router.get('/api/admin/cms/:type', requireAdmin, validateType, async (req, res) => {
  const { data, error } = await contentQuery(req.params.type);
  if (error) return res.status(500).json({ success: false, error: 'Unable to load CMS content' });
  return res.json({ success: true, data: data.map(serialize) });
});

router.post('/api/admin/cms/:type', requireAdmin, validateType, async (req, res) => {
  const { slug, data, enabled = true, order = 0 } = req.body || {};
  if (!slug || !data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ success: false, error: 'slug and object data are required' });
  }

  const { data: created, error } = await supabase.from('cms_content').insert({
    content_type: req.params.type,
    slug: String(slug).trim(),
    payload: data,
    enabled: Boolean(enabled),
    display_order: Number.isFinite(Number(order)) ? Number(order) : 0,
  }).select('*').single();

  if (error) return res.status(400).json({ success: false, error: error.message || 'Unable to create CMS content' });
  return res.status(201).json({ success: true, data: serialize(created) });
});

router.put('/api/admin/cms/:type/:id', requireAdmin, validateType, async (req, res) => {
  const { slug, data, enabled, order } = req.body || {};
  const update = {};
  if (slug !== undefined) update.slug = String(slug).trim();
  if (data !== undefined) update.payload = data;
  if (enabled !== undefined) update.enabled = Boolean(enabled);
  if (order !== undefined && Number.isFinite(Number(order))) update.display_order = Number(order);

  const { data: updated, error } = await supabase.from('cms_content')
    .update(update)
    .eq('id', req.params.id)
    .eq('content_type', req.params.type)
    .select('*')
    .single();

  if (error) return res.status(404).json({ success: false, error: 'CMS content not found' });
  return res.json({ success: true, data: serialize(updated) });
});

router.delete('/api/admin/cms/:type/:id', requireAdmin, validateType, async (req, res) => {
  const { error } = await supabase.from('cms_content')
    .delete()
    .eq('id', req.params.id)
    .eq('content_type', req.params.type);

  if (error) return res.status(500).json({ success: false, error: 'Unable to delete CMS content' });
  return res.json({ success: true });
});

module.exports = router;
