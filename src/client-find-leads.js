require("dotenv").config();
const Snoowrap = require("snoowrap");
const OpenAI = require("openai");
const cron = require("node-cron");
const winston = require("winston");
const fs = require("fs").promises;
const path = require("path");

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

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/clients/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/clients/combined.log" }),
  ],
});

logger.add(
  new winston.transports.Console({
    format: winston.format.simple(),
  })
);

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
    return {
      isQualified: result.isQualified,
      analysis: result.analysis,
      reason: result.reason,
    };
  } catch (error) {
    if (error.code === 'insufficient_quota') {
      logger.error("OpenAI API quota exceeded. Lead finder will pause until next billing cycle.");
      // Return a default response to prevent further processing
      return {
        isQualified: false,
        analysis: "OpenAI API quota exceeded",
        reason: "Service temporarily unavailable due to API quota limits",
      };
    }
    logger.error("Error analyzing post with AI:", error);
    return {
      isQualified: false,
      analysis: "Error during analysis",
      reason: "Technical error occurred",
    };
  }
}

async function processSubreddit(subredditName) {
  try {
    logger.info(`Starting to process subreddit: r/${subredditName}`);
    const processedPosts = await loadProcessedPosts();
    const processedUsers = await loadProcessedUsers();
    logger.info(`Loaded ${processedPosts.length} processed posts and ${processedUsers.length} processed users`);
    
    const subreddit = await reddit.getSubreddit(subredditName);
    logger.info(`Successfully connected to r/${subredditName}`);

    let newPosts;
    let attempts = 0;
    while (true) {
      try {
        logger.info(`Fetching new posts from r/${subredditName}`);
        newPosts = await subreddit.getNew({ limit: 1000 });
        logger.info(`Retrieved ${newPosts.length} new posts from r/${subredditName}`);
        break;
      } catch (err) {
        if (err.statusCode === 429 || (err.message && err.message.includes("rate limit"))) {
          logger.warn(`Rate limit hit for r/${subredditName}. Attempt ${attempts + 1}/5. Waiting 60 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
          attempts++;
          if (attempts > 5) throw new Error("Too many rate limit retries.");
        } else {
          throw err;
        }
      }
    }

    let qualifiedCount = 0;
    let openAILimitHit = false;

    for (const post of newPosts) {
      if (processedPosts.includes(post.id)) {
        logger.debug(`Skipping already processed post ${post.id}`);
        continue;
      }

      if (processedUsers.includes(post.author.name)) {
        logger.debug(`Skipping post from already processed user ${post.author.name}`);
        continue;
      }

      logger.info(`Analyzing post: ${post.title.substring(0, 50)}...`);
      const analysis = await analyzePostWithAI(post);
      
      if (analysis.reason === "Service temporarily unavailable due to API quota limits") {
        openAILimitHit = true;
        break;
      }
      
      if (analysis.isQualified) {
        qualifiedCount++;
        logger.info(`Found qualified lead! Post: ${post.title.substring(0, 50)}...`);
        logger.info(`Analysis: ${analysis.analysis}`);
        logger.info(`Reason: ${analysis.reason}`);

        processedPosts.push(post.id);
        processedUsers.push(post.author.name);
        
        await saveProcessedPosts(processedPosts);
        await saveProcessedUsers(processedUsers);
        logger.info(`Saved updated data: ${processedPosts.length} posts and ${processedUsers.length} users`);
      } else {
        logger.debug(`Post not qualified: ${post.title.substring(0, 50)}...`);
      }
      
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    if (openAILimitHit) {
      logger.info("Stopping further processing due to OpenAI API quota limit.");
      return;
    }

    logger.info(`Finished processing r/${subredditName}. Found ${qualifiedCount} qualified leads.`);
    logger.info(`Reddit API rate limit: ${reddit.ratelimitRemaining} requests remaining.`);
  } catch (error) {
    logger.error(`Error processing subreddit r/${subredditName}:`, error);
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
  "business",
];

// every 6 hours
cron.schedule("0 */6 * * *", async () => {
  logger.info("=== Starting scheduled Reddit analysis ===");
  logger.info(`Current time: ${new Date().toISOString()}`);

  for (const subreddit of TARGET_SUBREDDITS) {
    await processSubreddit(subreddit.trim());
  }

  logger.info("=== Completed scheduled Reddit analysis ===");
});