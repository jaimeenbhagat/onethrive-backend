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
  'https://www.onethrive.in',
  'https://full-website-opal.vercel.app'
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

// Apply rate limiting to both endpoints
app.use('/api/contact', limiter);
app.use('/api/roi-calculator', limiter);

// Allow preflight for all routes
app.options('*', cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ========================
// CONTACT FORM SCHEMA & LOGIC
// ========================

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

// ========================
// ROI CALCULATOR SCHEMA & LOGIC
// ========================

const roiCalculatorSchema = new mongoose.Schema({
  // Input Data
  numEmployees: { type: Number, required: true, min: 1 },
  avgAnnualSalary: { type: Number, required: true, min: 0 },
  annualRevenue: { type: Number, required: true, min: 0 },
  employeesWhoLeft: { type: Number, required: true, min: 0 },
  avgExtraAbsenteeismDaysPerEmployee: { type: Number, required: true, min: 0 },
  engagementScore: { type: Number, required: true, min: 1, max: 10 },
  
  // Contact Information
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    match: [/^[0-9]{10,15}$/, 'Please enter a valid phone number']
  },
  
  // Calculated Results
  calculatedResults: {
    totalTurnoverCost: { type: Number, required: true },
    totalDisengagementCost: { type: Number, required: true },
    totalAbsenteeismCost: { type: Number, required: true },
    totalHiddenLoss: { type: Number, required: true },
    potentialSavingsMin: { type: Number, required: true },
    potentialSavingsMax: { type: Number, required: true },
    potentialRevenueIncreaseMin: { type: Number, required: true },
    potentialRevenueIncreaseMax: { type: Number, required: true }
  },
  
  // Metadata
  submittedAt: { type: Date, default: Date.now },
  ipAddress: { type: String }
}, { timestamps: true });

const ROICalculator = mongoose.model('ROICalculator', roiCalculatorSchema);

// ========================
// EMAIL CONFIGURATION
// ========================

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

// ========================
// HELPER FUNCTIONS
// ========================

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

