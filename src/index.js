require('dotenv').config();
const Snoowrap = require('snoowrap');
const OpenAI = require('openai');
const cron = require('node-cron');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Reddit client
const reddit = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// File to store processed post IDs
const PROCESSED_POSTS_FILE = 'data/processed_posts.json';

async function loadProcessedPosts() {
    try {
        const data = await fs.readFile(PROCESSED_POSTS_FILE, 'utf8');
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
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a lead qualification assistant. Analyze the following Reddit post and determine if the author would be a good candidate for our product. Consider their needs, pain points, and whether our solution could help them."
                },
                {
                    role: "user",
                    content: `Title: ${post.title}\n\nContent: ${post.selftext}`
                }
            ],
            temperature: 0.7,
            max_tokens: 150
        });

        return {
            isQualified: response.choices[0].message.content.toLowerCase().includes('yes'),
            analysis: response.choices[0].message.content
        };
    } catch (error) {
        logger.error('Error analyzing post with AI:', error);
        return { isQualified: false, analysis: 'Error during analysis' };
    }
}

async function sendPersonalizedDM(username, post) {
    try {
        const message = `Hi ${username},\n\nI noticed your post about "${post.title}" and thought you might be interested in our solution. We help with [specific problem] and could potentially address your needs. Would you like to learn more?\n\nBest regards,\n[Your Name]`;

        await reddit.composeMessage({
            to: username,
            subject: 'Regarding your recent post',
            text: message
        });

        logger.info(`Sent DM to ${username}`);
        return true;
    } catch (error) {
        logger.error(`Error sending DM to ${username}:`, error);
        return false;
    }
}

async function processSubreddit(subredditName) {
    try {
        const processedPosts = await loadProcessedPosts();
        const subreddit = await reddit.getSubreddit(subredditName);
        const newPosts = await subreddit.getNew({ limit: 10 });

        for (const post of newPosts) {
            if (processedPosts.includes(post.id)) {
                continue;
            }

            const analysis = await analyzePostWithAI(post);
            if (analysis.isQualified) {
                const dmSent = await sendPersonalizedDM(post.author.name, post);
                if (dmSent) {
                    processedPosts.push(post.id);
                    logger.info(`Processed post ${post.id} from ${post.author.name}`);
                }
            }
        }

        await saveProcessedPosts(processedPosts);
    } catch (error) {
        logger.error('Error processing subreddit:', error);
    }
}

// Schedule the job to run every hour
cron.schedule('0 * * * *', async () => {
    logger.info('Starting scheduled Reddit analysis');
    const subreddits = process.env.TARGET_SUBREDDITS.split(',');
    
    for (const subreddit of subreddits) {
        await processSubreddit(subreddit.trim());
    }
    
    logger.info('Completed scheduled Reddit analysis');
});

// Initial run
logger.info('Reddit AI Analyzer started');
processSubreddit(process.env.TARGET_SUBREDDITS.split(',')[0].trim()); 