const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables - you'll set these in your hosting platform
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// In-memory storage (in production, use a real database)
let messages = [];
let config = {
  phoneNumber: '',
  sendTime: '12:00'
};

// API Routes
app.get('/', (req, res) => {
  res.json({ status: 'Server is running!' });
});

// Get all messages
app.get('/api/messages', (req, res) => {
  res.json({ messages, config });
});

// Save configuration
app.post('/api/config', (req, res) => {
  config = req.body;
  console.log('Config updated:', config);
  res.json({ success: true, config });
});

// Add a new message
app.post('/api/messages', (req, res) => {
  const newMessage = {
    id: Date.now(),
    text: req.body.text,
    sent: false,
    createdAt: new Date().toISOString()
  };
  messages.push(newMessage);
  console.log('Message added:', newMessage);
  res.json({ success: true, message: newMessage });
});

// Delete a message
app.delete('/api/messages/:id', (req, res) => {
  const id = parseInt(req.params.id);
  messages = messages.filter(m => m.id !== id);
  console.log('Message deleted:', id);
  res.json({ success: true });
});

// Function to send daily message
async function sendDailyMessage() {
  console.log('Checking for messages to send...');
  
  // Get the next unsent message
  const unsentMessages = messages.filter(m => !m.sent);
  
  if (unsentMessages.length === 0) {
    console.log('No messages to send!');
    return;
  }
  
  const messageToSend = unsentMessages[0];
  
  try {
    // Send via Twilio
    const twilioMessage = await client.messages.create({
      body: messageToSend.text,
      from: TWILIO_PHONE_NUMBER,
      to: config.phoneNumber
    });
    
    console.log('Message sent successfully!', twilioMessage.sid);
    
    // Mark as sent
    messageToSend.sent = true;
    messageToSend.sentAt = new Date().toISOString();
    
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Schedule the daily message
// This runs every day at the configured time (default noon)
function setupSchedule() {
  const [hours, minutes] = config.sendTime.split(':');
  const cronTime = `${minutes} ${hours} * * *`; // minute hour * * *
  
  console.log(`Scheduling messages for ${config.sendTime} daily`);
  
  cron.schedule(cronTime, () => {
    console.log('Running scheduled task...');
    sendDailyMessage();
  });
}

// Initialize schedule when server starts
setupSchedule();

// Manual trigger endpoint (for testing)
app.post('/api/send-now', async (req, res) => {
  await sendDailyMessage();
  res.json({ success: true, message: 'Message sent!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Twilio configured: ${TWILIO_ACCOUNT_SID ? 'Yes' : 'No'}`);
});