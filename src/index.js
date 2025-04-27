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

// File to store processed post IDs
const PROCESSED_POSTS_FILE = "data/processed_posts.json";

async function loadProcessedPosts() {
  try {
    const data = await fs.readFile(PROCESSED_POSTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveProcessedPosts(posts) {
  await fs.mkdir(path.dirname(PROCESSED_POSTS_FILE), { recursive: true });
  await fs.writeFile(PROCESSED_POSTS_FILE, JSON.stringify(posts, null, 2));
}

async function analyzePostWithAI(post) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a lead qualification assistant for Post Content, a Reddit post scheduling service. 
                    Analyze the following Reddit post and determine if the author would be a good candidate for our service.
                    Look for these signals:
                    1. Users who are actively posting on Reddit
                    2. Users who mention struggling with time management for social media
                    3. Users who want to grow their business or personal brand
                    4. Users who mention needing help with content scheduling
                    5. Users who are looking for marketing solutions
                    6. Users who mention spending too much time on social media management
                    
                    Our service helps users:
                    - Schedule and automate Reddit posts
                    - Save time on social media management
                    - Grow their audience consistently
                    - Cross-post to multiple subreddits
                    
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
    const subreddit = await reddit.getSubreddit(subredditName);

    let newPosts;
    let attempts = 0;
    while (true) {
      try {
        newPosts = await subreddit.getNew({ limit: 50 });
        break; // Success, exit the retry loop
      } catch (err) {
        console.log(err, "err");
        console.log(err.statusCode, "err.statusCode");
        console.log(err.message, "err.message");
        if (
          err.statusCode === 429 ||
          (err.message && err.message.includes("rate limit"))
        ) {
          // 429 is the HTTP status for Too Many Requests
          logger.info(
            "Reddit API rate limit hit. Waiting 60 seconds before retrying..."
          );
          await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
          attempts++;
          if (attempts > 5) throw new Error("Too many rate limit retries.");
        } else {
          throw err; // Not a rate limit error, rethrow
        }
      }
    }

    for (const post of newPosts) {
      if (processedPosts.includes(post.id)) {
        continue;
      }

      const analysis = await analyzePostWithAI(post);
      if (analysis.isQualified) {
        await sendTelegramNotification(post);
        processedPosts.push(post.id);
      }
      // Add a delay to avoid hitting OpenAI rate limits
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 seconds
    }

    await saveProcessedPosts(processedPosts);
    logger.info(
      `Reddit API rate limit: ${reddit.ratelimitRemaining} requests remaining.`
    );
  } catch (error) {
    logger.error("Error processing subreddit:", error);
  }
}

// Target subreddits to monitor
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

// Schedule the job to run every 6 hours
cron.schedule("0 */6 * * *", async () => {
  logger.info("Starting scheduled Reddit analysis after 6 hours");

  for (const subreddit of TARGET_SUBREDDITS) {
    await processSubreddit(subreddit.trim());
  }

  logger.info("Completed scheduled Reddit analysis after 6 hours");
});

// Initial run
logger.info("Reddit AI Analyzer started");

async function main() {
  for (const subreddit of TARGET_SUBREDDITS) {
    await processSubreddit(subreddit.trim());
  }

  logger.info("Completed scheduled Reddit analysis after first run");
}

main();
