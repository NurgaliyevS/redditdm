require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");
const Snoowrap = require("snoowrap");

// Initialize Reddit client
const reddit = new Snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Initialize Telegram bot
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN_CLIENT, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: "logs/telegram-bot/error.log",
      level: "error",
    }),
    new winston.transports.File({ filename: "logs/telegram-bot/combined.log" }),
  ],
});

logger.add(
  new winston.transports.Console({
    format: winston.format.simple(),
  })
);

// Files to read processed data
const PROCESSED_POSTS_FILE = path.join(__dirname, "..", "data", "processed_posts_client.json");

async function loadProcessedPosts() {
  try {
    const data = await fs.readFile(PROCESSED_POSTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error loading processed posts: ${error.message}`);
    return [];
  }
}

// Handle /start command
telegramBot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`Received /start command from chat ID: ${chatId}`);
  await telegramBot.sendMessage(chatId, 'Welcome! Use /leads to see all collected leads.');
});

// Handle /leads command
telegramBot.onText(/\/leads/, async (msg) => {
  const chatId = msg.chat.id;
  logger.info(`Received /leads command from chat ID: ${chatId}`);
  try {
    const processedPosts = await loadProcessedPosts();
    
    if (processedPosts.length === 0) {
      await telegramBot.sendMessage(chatId, 'No leads have been collected yet.');
      return;
    }

    await telegramBot.sendMessage(chatId, 'Processing... This may take a while...');

    // Get all leads and split into chunks of 10
    const latestLeads = processedPosts.reverse(); // Reverse the array to show latest first
    const chunkSize = 10;
    const chunks = [];
    
    for (let i = 0; i < latestLeads.length; i += chunkSize) {
      chunks.push(latestLeads.slice(i, i + chunkSize));
    }

    // Send each chunk as a separate message
    for (let i = 0; i < chunks.length; i++) {
      let message = `📊 Leads (${i * chunkSize + 1}-${Math.min((i + 1) * chunkSize, latestLeads.length)} of ${latestLeads.length}):\n\n`;
      
      for (const postId of chunks[i]) {
        try {
          const post = await reddit.getSubmission(postId).fetch();
          message += `👤 User: ${post.author.name}\n`;
          message += `🔗 Post: ${post.url}\n`;
          message += `📝 Title: ${post.title}\n\n`;
        } catch (error) {
          logger.error(`Error fetching post ${postId}:`, error);
          continue;
        }
      }

      // Send the chunk message
      await telegramBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
      // Add a small delay between messages to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // send a message to the user that the chunk is done
    await telegramBot.sendMessage(chatId, `All leads sent.`);
  } catch (error) {
    logger.error('Error fetching leads:', error);
    await telegramBot.sendMessage(chatId, 'Sorry, there was an error fetching the leads.');
  }
});

// Error handling for the bot
telegramBot.on('polling_error', (error) => {
  logger.error('Polling error:', error);
  
  // Check if it's a conflict error
  if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
    logger.info('Multiple bot instances detected. Stopping current instance...');
    telegramBot.stopPolling();
    process.exit(1); // Exit the process to prevent multiple instances
  } else {
    // For other errors, try to restart polling after a delay
    logger.info('Attempting to restart polling in 5 seconds...');
    setTimeout(() => {
      try {
        telegramBot.stopPolling();
        telegramBot.startPolling();
        logger.info('Polling restarted successfully');
      } catch (restartError) {
        logger.error('Failed to restart polling:', restartError);
      }
    }, 5000);
  }
});

logger.info("Telegram Bot Service started");