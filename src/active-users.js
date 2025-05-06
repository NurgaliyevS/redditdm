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
      `🎯 Potential Lead Found!\n\n` +
      `👤 Username: ${user.username}\n` +
      `🔗 Profile: ${profileUrl}\n` +
      `📊 Activity:\n` +
      `   • Posts: ${user.posts}\n` +
      `   • Comments: ${user.comments}\n` +
      `   • Total Actions: ${user.totalActivity}\n` +
      `🎯 Active in: ${user.subreddits.join(", ")}\n\n` +
      `💡 Consider reaching out manually about Post Content!`;

    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    logger.info(`Sent Telegram notification for active user ${user.username}`);
  } catch (error) {
    logger.error("Error sending Telegram notification:", error);
  }
}

async function getMostActiveUsers(subreddits, limit = 50) {
  try {
    const userActivity = {};
    
    for (const subredditName of subreddits) {
      const subreddit = await reddit.getSubreddit(subredditName);
      let attempts = 0;

      // Fetch recent posts
      let posts;
      while (true) {
        try {
          posts = await subreddit.getNew({ limit: 100 });
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
            throw err;
          }
        }
      }

      // Fetch recent comments
      let comments;
      attempts = 0;
      while (true) {
        try {
          comments = await subreddit.getNewComments({ limit: 100 });
          break;
        } catch (err) {
          if (
            err.statusCode === 429 ||
            (err.message && err.message.includes("rate limit"))
          ) {
            logger.info(
              `Reddit API rate limit hit for comments in ${subredditName}. Waiting 60 seconds...`
            );
            await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
            attempts++;
            if (attempts > 5)
              throw new Error("Too many rate limit retries for comments.");
          } else {
            throw err;
          }
        }
      }

      // Count posts
      for (const post of posts) {
        const username = post.author.name;
        if (username === "[deleted]")
          continue;
        userActivity[username] = userActivity[username] || {
          posts: 0,
          comments: 0,
          subreddits: new Set(),
        };
        userActivity[username].posts += 1;
        userActivity[username].subreddits.add(subredditName);
      }

      // Count comments
      for (const comment of comments) {
        const username = comment.author.name;
        if (username === "[deleted]")
          continue;
        userActivity[username] = userActivity[username] || {
          posts: 0,
          comments: 0,
          subreddits: new Set(),
        };
        userActivity[username].comments += 1;
        userActivity[username].subreddits.add(subredditName);
      }

      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // Calculate activity score and sort users
    const activeUsers = Object.entries(userActivity)
      .map(([username, data]) => ({
        username,
        posts: data.posts,
        comments: data.comments,
        totalActivity: data.posts + data.comments,
        subreddits: Array.from(data.subreddits),
      }))
      .sort((a, b) => b.totalActivity - a.totalActivity)
      .slice(0, limit);

    // Save results
    await saveActiveUsers(activeUsers);
    logger.info(
      `Found ${activeUsers.length} active users across ${subreddits.length} subreddits`
    );

    return activeUsers;
  } catch (error) {
    logger.error("Error fetching active users:", error);
    return [];
  }
}

async function main() {
  logger.info("Starting active users analysis");
  
  // Fetch most active users
  const activeUsers = await getMostActiveUsers(TARGET_SUBREDDITS, 50);
  if (activeUsers.length > 0) {
    // Send individual notifications for top 5 most active users
    for (const user of activeUsers.slice(0, 5)) {
      await sendActiveUserNotification(user);
      // Add delay between notifications
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Send summary report
    const summaryMessage =
      `📊 Daily Active Users Summary\n\n` +
      `Found ${activeUsers.length} active users across ${TARGET_SUBREDDITS.length} subreddits.\n` +
      `Top 5 users have been sent as individual messages.\n` +
      `Full report saved to ${ACTIVE_USERS_FILE}`;
    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, summaryMessage);
  }
  
  logger.info("Completed active users analysis");
}

main(); 