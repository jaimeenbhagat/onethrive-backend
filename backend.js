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

// Apply rate limiting to all endpoints
app.use('/api/contact', limiter);
app.use('/api/roi-calculator', limiter);
app.use('/api/culture-quiz', limiter);

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
// CULTURE QUIZ SCHEMA & LOGIC
// ========================

const cultureQuizSchema = new mongoose.Schema({
  // User Contact Information
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  
  // Quiz Response Data
  answers: {
    type: Map,
    of: Number,
    required: true
  },
  
  // Quiz Results
  totalScore: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  answeredCount: { type: Number, required: true },
  
  // Culture Level Result
  cultureLevel: {
    level: { type: String, required: true },
    description: [{ type: String }],
    cta: { type: String, required: true }
  },
  
  // Calculated Metrics
  scorePercentage: { type: Number, required: true },
  completionRate: { type: Number, required: true },
  
  // Metadata
  submittedAt: { type: Date, default: Date.now },
  ipAddress: { type: String },
  userAgent: { type: String }
}, { timestamps: true });

const CultureQuiz = mongoose.model('CultureQuiz', cultureQuizSchema);

// ========================
// EMAIL CONFIGURATION (Brevo SMTP - port 465 SSL, works on Render)
// ========================

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  }
});

transporter.verify((error) => {
  if (error) console.error('❌ Email configuration error:', error.message);
  else console.log('✅ Email server is ready (Brevo SMTP port 465)');
});

async function sendEmail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: `"OneThrive" <${process.env.SENDER_EMAIL}>`,
    to,
    subject,
    html,
    ...(replyTo && { replyTo })
  });
}

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

// Helper function to format quiz answers for email
function formatQuizAnswers(answers) {
  if (!answers || typeof answers !== 'object') return 'No answers provided';
  
  let formattedAnswers = '';
  for (const [questionId, score] of Object.entries(answers)) {
    formattedAnswers += `Question ${questionId}: ${score} points\n`;
  }
  return formattedAnswers;
}

// Helper function to get culture level description
function getCultureLevelDescription(level) {
  const descriptions = {
    'THRIVING ECOSYSTEM': 'Your company demonstrates exceptional culture with high engagement and innovation.',
    'GROWING GARDEN': 'Your company has a positive culture with room for strategic improvements.',
    'BUDDING POTENTIAL': 'Your company shows promise but needs focused culture development.',
    'DORMANT SEED': 'Your company requires significant culture transformation to unlock potential.'
  };
  return descriptions[level] || 'Culture assessment completed';
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

    // Respond immediately after saving — don't wait for email
    res.status(200).json({ success: true, message: 'Contact form submitted successfully' });

    // Send email in background (non-blocking)
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

    // Send email in background (non-blocking)
    sendEmail({ to: 'info@onethrive.in', subject: emailSubject, html: emailBody, replyTo: workEmail })
      .then(() => console.log(`✅ Contact email sent for ${fullName}`))
      .catch(err => console.error('❌ Failed to send contact email:', err.message));

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

    // Respond immediately after saving — don't wait for email
    res.status(200).json({ 
      success: true, 
      message: 'ROI calculation submitted successfully',
      results: calculatedResults
    });

    // Send email in background (non-blocking)
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

    // Send email in background (non-blocking)
    sendEmail({ to: 'info@onethrive.in', subject: emailSubject, html: emailBody, replyTo: email })
      .then(() => console.log(`✅ ROI email sent for ${email}`))
      .catch(err => console.error('❌ Failed to send ROI email:', err.message));

  } catch (error) {
    console.error('Error processing ROI calculator:', error);
    res.status(500).json({ error: 'Internal server error. Please try again later.' });
  }
});

