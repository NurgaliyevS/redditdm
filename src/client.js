require("dotenv").config();
const Snoowrap = require("snoowrap");
const OpenAI = require("openai");
const cron = require("node-cron");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  polling: false,
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
      filename: "logs/clients/error.log",
      level: "error",
    }),
    new winston.transports.File({ filename: "logs/clients/combined.log" }),
  ],
});

// Files to store processed data
const PROCESSED_POSTS_FILE = path.join(__dirname, "..", "data", "processed_posts_client.json");
const PROCESSED_USERS_FILE = path.join(__dirname, "..", "data", "processed_users_client.json");

// Initialize data directory
async function initializeDataDirectory() {
  try {
    const dataDir = path.join(__dirname, "..", "data");
    await fs.mkdir(dataDir, { recursive: true });
    logger.info(`Data directory initialized at: ${dataDir}`);
    
    // Initialize empty JSON files if they don't exist
    if (!await fileExists(PROCESSED_POSTS_FILE)) {
      await fs.writeFile(PROCESSED_POSTS_FILE, JSON.stringify([], null, 2));
      logger.info(`Created empty processed posts file at: ${PROCESSED_POSTS_FILE}`);
    }
    
    if (!await fileExists(PROCESSED_USERS_FILE)) {
      await fs.writeFile(PROCESSED_USERS_FILE, JSON.stringify([], null, 2));
      logger.info(`Created empty processed users file at: ${PROCESSED_USERS_FILE}`);
    }
  } catch (error) {
    logger.error(`Error initializing data directory: ${error.message}`);
    throw error;
  }
}

// Helper function to check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Initialize the application
async function initialize() {
  await initializeDataDirectory();
  logger.info("Application initialized successfully");
}

async function loadProcessedPosts() {
  try {
    const data = await fs.readFile(PROCESSED_POSTS_FILE, "utf8");
    logger.info(`Successfully loaded processed posts from: ${PROCESSED_POSTS_FILE}`);
    return JSON.parse(data);
  } catch (error) {
    logger.info(`No existing processed posts file found at ${PROCESSED_POSTS_FILE}, creating new one`);
    await fs.writeFile(PROCESSED_POSTS_FILE, JSON.stringify([], null, 2));
    return [];
  }
}

async function loadProcessedUsers() {
  try {
    const data = await fs.readFile(PROCESSED_USERS_FILE, "utf8");
    logger.info(`Successfully loaded processed users from: ${PROCESSED_USERS_FILE}`);
    return JSON.parse(data);
  } catch (error) {
    logger.info(`No existing processed users file found at ${PROCESSED_USERS_FILE}, creating new one`);
    await fs.writeFile(PROCESSED_USERS_FILE, JSON.stringify([], null, 2));
    return [];
  }
}

async function saveProcessedPosts(posts) {
  try {
    const dirPath = path.dirname(PROCESSED_POSTS_FILE);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(PROCESSED_POSTS_FILE, JSON.stringify(posts, null, 2));
    logger.info(`Successfully saved ${posts.length} processed posts to: ${PROCESSED_POSTS_FILE}`);
  } catch (error) {
    logger.error(`Error saving processed posts: ${error.message}`);
    throw error;
  }
}

async function saveProcessedUsers(users) {
  try {
    const dirPath = path.dirname(PROCESSED_USERS_FILE);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(PROCESSED_USERS_FILE, JSON.stringify(users, null, 2));
    logger.info(`Successfully saved ${users.length} processed users to: ${PROCESSED_USERS_FILE}`);
  } catch (error) {
    logger.error(`Error saving processed users: ${error.message}`);
    throw error;
  }
}

