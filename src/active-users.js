require("dotenv").config();
const Snoowrap = require("snoowrap");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

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
  "entrepreneurship",
  "sales",
  "b2b_sales",
  "b2bmarketing",
  "B2BForHire",
  "B2BSaaS",
  "networking",
];

const TIME_PERIODS = ["year", "month", "week", "day"];
const SORT_METHODS = ["top", "hot", "new", "controversial"];

function getRandomTimeAndSort() {
  const timePeriod =
    TIME_PERIODS[Math.floor(Math.random() * TIME_PERIODS.length)];
  const sortMethod =
    SORT_METHODS[Math.floor(Math.random() * SORT_METHODS.length)];
  return { timePeriod, sortMethod };
}

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

async function getExistingUsers() {
  try {
    const data = await fs.readFile(ACTIVE_USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    logger.info("No existing users file found, starting fresh");
    return [];
  }
}

async function getMostActiveUsers(subreddits) {
  try {
    logger.info(
      `Starting to fetch active users from ${subreddits.length} subreddits`
    );
    const userActivity = {};
    const { timePeriod, sortMethod } = getRandomTimeAndSort();
    logger.info(`Using time period: ${timePeriod}, sort method: ${sortMethod}`);

    for (const subredditName of subreddits) {
      logger.info(`Processing subreddit: ${subredditName}`);
      const subreddit = await reddit.getSubreddit(subredditName);
      let attempts = 0;

      // Fetch posts based on random time period and sort method
      let posts;
      while (true) {
        try {
          logger.info(
            `Fetching ${sortMethod} posts from ${subredditName} for the past ${timePeriod}`
          );
          switch (sortMethod) {
            case "top":
              posts = await subreddit.getTop({
                time: timePeriod,
                limit: 50000,
              });
              break;
            case "hot":
              posts = await subreddit.getHot({ limit: 10000 });
              break;
            case "new":
              posts = await subreddit.getNew({ limit: 10000 });
              break;
            case "controversial":
              posts = await subreddit.getControversial({
                time: timePeriod,
                limit: 50000,
              });
              break;
          }
          logger.info(
            `Successfully fetched ${posts.length} ${sortMethod} posts from ${subredditName}`
          );
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

      logger.info(
        `Completed processing ${subredditName}. Found ${
          Object.keys(userActivity).length
        } active users so far`
      );
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // Calculate activity score and sort users
    logger.info(
      `Processing final results for ${Object.keys(userActivity).length} users`
    );
    const activeUsers = Object.entries(userActivity)
      .map(([username, data]) => ({
        username,
        posts: data.posts,
        karma: data.karma,
        subreddits: Array.from(data.subreddits),
      }))
      .filter((user) => user.posts >= 5)
      .filter((user) => user.karma >= 1000)
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

    // Get existing users
    const existingUsers = await getExistingUsers();
    const existingUsernames = new Set(
      existingUsers.map((user) => user.username)
    );
    logger.info(`Found ${existingUsers.length} existing users in the database`);

    // Fetch most active users
    const activeUsers = await getMostActiveUsers(TARGET_SUBREDDITS);
    if (activeUsers.length > 0) {
      // Filter out existing users
      const newUsers = activeUsers.filter(
        (user) => !existingUsernames.has(user.username)
      );
      logger.info(
        `Found ${newUsers.length} new users out of ${activeUsers.length} total users`
      );

      if (newUsers.length > 0) {
        logger.info(
          `Sending notifications for ${newUsers.length} new users...`
        );

        // Send notifications for new users only
        for (const user of newUsers) {
          await sendActiveUserNotification(user);
          logger.info(`Sent notification for new user: ${user.username}`);
          // Add delay between notifications to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Send summary report
        const summaryMessage =
          `📊 New Users Summary\n\n` +
          `Found ${newUsers.length} new active users out of ${activeUsers.length} total users.\n` +
          `All new users have been sent as individual messages.\n` +
          `Full report saved to ${ACTIVE_USERS_FILE}`;
        await telegramBot.sendMessage(
          process.env.TELEGRAM_CHAT_ID,
          summaryMessage
        );
        logger.info("Sent summary message to Telegram");
      } else {
        logger.info("No new users found to notify");
      }
    } else {
      logger.warn("No active users found");
    }

    logger.info("Completed active users analysis");
  } catch (error) {
    logger.error("Fatal error in main process:", error);
    process.exit(1);
  }
}

// Schedule the job to run at 9 AM every day by Almaty time or 4 AM UTC
cron.schedule("0 4 * * *", async () => {
  logger.info("Starting scheduled Reddit active users analysis at 9 AM");

  await main();

  logger.info("Completed scheduled Reddit active users analysis");
});

logger.info("Reddit active users analysis - Will run daily at 9 AM");