// Culture Quiz submission endpoint
app.post('/api/culture-quiz-results', async (req, res) => {
  try {
    const {
      email,
      answers,
      totalScore,
      totalQuestions,
      answeredCount,
      cultureLevel
    } = req.body;

    // Validation
    if (!email || !answers || totalScore === undefined || !totalQuestions || !answeredCount || !cultureLevel) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Validate answers is an object
    if (typeof answers !== 'object' || answers === null) {
      return res.status(400).json({ error: 'Invalid answers format' });
    }

    // Validate cultureLevel structure
    if (!cultureLevel.level || !cultureLevel.description || !cultureLevel.cta) {
      return res.status(400).json({ error: 'Invalid culture level data' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Calculate metrics
    const scorePercentage = Math.round((totalScore / (totalQuestions * 14)) * 100);
    const completionRate = Math.round((answeredCount / totalQuestions) * 100);

    // Save to database
    const quizData = new CultureQuiz({
      email,
      answers: new Map(Object.entries(answers)),
      totalScore,
      totalQuestions,
      answeredCount,
      cultureLevel,
      scorePercentage,
      completionRate,
      ipAddress,
      userAgent
    });

    await quizData.save();

    // Respond immediately after saving — don't wait for email
    res.status(200).json({ 
      success: true, 
      message: 'Culture quiz submitted successfully',
      data: {
        scorePercentage,
        completionRate,
        level: cultureLevel.level
      }
    });

    // Send email in background (non-blocking)
    const emailSubject = `New Culture Quiz Submission - ${cultureLevel.level}`;
    const emailBody = `
      <h2>🎯 New Culture Quiz Submission</h2>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #00FFAB;">📊 Quiz Results Summary</h3>
        <p><strong>Culture Level:</strong> <span style="color: #00FFAB; font-size: 18px;">${cultureLevel.level}</span></p>
        <p><strong>Score:</strong> ${totalScore} out of ${totalQuestions * 14} points (${scorePercentage}%)</p>
        <p><strong>Completion Rate:</strong> ${completionRate}% (${answeredCount}/${totalQuestions} questions)</p>
      </div>

      <h3>👤 User Information</h3>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>IP Address:</strong> ${ipAddress}</p>
      <p><strong>User Agent:</strong> ${userAgent}</p>
      <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>

      <h3>📝 Culture Assessment</h3>
      <p><strong>Level:</strong> ${cultureLevel.level}</p>
      <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h4>Description:</h4>
        ${cultureLevel.description.map(point => `<p>• ${point}</p>`).join('')}
      </div>
      
      <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h4>Call to Action:</h4>
        <p>${cultureLevel.cta.replace(/\*\*/g, '')}</p>
      </div>

      <h3>🔢 Detailed Answers</h3>
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 12px;">
        ${Object.entries(answers).map(([questionId, score]) => 
          `<p>Question ${questionId}: ${score} points</p>`
        ).join('')}
      </div>

      <hr style="margin: 30px 0;">
      
      <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
        <h4>🚀 Follow-up Opportunity</h4>
        <p>This user has shown interest in culture assessment. Consider reaching out to discuss:</p>
        <ul>
          <li>Detailed culture audit services</li>
          <li>Employee engagement programs</li>
          <li>Team building activities</li>
          <li>Custom culture transformation solutions</li>
        </ul>
      </div>
    `;

    // Send email in background (non-blocking)
    sendEmail({ to: 'info@onethrive.in', subject: emailSubject, html: emailBody, replyTo: email })
      .then(() => console.log(`✅ Culture quiz email sent for ${email}`))
      .catch(err => console.error('❌ Failed to send culture quiz email:', err.message));

  } catch (error) {
    console.error('Error processing culture quiz:', error);
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

// Get all culture quiz submissions
app.get('/api/culture-quiz', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const submissions = await CultureQuiz.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await CultureQuiz.countDocuments();

    // Calculate summary statistics
    const stats = await CultureQuiz.aggregate([
      {
        $group: {
          _id: null,
          avgScore: { $avg: '$scorePercentage' },
          avgCompletion: { $avg: '$completionRate' },
          totalSubmissions: { $sum: 1 }
        }
      }
    ]);

    // Get distribution by culture level
    const levelDistribution = await CultureQuiz.aggregate([
      {
        $group: {
          _id: '$cultureLevel.level',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.status(200).json({
      submissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      statistics: {
        summary: stats[0] || { avgScore: 0, avgCompletion: 0, totalSubmissions: 0 },
        levelDistribution
      }
    });
  } catch (error) {
    console.error('Error fetching culture quiz submissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
      message: 'OneThrive API Server is running',
      timestamp: new Date().toISOString(),
      endpoints: {
        contact: '/api/contact',
        roiCalculator: '/api/roi-calculator',
        cultureQuiz: '/api/culture-quiz',
        health: '/api/health'
      }
    });
  });
  app.post('/api/culture-quiz-email', async (req, res) => {
    try {
      const { email, quizType, timestamp } = req.body;
  
      // Validation
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
  
      // Validate email format
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
  
      const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
  
      // Create a simple schema for email collection if it doesn't exist
      const cultureQuizEmailSchema = new mongoose.Schema({
        email: {
          type: String,
          required: true,
          trim: true,
          lowercase: true,
          match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
        },
        quizType: { type: String, default: 'culture_quiz' },
        submittedAt: { type: Date, default: Date.now },
        ipAddress: { type: String },
        userAgent: { type: String }
      }, { timestamps: true });
  
      // Check if model already exists to avoid re-compilation error
      const CultureQuizEmail = mongoose.models.CultureQuizEmail || mongoose.model('CultureQuizEmail', cultureQuizEmailSchema);
  
      // Save email to database
      const emailData = new CultureQuizEmail({
        email,
        quizType: quizType || 'culture_quiz',
        ipAddress,
        userAgent
      });
  
      await emailData.save();
  
      // Send email notification to owner
      const emailSubject = `New Culture Quiz Email Submission - ${email}`;
      const emailBody = `
        <h2>📧 New Culture Quiz Email Submission</h2>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #00FFAB;">📊 Email Collection</h3>
          <p><strong>Email:</strong> <span style="color: #00FFAB; font-size: 18px;">${email}</span></p>
          <p><strong>Quiz Type:</strong> ${quizType || 'culture_quiz'}</p>
          <p><strong>Timestamp:</strong> ${timestamp || new Date().toISOString()}</p>
        </div>
  
        <h3>👤 User Information</h3>
        <p><strong>IP Address:</strong> ${ipAddress}</p>
        <p><strong>User Agent:</strong> ${userAgent}</p>
        <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>
  
        <hr style="margin: 30px 0;">
        
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
          <h4>🚀 Follow-up Opportunity</h4>
          <p>This user has provided their email for culture quiz access. Consider reaching out to discuss:</p>
          <ul>
            <li>Culture assessment services</li>
            <li>Employee engagement programs</li>
            <li>Team building activities</li>
            <li>Custom culture transformation solutions</li>
          </ul>
        </div>
      `;
  
      const mailOptions = {
        from: process.env.SENDER_EMAIL,
        to: 'info@onethrive.in',
        subject: emailSubject,
        html: emailBody,
        replyTo: email
      };
  
      // Respond immediately — don't wait for email
      res.status(200).json({ 
        success: true, 
        message: 'Email submitted successfully for culture quiz access'
      });

      // Send email in background (non-blocking)
      sendEmail({ to: 'info@onethrive.in', subject: emailSubject, html: emailBody, replyTo: email })
        .then(() => console.log(`✅ Culture quiz email notification sent for ${email}`))
        .catch(err => console.error('❌ Failed to send culture quiz email notification:', err.message));
  
    } catch (error) {
      console.error('Error processing culture quiz email:', error);
      res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
  });
  
  // Optional: Add endpoint to get all culture quiz email submissions
  app.get('/api/culture-quiz-emails', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
  
      // Check if model exists
      const CultureQuizEmail = mongoose.models.CultureQuizEmail;
      if (!CultureQuizEmail) {
        return res.status(404).json({ error: 'No email submissions found' });
      }
  
      const emails = await CultureQuizEmail.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v');
  
      const total = await CultureQuizEmail.countDocuments();
  
      res.status(200).json({
        emails,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching culture quiz emails:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // 404 handler for undefined routes
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      message: 'The requested endpoint does not exist'
    });
  });
  
  // Global error handler
  app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Something went wrong on our end'
    });
  });
  
  // Start server
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 API URL: http://localhost:${PORT}`);
  });
  
  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully...');
    mongoose.connection.close();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('👋 SIGINT received, shutting down gracefully...');
    mongoose.connection.close();
    process.exit(0);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err, promise) => {
    console.error('❌ Unhandled Promise Rejection:', err);
    console.error('❌ Promise:', promise);
    process.exit(1);
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
  });
  
  module.exports = app;