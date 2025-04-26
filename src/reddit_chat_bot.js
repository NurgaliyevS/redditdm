require('dotenv').config();
const puppeteer = require('puppeteer');

const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD;
const TARGET_USER = "Leapird"; // e.g., 'Leapird'
const CHAT_MESSAGE = "Hi! I found your post and wanted to connect.";

async function sendRedditChat() {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  // 1. Go to Reddit login
  await page.goto('https://www.reddit.com/login', { waitUntil: 'networkidle2' });

  // Wait for the login form to render
  await new Promise(res => setTimeout(res, 5000));

  // Use page.evaluate to fill username and password inside shadow DOM
  await page.evaluate((username, password) => {
    function queryShadowRoots(selector) {
      const elements = [];
      function findIn(node) {
        if (node.shadowRoot) {
          const el = node.shadowRoot.querySelector(selector);
          if (el) elements.push(el);
          Array.from(node.shadowRoot.children).forEach(findIn);
        }
        Array.from(node.children).forEach(findIn);
      }
      findIn(document.body);
      return elements;
    }

    const usernameInputs = queryShadowRoots('input[name="username"]');
    const passwordInputs = queryShadowRoots('input[name="password"]');

    if (usernameInputs.length > 0) {
      usernameInputs[0].focus();
      usernameInputs[0].value = username;
      usernameInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (passwordInputs.length > 0) {
      passwordInputs[0].focus();
      passwordInputs[0].value = password;
      passwordInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, REDDIT_USERNAME, REDDIT_PASSWORD);

  // Debug: Screenshot after filling in credentials
  await page.screenshot({ path: 'login_filled.png' });

  // 4. Click the login button (try both normal and shadow DOM)
  let loginClicked = false;
  try {
    await page.click('button[type="submit"]');
    loginClicked = true;
  } catch (e) {
    // Try clicking inside shadow DOM if normal click fails
    await page.evaluate(() => {
      function queryShadowRoots(selector) {
        const elements = [];
        function findIn(node) {
          if (node.shadowRoot) {
            const el = node.shadowRoot.querySelector(selector);
            if (el) elements.push(el);
            Array.from(node.shadowRoot.children).forEach(findIn);
          }
          Array.from(node.children).forEach(findIn);
        }
        findIn(document.body);
        return elements;
      }
      const buttons = queryShadowRoots('button[type="submit"]');
      if (buttons.length > 0) buttons[0].click();
    });
    loginClicked = true;
  }

  if (!loginClicked) {
    console.log('Could not click login button.');
    await browser.close();
    return;
  }

  // 5. Wait for login to complete (wait for the home page or user icon)
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await new Promise(res => setTimeout(res, 5000)); // Give time for login to finish

  // 6. Go to target user's profile
  await page.goto(`https://www.reddit.com/user/${TARGET_USER}`, { waitUntil: 'networkidle2' });

  // 7. Click "Start Chat"
  await page.waitForSelector('button:has-text("Start Chat"),button:has-text("Chat")', { timeout: 10000 });
  const chatButton = await page.$('button:has-text("Start Chat"),button:has-text("Chat")');
  if (!chatButton) {
    console.log('No chat button found for this user.');
    await browser.close();
    return;
  }
  await chatButton.click();

  // 8. Wait for chat box, type message, and send
  await page.waitForSelector('textarea', { timeout: 10000 });
  await page.type('textarea', CHAT_MESSAGE, { delay: 30 });
  await page.keyboard.press('Enter');

  // 9. Take a screenshot
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${TARGET_USER}_chat.png` });

  console.log('Chat sent and screenshot saved!');

  const allInputs = await page.$$eval('input', els => els.map(e => ({
    name: e.name,
    type: e.type,
    value: e.value,
    disabled: e.disabled,
    visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
  })));
  console.log(allInputs);

  await browser.close();
}

sendRedditChat().catch(console.error);