const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());

// Rate limiting - 10 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'https://onethrive-temp.vercel.app',
  'https://onethrive.in',
  'https://www.onethrive.in'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/contact', limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Contact Schema
const contactSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 100 },
  workEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phoneNumber: { type: String, trim: true, maxlength: 20 },
  companyName: { type: String, trim: true, maxlength: 100 },
  participants: { type: String, trim: true },
  activityType: [{
    type: String,
    enum: [
      'team-building',
      'wellness-programs',
      'creative-workshops',
      'sports-tournaments',
      'entertainment-events',
      'offsite-retreats'
    ]
  }],
  message: { type: String, trim: true, maxlength: 1000 },
  submittedAt: { type: Date, default: Date.now },
  ipAddress: { type: String }
}, { timestamps: true });

const Contact = mongoose.model('Contact', contactSchema);

// Email Configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.EMAIL_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) console.error('❌ Email configuration error:', error);
  else console.log('✅ Email server is ready to send messages');
});

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

// Contact form submission endpoint
app.post('/api/contact', async (req, res) => {
  try {
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

    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

    const contactData = new Contact({
      fullName,
      workEmail,
      phoneNumber: phoneNumber || '',
      companyName: companyName || '',
      participants: participants || '',
      activityType: activityType || [],
      message: message || '',
      ipAddress
    });

    await contactData.save();

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
      from: process.env.SENDER_EMAIL,
      to: 'info@onethrive.in',
      subject: emailSubject,
      html: emailBody,
      replyTo: workEmail
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: 'Contact form submitted successfully' });

  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({ error: 'Internal server error. Please try again later.' });
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
    const skip = (page - 1) * limit;

    const contacts = await Contact.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await Contact.countDocuments();

    res.status(200).json({
      contacts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
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
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});
