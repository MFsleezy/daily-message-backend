const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables
const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'gmail'; // gmail, outlook, etc.
const EMAIL_USER = process.env.EMAIL_USER; // your email
const EMAIL_PASS = process.env.EMAIL_PASS; // your email password or app password

// Initialize email transporter
let transporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: EMAIL_SERVICE,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
  console.log('✅ Email transporter initialized');
} else {
  console.log('⚠️  Email credentials not found - SMS sending will not work');
}

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// In-memory storage (loaded from files)
let messages = [];
let config = {
  phoneNumber: '',
  sendTime: '12:00',
  carrier: 'att' // Default to AT&T
};

// Carrier to SMS email mapping
const CARRIER_DOMAINS = {
  'att': 'txt.att.net',
  'verizon': 'vtext.com',
  'tmobile': 'tmomail.net',
  'sprint': 'messaging.sprintpcs.com',
  'uscellular': 'email.uscc.net',
  'boost': 'sms.myboostmobile.com',
  'cricket': 'sms.cricketwireless.net',
  'metropcs': 'mymetropcs.com'
};

// Initialize data directory and files
async function initializeStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('✅ Data directory ready');
    
    // Load messages
    try {
      const messagesData = await fs.readFile(MESSAGES_FILE, 'utf8');
      messages = JSON.parse(messagesData);
      console.log(`✅ Loaded ${messages.length} messages`);
    } catch (err) {
      console.log('📝 No existing messages file, starting fresh');
      await saveMessages();
    }
    
    // Load config
    try {
      const configData = await fs.readFile(CONFIG_FILE, 'utf8');
      config = JSON.parse(configData);
      console.log('✅ Config loaded');
    } catch (err) {
      console.log('📝 No existing config file, starting fresh');
      await saveConfig();
    }
  } catch (err) {
    console.error('❌ Error initializing storage:', err);
  }
}

// Save functions
async function saveMessages() {
  try {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error('Error saving messages:', err);
  }
}

async function saveConfig() {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// Convert phone number to SMS email address
function phoneToSmsEmail(phoneNumber, carrier) {
  // Remove +1 and any non-digits
  const cleanNumber = phoneNumber.replace(/\D/g, '').replace(/^1/, '');
  const domain = CARRIER_DOMAINS[carrier] || CARRIER_DOMAINS.att;
  return `${cleanNumber}@${domain}`;
}

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running!',
    emailConfigured: !!transporter,
    messagesCount: messages.length,
    config: config
  });
});

// Get all messages and config
app.get('/api/messages', (req, res) => {
  res.json({ messages, config });
});

// Save configuration
app.post('/api/config', async (req, res) => {
  try {
    config = {
      phoneNumber: req.body.phoneNumber,
      sendTime: req.body.sendTime || '12:00',
      carrier: req.body.carrier || 'att'
    };
    await saveConfig();
    console.log('✅ Config updated:', config);
    
    // Restart scheduler with new time
    setupSchedule();
    
    res.json({ success: true, config });
  } catch (err) {
    console.error('Error saving config:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add a new message
app.post('/api/messages', async (req, res) => {
  try {
    const newMessage = {
      id: Date.now(),
      text: req.body.text,
      sent: false,
      createdAt: new Date().toISOString()
    };
    messages.push(newMessage);
    await saveMessages();
    console.log('✅ Message added:', newMessage.text);
    res.json({ success: true, message: newMessage });
  } catch (err) {
    console.error('Error adding message:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a message
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    messages = messages.filter(m => m.id !== id);
    await saveMessages();
    console.log('✅ Message deleted:', id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ error: err.message });
  }
});

// Function to send daily message
async function sendDailyMessage() {
  console.log('🔍 Checking for messages to send...');
  
  // Get the next unsent message
  const unsentMessages = messages.filter(m => !m.sent);
  
  if (unsentMessages.length === 0) {
    console.log('⚠️  No messages to send!');
    return { success: false, message: 'No messages queued' };
  }
  
  if (!transporter) {
    console.log('❌ Email not configured - cannot send SMS');
    return { success: false, message: 'Email not configured' };
  }
  
  if (!config.phoneNumber) {
    console.log('❌ No phone number configured');
    return { success: false, message: 'No phone number configured' };
  }
  
  const messageToSend = unsentMessages[0];
  const smsEmail = phoneToSmsEmail(config.phoneNumber, config.carrier);
  
  try {
    console.log(`📤 Sending message to ${smsEmail}...`);
    
    // Send via email-to-SMS
    await transporter.sendMail({
      from: EMAIL_USER,
      to: smsEmail,
      subject: '', // Empty subject for cleaner SMS
      text: messageToSend.text
    });
    
    console.log('✅ Message sent successfully!');
    
    // Mark as sent
    messageToSend.sent = true;
    messageToSend.sentAt = new Date().toISOString();
    await saveMessages();
    
    return { success: true, message: 'Message sent!' };
    
  } catch (error) {
    console.error('❌ Error sending message:', error);
    return { success: false, message: error.message };
  }
}

// Store the current cron job
let currentCronJob = null;

// Schedule the daily message
function setupSchedule() {
  // Cancel existing job if any
  if (currentCronJob) {
    currentCronJob.stop();
  }
  
  const [hours, minutes] = config.sendTime.split(':');
  const cronTime = `${minutes} ${hours} * * *`; // minute hour * * *
  
  console.log(`⏰ Scheduling messages for ${config.sendTime} daily (cron: ${cronTime})`);
  
  currentCronJob = cron.schedule(cronTime, () => {
    console.log('⏰ Running scheduled task...');
    sendDailyMessage();
  });
}

// Manual trigger endpoint (for testing)
app.post('/api/send-now', async (req, res) => {
  console.log('🚀 Manual send triggered');
  const result = await sendDailyMessage();
  res.json(result);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    emailConfigured: !!transporter,
    messagesQueued: messages.filter(m => !m.sent).length,
    messagesSent: messages.filter(m => m.sent).length,
    config: config
  });
});

const PORT = process.env.PORT || 3000;

// Initialize and start server
async function start() {
  await initializeStorage();
  setupSchedule();
  
  app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Email configured: ${transporter ? 'Yes' : 'No'}`);
    console.log(`📊 Messages loaded: ${messages.length}`);
    console.log(`⏰ Send time: ${config.sendTime}`);
    console.log('='.repeat(50));
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});