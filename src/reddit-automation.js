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
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  try {
    const page = await browser.newPage();
    
    // Go to Reddit login page
    logger.info("Going to Reddit login page");
    await page.goto('https://www.reddit.com/login', { waitUntil: 'networkidle2' });
    
    // Wait longer for dynamic content to load
    logger.info("Waiting for page to fully load");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Reddit uses custom web components, so wait for those
    const possibleSelectors = [
      'faceplate-text-input#login-username',
      'faceplate-text-input#login-password',
      '#login-username',
      '#login-password'
    ];
    
    // Wait for any of these selectors to appear
    let foundSelector = null;
    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        foundSelector = selector;
        logger.info(`Found selector: ${selector}`);
        break;
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // Get all input fields using multiple approaches including custom elements
    const inputFields = await page.evaluate(() => {
      // Get regular input elements
      const inputs = Array.from(document.querySelectorAll('input'));
      
      // Get Reddit's custom faceplate-text-input elements
      const faceplateInputs = Array.from(document.querySelectorAll('faceplate-text-input'));
      
      // Get inputs within forms
      const formInputs = Array.from(document.querySelectorAll('form input'));
      
      // Combine all and map to useful data
      const allElements = [...inputs, ...formInputs];
      const inputData = allElements.map(input => ({
        tagName: input.tagName,
        id: input.id,
        name: input.name,
        type: input.type,
        className: input.className,
        placeholder: input.placeholder,
        label: input.getAttribute('aria-label'),
        dataTestId: input.getAttribute('data-testid'),
        outerHTML: input.outerHTML.substring(0, 200)
      }));
      
      // Add faceplate custom elements
      const faceplateData = faceplateInputs.map(input => ({
        tagName: input.tagName,
        id: input.id,
        name: input.getAttribute('name'),
        type: input.getAttribute('type'),
        className: input.className,
        placeholder: input.getAttribute('placeholder'),
        label: input.querySelector('span[slot="label"]')?.textContent?.trim(),
        autocomplete: input.getAttribute('autocomplete'),
        outerHTML: input.outerHTML.substring(0, 300)
      }));
      
      return {
        regularInputs: inputData,
        faceplateInputs: faceplateData,
        totalInputs: inputs.length,
        totalFaceplateInputs: faceplateInputs.length
      };
    });
    
    // Log all input fields
    logger.info(`Found ${inputFields.totalInputs} regular input elements`);
    logger.info(`Found ${inputFields.totalFaceplateInputs} faceplate input elements`);
    
    // Now try to fill the login fields
    try {
      // For faceplate-text-input, we need to find the actual input inside it
      const usernameInput = await page.$('#login-username input');
      const passwordInput = await page.$('#login-password input');
      
      if (usernameInput && passwordInput) {
        logger.info('Found actual input elements inside faceplate components');
        
        // Fill in the credentials (uncomment when ready to use)
        // await usernameInput.type(process.env.REDDIT_USERNAME);
        // await passwordInput.type(process.env.REDDIT_PASSWORD);
        
        logger.info('Login fields are ready to be filled');
      } else {
        logger.info('Could not find actual input elements inside faceplate components');
        
        // Try alternative method - clicking and typing directly on the faceplate elements
        const usernameElement = await page.$('#login-username');
        const passwordElement = await page.$('#login-password');
        
        if (usernameElement && passwordElement) {
          logger.info('Found faceplate elements, will try direct interaction');
          
          // Uncomment to fill:
          await usernameElement.click();
          await page.keyboard.type(process.env.REDDIT_USERNAME);
          await passwordElement.click();
          await page.keyboard.type(process.env.REDDIT_PASSWORD);
        }
      }
    } catch (error) {
      logger.error('Error trying to interact with login fields:', error);
    }
    
    // Also check for any forms on the page
    const forms = await page.evaluate(() => {
      const formElements = Array.from(document.querySelectorAll('form'));
      return formElements.map(form => ({
        id: form.id,
        className: form.className,
        action: form.action,
        method: form.method,
        innerHTML: form.innerHTML.substring(0, 500) // First 500 chars
      }));
    });
    
    logger.info(`Found ${forms.length} form elements`);
    logger.info('Found forms: ' + JSON.stringify(forms, null, 2));
    
  } catch (error) {
    logger.error('Error during Reddit login:', error);
    throw error;
  }
}

async function main() {
  await loginToReddit();
}

main();