async function analyzePostWithAI(post) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a lead qualification assistant for DCNY.co (https://dcny.co), a premium development subscription service starting at $6,000/month.
                    Analyze the following Reddit post and determine if the author would be a good candidate for our service.
                    
                    Our Ideal Customer Profile (ICP):
                    - Founders and managers of established startup/tech companies
                    - Agency owners and managers with existing client base
                    - Decision makers in tech-focused businesses with budget
                    
                    Our Niche:
                    - Web development
                    - App development
                    - Software development
                    
                    Look for these signals:
                    1. Users who are founders/managers of established tech companies or agencies
                    2. Users who mention having budget for development work
                    3. Users who are looking for premium/high-quality development services
                    4. Users who mention they're currently spending significant amounts on development
                    5. Users who have existing products/services and need ongoing development
                    6. Users who mention they're looking for reliable, long-term development partners
                    
                    Budget Qualification Signals:
                    - Mentions of existing development budget
                    - References to current development costs
                    - Indications of established business
                    - Signs of successful business operations
                    - References to multiple projects or ongoing development needs
                    
                    Our service helps users:
                    - Get premium development work done through a subscription model
                    - Work with top 1% global engineering talent
                    - Get projects completed in hours/days, not weeks/months
                    - Pay a consistent rate ($6,000/month) with no contracts or negotiations
                    - Pause or cancel anytime
                    
                    Return a JSON response with:
                    {
                        "isQualified": boolean,
                        "analysis": string,
                        "reason": string
                    }`,
        },
        {
          role: "user",
          content: `Title: ${post.title}\n\nContent: ${post.selftext}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);

    console.log(result, "result");
    console.log(post.url, "post.url");

    return {
      isQualified: result.isQualified,
      analysis: result.analysis,
      reason: result.reason,
    };
  } catch (error) {
    logger.error("Error analyzing post with AI:", error);
    return {
      isQualified: false,
      analysis: "Error during analysis",
      reason: "Technical error occurred",
    };
  }
}

async function sendTelegramNotification(post) {
  try {
    const message =
      `🎯 New Lead Found!\n\n` +
      `👤 Username: ${post.author.name}\n` +
      `🔗 Post URL: ${post.url}\n`;

    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    logger.info(`Sent Telegram notification for lead ${post.author.name}`);
  } catch (error) {
    logger.error("Error sending Telegram notification:", error);
  }
}

async function processSubreddit(subredditName) {
  try {
    const processedPosts = await loadProcessedPosts();
    const processedUsers = await loadProcessedUsers();
    const subreddit = await reddit.getSubreddit(subredditName);

    let newPosts;
    let attempts = 0;
    while (true) {
      try {
        newPosts = await subreddit.getNew({ limit: 100 });
        break;
      } catch (err) {
        console.log(err, "err");
        console.log(err.statusCode, "err.statusCode");
        console.log(err.message, "err.message");
        if (
          err.statusCode === 429 ||
          (err.message && err.message.includes("rate limit"))
        ) {
          logger.info(
            "Reddit API rate limit hit. Waiting 60 seconds before retrying..."
          );
          await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
          attempts++;
          if (attempts > 5) throw new Error("Too many rate limit retries.");
        } else {
          throw err;
        }
      }
    }

    for (const post of newPosts) {
      // Check if post is already processed
      if (processedPosts.includes(post.id)) {
        logger.info(`Skipping already processed post ${post.id}`);
        continue;
      }

      // Check if user is already processed
      if (processedUsers.includes(post.author.name)) {
        logger.info(`Skipping post from already processed user ${post.author.name}`);
        continue;
      }

      const analysis = await analyzePostWithAI(post);
      if (analysis.isQualified) {
        // Double check again before sending notification to prevent race conditions
        if (processedPosts.includes(post.id) || processedUsers.includes(post.author.name)) {
          logger.info(`Skipping duplicate qualified post ${post.id} from user ${post.author.name}`);
          continue;
        }

        await sendTelegramNotification(post);
        processedPosts.push(post.id);
        processedUsers.push(post.author.name);
        logger.info(`Added qualified post ${post.id} from user ${post.author.name}`);
        
        // Save immediately after finding a qualified post
        try {
          await saveProcessedPosts(processedPosts);
          await saveProcessedUsers(processedUsers);
          logger.info(`Saved updated data: ${processedPosts.length} posts and ${processedUsers.length} users`);
        } catch (error) {
          logger.error(`Error saving data after finding qualified post: ${error.message}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    logger.info(
      `Reddit API rate limit: ${reddit.ratelimitRemaining} requests remaining.`
    );
  } catch (error) {
    logger.error("Error processing subreddit:", error);
  }
}

// Target subreddits to monitor
const TARGET_SUBREDDITS = [
  "startups",
  "entrepreneur",
  "ycombinator",
  "venturecapital",
  "Entrepreneurs",
  "Entrepreneurship",
  "EntrepreneurRideAlong",
];

// every minute
cron.schedule("* * * * *", async () => {
  logger.info("Starting scheduled Reddit analysis");

  for (const subreddit of TARGET_SUBREDDITS) {
    await processSubreddit(subreddit.trim());
  }

  logger.info("Completed scheduled Reddit analysis");
});

// Initial run - removed to prevent immediate execution
initialize().then(() => {
  logger.info("Reddit AI Analyzer started - Will run daily at 9 AM");
}).catch(error => {
  logger.error("Failed to initialize application:", error);
  process.exit(1);
});
