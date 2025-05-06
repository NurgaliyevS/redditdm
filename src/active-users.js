require("dotenv").config();
const Snoowrap = require("snoowrap");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

// Initialize Reddit client
const reddit = new Snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT_2,
  clientId: process.env.REDDIT_CLIENT_ID_2,
  clientSecret: process.env.REDDIT_CLIENT_SECRET_2,
  username: process.env.REDDIT_USERNAME_2,
  password: process.env.REDDIT_PASSWORD_2,
});

// Initialize Telegram bot
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
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
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

const ACTIVE_USERS_FILE = "data/active_users.json";
const TARGET_SUBREDDITS = [
  "LeadGeneration",
  "smallbusiness",
  "GrowthHacking",
  "Entrepreneur",
  "startups",
  "marketing",
  "digitalmarketing",
  "socialmedia",
  "content_marketing",
  "business",
];

async function saveActiveUsers(users) {
  await fs.mkdir(path.dirname(ACTIVE_USERS_FILE), { recursive: true });
  await fs.writeFile(ACTIVE_USERS_FILE, JSON.stringify(users, null, 2));
}

async function sendActiveUserNotification(user) {
  try {
    const profileUrl = `https://reddit.com/user/${user.username}`;
    const message = 
      `🎯 Top User Found!\n\n` +
      `👤 Username: ${user.username}\n` +
      `🔗 Profile: ${profileUrl}\n` +
      `📊 Activity:\n` +
      `   • Posts: ${user.posts}\n` +
      `   • Total Karma: ${user.karma}\n` +
      `🎯 Active in: ${user.subreddits.join(", ")}\n\n` +
      `💡 Consider reaching out manually about Post Content!`;

    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    logger.info(`Sent Telegram notification for active user ${user.username}`);
  } catch (error) {
    logger.error("Error sending Telegram notification:", error);
  }
}

async function getMostActiveUsers(subreddits) {
  try {
    logger.info(`Starting to fetch active users from ${subreddits.length} subreddits`);
    const userActivity = {};
    
    for (const subredditName of subreddits) {
      logger.info(`Processing subreddit: ${subredditName}`);
      const subreddit = await reddit.getSubreddit(subredditName);
      let attempts = 0;

      // Fetch top posts from the past year
      let posts;
      while (true) {
        try {
          logger.info(`Fetching top posts from ${subredditName}`);
          posts = await subreddit.getTop({ time: 'year', limit: 500 });
          logger.info(`Successfully fetched ${posts.length} top posts from ${subredditName}`);
          break;
        } catch (err) {
          if (
            err.statusCode === 429 ||
            (err.message && err.message.includes("rate limit"))
          ) {
            logger.info(
              `Reddit API rate limit hit for posts in ${subredditName}. Waiting 60 seconds...`
            );
            await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
            attempts++;
            if (attempts > 5)
              throw new Error("Too many rate limit retries for posts.");
          } else {
            logger.error(`Error fetching posts from ${subredditName}:`, err);
            throw err;
          }
        }
      }

      // Count posts and karma
      logger.info(`Processing ${posts.length} posts from ${subredditName}`);
      for (const post of posts) {
        const username = post.author.name;
        if (username === "[deleted]") continue;
        
        userActivity[username] = userActivity[username] || {
          posts: 0,
          karma: 0,
          subreddits: new Set(),
        };
        userActivity[username].posts += 1;
        userActivity[username].karma += post.score;
        userActivity[username].subreddits.add(subredditName);
      }

      logger.info(`Completed processing ${subredditName}. Found ${Object.keys(userActivity).length} active users so far`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // Calculate activity score and sort users
    logger.info(`Processing final results for ${Object.keys(userActivity).length} users`);
    const activeUsers = Object.entries(userActivity)
      .map(([username, data]) => ({
        username,
        posts: data.posts,
        karma: data.karma,
        subreddits: Array.from(data.subreddits),
      }))
      .filter(user => user.posts >= 5)
      .sort((a, b) => b.karma - a.karma);

    // Save results
    await saveActiveUsers(activeUsers);
    logger.info(
      `Found ${activeUsers.length} active users (with 5+ posts) across ${subreddits.length} subreddits. Top user: ${activeUsers[0]?.username} with ${activeUsers[0]?.karma} karma`
    );

    return activeUsers;
  } catch (error) {
    logger.error("Error fetching active users:", error);
    throw error;
  }
}

async function main() {
  try {
    logger.info("Starting active users analysis");
    
    // Fetch most active users
    const activeUsers = await getMostActiveUsers(TARGET_SUBREDDITS);
    if (activeUsers.length > 0) {
      logger.info(`Found ${activeUsers.length} active users. Sending notifications...`);
      
      // Send notifications for all users
      for (const user of activeUsers) {
        await sendActiveUserNotification(user);
        logger.info(`Sent notification for user: ${user.username}`);
        // Add delay between notifications to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Send summary report
      const summaryMessage =
        `📊 Top Users Summary\n\n` +
        `Found ${activeUsers.length} active users across ${TARGET_SUBREDDITS.length} subreddits.\n` +
        `All users have been sent as individual messages.\n` +
        `Full report saved to ${ACTIVE_USERS_FILE}`;
      await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, summaryMessage);
      logger.info("Sent summary message to Telegram");
    } else {
      logger.warn("No active users found");
    }
    
    logger.info("Completed active users analysis");
  } catch (error) {
    logger.error("Fatal error in main process:", error);
    process.exit(1);
  }
}

main(); 