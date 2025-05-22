require("dotenv").config();
const puppeteer = require("puppeteer");
const winston = require("winston");


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

async function loginToReddit() {
  const browser = await puppeteer.launch({
    headless: false, // Set to true in production
    defaultViewport: null,
    args: ['--start-maximized']
  });

  try {
    const page = await browser.newPage();
    
    // Go to Reddit login page
    logger.info("Going to Reddit login page");
    await page.goto('https://www.reddit.com/login');

    // wait 3000s using SetTimeout
    logger.info("Waiting 3000s");
    await new Promise(resolve => setTimeout(resolve, 3000));
    logger.info("3000s passed");

    // Wait for the login form to load
    await page.waitForSelector('#login-username');
    
    // Get all input fields and their properties
    const inputFields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.map(input => ({
        id: input.id,
        name: input.name,
        type: input.type,
        placeholder: input.placeholder
      }));
    });
    
    // Log all input fields
    logger.info('Found input fields:', inputFields);
    
    // Fill in login credentials
    await page.type('#login-username', process.env.REDDIT_USERNAME);
    await page.type('#login-password', process.env.REDDIT_PASSWORD);
    
    // Click login button
    await page.click('button.login');
    
    // Wait for navigation to complete
    await page.waitForNavigation();
    
    // Check if login was successful
    const currentUrl = page.url();
    if (currentUrl.includes('reddit.com')) {
      logger.info('Successfully logged in to Reddit');
      return { browser, page };
    } else {
      throw new Error('Login failed');
    }
  } catch (error) {
    logger.error('Error during Reddit login:', error);
    await browser.close();
    throw error;
  }
}

async function main() {
  const { browser, page } = await loginToReddit();
  await browser.close();
}

main();

// Export the login function
module.exports = { loginToReddit }; 