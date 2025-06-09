require("dotenv").config();
const Snoowrap = require("snoowrap");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

// check env dev or prod
const isDev = process.env.NODE_ENV !== "production";

// Initialize Reddit client
const reddit = new Snoowrap({
  userAgent: isDev ? process.env.REDDIT_USER_AGENT_2 : process.env.REDDIT_USER_AGENT,
  clientId: isDev ? process.env.REDDIT_CLIENT_ID_2 : process.env.REDDIT_CLIENT_ID,
  clientSecret: isDev ? process.env.REDDIT_CLIENT_SECRET_2 : process.env.REDDIT_CLIENT_SECRET,
  username: isDev ? process.env.REDDIT_USERNAME_2 : process.env.REDDIT_USERNAME,
  password: isDev ? process.env.REDDIT_PASSWORD_2 : process.env.REDDIT_PASSWORD,
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

logger.add(
  new winston.transports.Console({
    format: winston.format.simple(),
  })
);

const ACTIVE_USERS_FILE = "data/active_users.json";
const TARGET_SUBREDDITS = [
  // SaaS & Tech Business
  "SaaS",
  "startup_tech",
  "startup_software",
  "startup_web",
  "startup_mobile",
  "techbusiness",
  
  // Entrepreneurship & Startups
  "startup_ideas",
  "indiehackers",
  "startup_resources",
  "techstartups",
  "startup_mentors",
  "startup_networking",
  "startup_incubator",
  "startup_accelerator",
  "startup_consulting",
  "startup_advice",
  
  // Marketing & Growth
  "marketing",
  "digitalmarketing",
  "socialmedia",
  "content_marketing",
  "b2bmarketing",
  "emailmarketing",
  "growthhacking",
  "startup_marketing",
    "marketing",
  "marketing_tech",
  "marketing_automation",
  
  // Business & Sales
  "sales",
  "b2b_sales",
  "sales_tech",
  "sales_automation",
  "sales_development",
  "sales_operations",
  "sales_engineering",
  "sales_management",
  "sales_training",
  "sales_consulting",
  
  // Community & Networking
  "startup_networking",
  "startup_mentors",
  "startup_incubator",
  "startup_accelerator",
  "startup_consulting",
  "startup_advice",
  
  // Tools & Resources
  "startup_resources",
  "startup_tools",
  "startup_software",
  "startup_tech",
  "startup_web",
  "startup_mobile",
  
  // Original subreddits
  "EntrepreneurRideAlong",
  "coldemail",
  "microsaas",
  "sideproject",
  "saasmarketing",
  "ecommerce",
  "Entrepreneurs",
  "ycombinator",
  "digital_marketing",
  "agency",
  "askmarketing"
];

// Configuration for post fetching
const POST_FETCH_CONFIG = {
  chunkSize: 100000, // Number of posts to fetch per chunk
  maxChunks: 3,      // Maximum number of chunks to fetch (0 means unlimited)
  delayBetweenChunks: 10000, // Delay between chunks in milliseconds
};

const TIME_PERIODS = ["all", "year"];
const SORT_METHODS = ["top"];

function getRandomTimeAndSort() {
  const timePeriod =
    TIME_PERIODS[Math.floor(Math.random() * TIME_PERIODS.length)];
  const sortMethod =
    SORT_METHODS[Math.floor(Math.random() * SORT_METHODS.length)];
  return { timePeriod, sortMethod };
}

function randomDelay(min = 2000, max = 7000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function saveActiveUsers(newUsers) {
  try {
    // Get existing users
    let existingUsers = [];
    try {
      const data = await fs.readFile(ACTIVE_USERS_FILE, "utf8");
      existingUsers = JSON.parse(data);
    } catch (error) {
      logger.info("No existing users file found, starting fresh");
    }

    // Create a map of existing users for easy lookup
    const existingUsersMap = new Map(
      existingUsers.map(user => [user.username, user])
    );

    // Merge new users with existing users
    for (const newUser of newUsers) {
      if (existingUsersMap.has(newUser.username)) {
        // Update existing user with new data
        const existingUser = existingUsersMap.get(newUser.username);
        existingUser.posts = newUser.posts;
        existingUser.karma = newUser.karma;
        existingUser.subreddits = newUser.subreddits;
        existingUser.crossSubredditActivity = newUser.crossSubredditActivity;
        existingUser.crossSubredditScore = newUser.crossSubredditScore;
        existingUser.lastUpdated = new Date().toISOString();
      } else {
        // Add new user
        newUser.firstSeen = new Date().toISOString();
        newUser.lastUpdated = new Date().toISOString();
        existingUsers.push(newUser);
      }
    }

    // Sort users by karma
    existingUsers.sort((a, b) => b.karma - a.karma);

    // Save the merged data
    await fs.mkdir(path.dirname(ACTIVE_USERS_FILE), { recursive: true });
    await fs.writeFile(ACTIVE_USERS_FILE, JSON.stringify(existingUsers, null, 2));
    
    logger.info(`Successfully saved ${existingUsers.length} users to ${ACTIVE_USERS_FILE}`);
  } catch (error) {
    logger.error("Error saving active users:", error);
    throw error;
  }
}

async function sendActiveUserNotification(user) {
  try {
    const profileUrl = `https://reddit.com/user/${user.username}`;
    
    // Format cross-subreddit activity
    const crossSubredditInfo = Object.entries(user.crossSubredditActivity)
      .map(([subreddit, count]) => `${subreddit}: ${count} posts`)
      .join('\n   • ');

    const message = `Hi ${user.username}.\n\nI see that you post a lot in ${user.subreddits.join(", ")} ${user.subreddits.length > 1 ? "subreddits" : "subreddit"}. Ever wish that you schedule content and cross-post content on the best time ?\n\nI developed a tool that allows you to schedule content and cross-post content on the best time.\n\nWould you be interested in trying it out ?
    `
    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, profileUrl);
    logger.info(`Sent immediate Telegram notification for new user ${user.username}`);
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
      let attempts = 0;
      while (attempts < 5) {
        try {
          const subreddit = await reddit.getSubreddit(subredditName);
          logger.info(
            `Fetching up to 1000 ${sortMethod} posts from ${subredditName} for the past ${timePeriod}`
          );
          let posts = [];
          switch (sortMethod) {
            case "top":
              posts = await subreddit.getTop({
                time: timePeriod === "all" ? "all" : timePeriod,
                limit: 1000,
              });
              break;
          }

          if (posts.length === 0) {
            logger.info(`No posts found in ${subredditName}`);
            break;
          }

          logger.info(
            `Successfully fetched ${posts.length} ${sortMethod} posts from ${subredditName}`
          );

          // Count posts and karma
          logger.info(`Processing ${posts.length} posts from ${subredditName}`);
          for (const post of posts) {
            const username = post.author.name;
            if (username === "[deleted]") continue;
            if (username === "AutoModerator") continue;

            userActivity[username] = userActivity[username] || {
              posts: 0,
              karma: 0,
              subreddits: new Set(),
              crossSubredditActivity: {},
            };
            userActivity[username].posts += 1;
            userActivity[username].karma += post.score;
            userActivity[username].subreddits.add(subredditName);
            
            // Track cross-subreddit activity
            userActivity[username].crossSubredditActivity[subredditName] = 
              (userActivity[username].crossSubredditActivity[subredditName] || 0) + 1;
          }

          logger.info(
            `Completed processing ${subredditName}. Found ${
              Object.keys(userActivity).length
            } active users so far`
          );
          break; // Success, exit retry loop
        } catch (err) {
          if (err.statusCode === 429 || (err.message && err.message.includes("rate limit"))) {
            attempts++;
            const waitTime = 60000 * attempts; // Exponential backoff: 1min, 2min, 3min, etc.
            logger.warn(
              `Rate limit hit for ${subredditName}. Waiting ${waitTime / 1000} seconds before retrying (attempt ${attempts}/5)...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else if (err.statusCode === 404 && err.response?.body?.reason === "banned") {
            logger.warn(`Subreddit ${subredditName} is banned or not found. Skipping...`);
            break;
          } else if (err.statusCode === 403 && err.response?.body?.reason === "private") {
            logger.warn(
              `Subreddit ${subredditName} is private or forbidden. Reason: ${err.response.body.reason}, Message: ${err.response.body.message}`
            );
            break;
          } else {
            // Fallback for other errors
            logger.error(
              `Error processing subreddit ${subredditName}: ${err.message || err}`,
              {
                reason: err.response?.body?.reason,
                message: err.response?.body?.message,
                statusCode: err?.statusCode,
              }
            );
            break;
          }
        }
      }
      // Random delay between subreddits
      await new Promise((resolve) => setTimeout(resolve, randomDelay()));
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
        crossSubredditActivity: data.crossSubredditActivity,
        crossSubredditScore: Object.keys(data.crossSubredditActivity).length,
      }))
      .filter((user) => user.posts >= 5)
      .filter((user) => user.karma >= 500)
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

    // Search for subreddits by keyword
    const KEYWORD = 'Entrepreneur';
    const searchResults = await reddit.searchSubreddits({query: KEYWORD, limit: 100});
    const subredditsToProcess = searchResults.map(sub => sub.display_name);

    logger.info(`Found ${subredditsToProcess.length} subreddits for keyword '${KEYWORD}': ${subredditsToProcess.join(', ')}`);

    // Fetch most active users
    const activeUsers = await getMostActiveUsers(subredditsToProcess);
    if (activeUsers.length > 0) {
      // Filter out existing users for notifications only
      const newUsers = activeUsers.filter(
        (user) => !existingUsernames.has(user.username)
      );
      logger.info(
        `Found ${newUsers.length} new users out of ${activeUsers.length} total users`
      );

      // Save all active users (both new and existing)
      await saveActiveUsers(activeUsers);

      if (newUsers.length > 0) {
        logger.info(
          `Sending notifications for ${newUsers.length} new users...`
        );

        // Send notifications for new users only
        for (const user of newUsers) {
          await sendActiveUserNotification(user);
          logger.info(`Sent notification for new user: ${user.username}`);
          // Add delay between notifications to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, randomDelay()));
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

// run every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  try {
    logger.info("Starting scheduled Reddit active users analysis every 10 minutes");

    await main();

    logger.info("Completed scheduled Reddit active users analysis");
  } catch (error) {
    logger.error("Error in scheduled Reddit active users analysis:", error);
  }
});

logger.info("Reddit active users analysis - Will run every 10 minutes");

main();