// Helper function to format numbers to Indian Rupees
function formatINR(n) {
  if (typeof n !== "number" || isNaN(n)) {
    return "₹0";
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// ROI Calculation Logic
function calculateROI(data) {
  const {
    numEmployees,
    avgAnnualSalary,
    annualRevenue,
    employeesWhoLeft,
    avgExtraAbsenteeismDaysPerEmployee,
    engagementScore
  } = data;

  // Configuration Constants
  const DISENGAGEMENT_PRODUCTIVITY_LOSS_FACTOR = 0.34;
  const AVG_REPLACEMENT_COST_FACTOR = 1.25;
  const WORKING_DAYS_PER_YEAR = 250;
  const REVENUE_INCREASE_FACTOR_MIN = 0.02;
  const REVENUE_INCREASE_FACTOR_MAX = 0.05;

  // Calculate turnover cost
  const costPerReplacement = avgAnnualSalary * AVG_REPLACEMENT_COST_FACTOR;
  const totalTurnoverCost = employeesWhoLeft * costPerReplacement;

  // Calculate disengagement cost
  const disengagementInfluenceFactor = (10 - engagementScore) / 10;
  const avgDailySalary = avgAnnualSalary / WORKING_DAYS_PER_YEAR;
  const productivityLossCost = numEmployees * avgAnnualSalary * disengagementInfluenceFactor * DISENGAGEMENT_PRODUCTIVITY_LOSS_FACTOR;
  const absenteeismCost = numEmployees * avgExtraAbsenteeismDaysPerEmployee * avgDailySalary * disengagementInfluenceFactor;
  const totalDisengagementCost = productivityLossCost + absenteeismCost;

  // Calculate total hidden loss
  const totalHiddenLoss = totalTurnoverCost + totalDisengagementCost;

  // Calculate potential savings (by improving engagement score by 1-2 points)
  const improvedEngagement1Pt = Math.min(10, engagementScore + 1);
  const newDisengagementInfluenceFactor1Pt = (10 - improvedEngagement1Pt) / 10;
  const newProductivityLossCost1Pt = numEmployees * avgAnnualSalary * newDisengagementInfluenceFactor1Pt * DISENGAGEMENT_PRODUCTIVITY_LOSS_FACTOR;
  const newAbsenteeismCost1Pt = numEmployees * avgExtraAbsenteeismDaysPerEmployee * avgDailySalary * newDisengagementInfluenceFactor1Pt;
  const newTotalDisengagementCost1Pt = newProductivityLossCost1Pt + newAbsenteeismCost1Pt;
  const savings1Pt = totalDisengagementCost - newTotalDisengagementCost1Pt;

  const improvedEngagement2Pt = Math.min(10, engagementScore + 2);
  const newDisengagementInfluenceFactor2Pt = (10 - improvedEngagement2Pt) / 10;
  const newProductivityLossCost2Pt = numEmployees * avgAnnualSalary * newDisengagementInfluenceFactor2Pt * DISENGAGEMENT_PRODUCTIVITY_LOSS_FACTOR;
  const newAbsenteeismCost2Pt = numEmployees * avgExtraAbsenteeismDaysPerEmployee * avgDailySalary * newDisengagementInfluenceFactor2Pt;
  const newTotalDisengagementCost2Pt = newProductivityLossCost2Pt + newAbsenteeismCost2Pt;
  const savings2Pt = totalDisengagementCost - newTotalDisengagementCost2Pt;

  // Calculate potential revenue increase
  const potentialRevenueIncreaseMin = annualRevenue * REVENUE_INCREASE_FACTOR_MIN * ((engagementScore + 1) / 10);
  const potentialRevenueIncreaseMax = annualRevenue * REVENUE_INCREASE_FACTOR_MAX * ((engagementScore + 2) / 10);

  return {
    totalTurnoverCost,
    totalDisengagementCost,
    totalAbsenteeismCost: absenteeismCost,
    totalHiddenLoss,
    potentialSavingsMin: Math.max(0, savings1Pt),
    potentialSavingsMax: Math.max(0, savings2Pt),
    potentialRevenueIncreaseMin,
    potentialRevenueIncreaseMax,
  };
}

// ========================
// API ENDPOINTS
// ========================

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

// ROI Calculator submission endpoint
app.post('/api/roi-calculator', async (req, res) => {
  try {
    const {
      numEmployees,
      avgAnnualSalary,
      annualRevenue,
      employeesWhoLeft,
      avgExtraAbsenteeismDaysPerEmployee,
      engagementScore,
      email,
      phoneNumber
    } = req.body;

    // Validation
    if (!numEmployees || !avgAnnualSalary || !annualRevenue || !email || !phoneNumber) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    if (employeesWhoLeft > numEmployees) {
      return res.status(400).json({ error: 'Number of employees who left cannot be more than total employees' });
    }

    if (engagementScore < 1 || engagementScore > 10) {
      return res.status(400).json({ error: 'Engagement score must be between 1 and 10' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

    // Calculate ROI results
    const calculatedResults = calculateROI({
      numEmployees,
      avgAnnualSalary,
      annualRevenue,
      employeesWhoLeft,
      avgExtraAbsenteeismDaysPerEmployee,
      engagementScore
    });

    // Save to database
    const roiData = new ROICalculator({
      numEmployees,
      avgAnnualSalary,
      annualRevenue,
      employeesWhoLeft,
      avgExtraAbsenteeismDaysPerEmployee,
      engagementScore,
      email,
      phoneNumber,
      calculatedResults,
      ipAddress
    });

    await roiData.save();

    // Send email notification
    const emailSubject = `New ROI Calculator Submission - ${email}`;
    const emailBody = `
      <h2>New ROI Calculator Submission</h2>
      <h3>Contact Information:</h3>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phoneNumber}</p>
      <p><strong>IP Address:</strong> ${ipAddress}</p>
      
      <h3>Company Details:</h3>
      <p><strong>Total Employees:</strong> ${numEmployees}</p>
      <p><strong>Average Annual Salary:</strong> ${formatINR(avgAnnualSalary)}</p>
      <p><strong>Annual Revenue:</strong> ${formatINR(annualRevenue)}</p>
      <p><strong>Employees Who Left:</strong> ${employeesWhoLeft}</p>
      <p><strong>Average Absenteeism Days:</strong> ${avgExtraAbsenteeismDaysPerEmployee}</p>
      <p><strong>Engagement Score:</strong> ${engagementScore}/10</p>
      
      <h3>Calculated Results:</h3>
      <p><strong>Total Turnover Cost:</strong> <span style="color: red;">${formatINR(calculatedResults.totalTurnoverCost)}</span></p>
      <p><strong>Total Disengagement Cost:</strong> <span style="color: red;">${formatINR(calculatedResults.totalDisengagementCost)}</span></p>
      <p><strong>Total Absenteeism Cost:</strong> <span style="color: red;">${formatINR(calculatedResults.totalAbsenteeismCost)}</span></p>
      <p><strong>Total Hidden Loss:</strong> <span style="color: red; font-size: 18px;">${formatINR(calculatedResults.totalHiddenLoss)}</span></p>
      <p><strong>Potential Savings:</strong> <span style="color: green;">${formatINR(calculatedResults.potentialSavingsMin)} - ${formatINR(calculatedResults.potentialSavingsMax)}</span></p>
      <p><strong>Potential Revenue Increase:</strong> <span style="color: green;">${formatINR(calculatedResults.potentialRevenueIncreaseMin)} - ${formatINR(calculatedResults.potentialRevenueIncreaseMax)}</span></p>
      
      <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>
    `;

    const mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: 'info@onethrive.in',
      subject: emailSubject,
      html: emailBody,
      replyTo: email
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ 
      success: true, 
      message: 'ROI calculation submitted successfully',
      results: calculatedResults
    });

  } catch (error) {
    console.error('Error processing ROI calculator:', error);
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

// Get all ROI calculations
app.get('/api/roi-calculations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const calculations = await ROICalculator.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await ROICalculator.countDocuments();

    res.status(200).json({
      calculations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching ROI calculations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'OneThrive Unified API is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      contact: '/api/contact (POST)',
      contacts: '/api/contacts (GET)',
      'roi-calculator': '/api/roi-calculator (POST)',
      'roi-calculations': '/api/roi-calculations (GET)'
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

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 OneThrive Unified Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📋 Available endpoints:`);
  console.log(`   - POST /api/contact`);
  console.log(`   - GET  /api/contacts`);
  console.log(`   - POST /api/roi-calculator`);
  console.log(`   - GET  /api/roi-calculations`);
  console.log(`   - GET  /api/health`);
});