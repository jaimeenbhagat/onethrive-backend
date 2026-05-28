const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();
const supabase = require('./supabaseClient');

const app = express();

// Render sits behind a proxy, so trust the first forwarded hop before rate limiting.
app.set('trust proxy', 1);

// Rate limiting - 10 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

// CORS configuration
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://onethrive.in',
  'https://www.onethrive.in',
  'https://onethrive-temp.vercel.app',
  'https://full-website-opal.vercel.app',
];

const envAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultAllowedOrigins, ...envAllowedOrigins]);

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  // Allow all Vercel preview/prod origins for OneThrive frontend deployments.
  if (origin.endsWith('.vercel.app')) return true;

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Security middleware
app.use(helmet());

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/contact', limiter);

// Email Configuration
const emailUser = process.env.BREVO_SMTP_USER || process.env.EMAIL_USER || process.env.SENDER_EMAIL;
const emailPass = process.env.BREVO_SMTP_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
const smtpHost = process.env.BREVO_SMTP_HOST || process.env.EMAIL_HOST || 'smtp-relay.brevo.com';
const smtpPort = Number(process.env.BREVO_SMTP_PORT || process.env.EMAIL_PORT) || 465;
const mailFrom = process.env.SENDER_EMAIL || emailUser;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: true,
  auth: {
    user: emailUser,
    pass: emailPass,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

const logSmtpError = (error, context) => {
  console.error(`SMTP ${context} failed:`, {
    message: error.message,
    code: error.code,
    command: error.command,
    response: error.response,
    stack: error.stack,
  });
};

const verifySmtpConfiguration = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email server is ready to send messages');
  } catch (error) {
    logSmtpError(error, 'verification');
  }
};

verifySmtpConfiguration();

const formatActivityTypes = (activities) => {
  if (!activities || activities.length === 0) return 'None selected';
  const activityMap = {
    'team-building': 'Team Building',
    'wellness-programs': 'Wellness Programs',
    'creative-workshops': 'Creative Workshops',
    'sports-tournaments': 'Sports Tournaments',
    'entertainment-events': 'Entertainment Events',
    'offsite-retreats': 'Offsite Retreats'
  };
  return activities.map(activity => activityMap[activity] || activity).join(', ');
};

const normalizeValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return value;
};

// Contact form submission endpoint
app.post('/api/contact', async (req, res) => {
  try {
    console.log('Contact API req.body:', req.body);

    const {
      fullName,
      workEmail,
      phoneNumber,
      companyName,
      participants,
      activityType,
      message
    } = req.body;

    if (!fullName || !workEmail) {
      return res.status(400).json({ error: 'Full name and email are required' });
    }

    const participantsNumber = Number(participants);
    const safePayload = {
      name: normalizeValue(fullName),
      email: normalizeValue(workEmail)?.toLowerCase() ?? null,
      phone: normalizeValue(phoneNumber),
      company: normalizeValue(companyName),
      participants: Number.isFinite(participantsNumber) ? participantsNumber : null,
      activity_type: Array.isArray(activityType)
        ? activityType.map(normalizeValue).filter((item) => item !== null)
        : normalizeValue(activityType),
      message: normalizeValue(message),
    };

    console.log('Contact API mapped payload:', safePayload);

    try {
      const { data: insertData, error: insertError } = await supabase
        .from('contacts')
        .insert([safePayload])
        .select('*');

      console.log('Supabase insert response:', { data: insertData, error: insertError });

      if (insertError) {
        console.error('Supabase insert error:', {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
          status: insertError.status,
        });
        return res.status(500).json({
          success: false,
          error: insertError.message || 'Failed to submit contact form',
          details: {
            message: insertError.message,
            code: insertError.code,
            details: insertError.details,
            hint: insertError.hint,
            status: insertError.status,
          },
        });
      }

      if (!insertData || insertData.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Insert completed but no row was returned from Supabase',
        });
      }

      console.log('Supabase insert row:', insertData[0]);
    } catch (insertError) {
      console.error('Supabase insert error:', {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        status: insertError.status,
        stack: insertError.stack,
      });

      return res.status(500).json({
        success: false,
        error: insertError.message || 'Failed to submit contact form',
        details: {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
          status: insertError.status,
        },
      });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

    const emailSubject = `New Contact Form Submission - ${fullName}`;
    const emailBody = `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${fullName}</p>
      <p><strong>Email:</strong> ${workEmail}</p>
      <p><strong>Phone:</strong> ${phoneNumber || 'Not provided'}</p>
      <p><strong>Company:</strong> ${companyName || 'Not provided'}</p>
      <p><strong>Participants:</strong> ${participants || 'Not specified'}</p>
      <p><strong>Activities:</strong> ${formatActivityTypes(activityType)}</p>
      <p><strong>Message:</strong> ${message || 'None'}</p>
      <p><strong>IP Address:</strong> ${ipAddress}</p>
    `;

    const mailOptions = {
      from: mailFrom,
      to: 'info@onethrive.in',
      subject: emailSubject,
      html: emailBody,
      replyTo: workEmail
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (mailError) {
      logSmtpError(mailError, 'send');
      throw mailError;
    }

    res.status(200).json({ success: true, message: 'Contact form submitted successfully' });

  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error. Please try again later.' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const from = (page - 1) * limit;
    const toRangeEnd = from + limit - 1;

    const { data, count, error } = await supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .range(from, toRangeEnd)
      .order('id', { ascending: false });

    if (error) {
      console.error('Supabase contacts query error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        status: error.status,
      });
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch contacts',
        details: {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status: error.status,
        },
      });
    }

    const contacts = (data || []).map((row) => ({
      fullName: row.name ?? '',
      workEmail: row.email ?? '',
      phoneNumber: row.phone ?? '',
      companyName: row.company ?? '',
      participants: row.participants ?? '',
      activityType: row.activity_type ?? [],
      message: row.message ?? '',
      submittedAt: row.created_at ?? null,
      id: row.id ?? null
    }));

    res.status(200).json({
      contacts,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'OneThrive API is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      contact: '/api/contact (POST)',
      contacts: '/api/contacts (GET)'
    }
  });
});

// Error handlers
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


// ✅ Start server (always bind to PORT!)
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('✅ Server running with CORS enabled');
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});
