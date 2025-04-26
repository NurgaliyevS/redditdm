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

  await page.screenshot({ path: 'login_page.png' });

  console.log('Attempting to fill username and password fields...');
  const fieldResult = await page.evaluate((username, password) => {
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

    let usernameLog = '';
    let passwordLog = '';

    if (usernameInputs.length > 0) {
      usernameInputs[0].focus();
      usernameInputs[0].value = username;
      usernameInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      usernameInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      usernameLog = usernameInputs[0].value;
    }
    if (passwordInputs.length > 0) {
      passwordInputs[0].focus();
      passwordInputs[0].value = password;
      passwordInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      passwordInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      passwordLog = passwordInputs[0].value;
    }

    // Log button state
    const submitButtons = queryShadowRoots('button[type="submit"]');
    let buttonDisabled = null;
    if (submitButtons.length > 0) {
      buttonDisabled = submitButtons[0].disabled;
    }

    return {
      usernameInputs: usernameInputs.length,
      passwordInputs: passwordInputs.length,
      usernameValue: usernameLog,
      passwordValue: passwordLog ? '***' : null,
      buttonDisabled
    };
  }, REDDIT_USERNAME, REDDIT_PASSWORD);

  console.log('Username fields found:', fieldResult.usernameInputs, 'Password fields found:', fieldResult.passwordInputs);
  console.log('Username value set:', fieldResult.usernameValue, 'Password value set:', fieldResult.passwordValue ? '***' : null);
  console.log('Submit button disabled:', fieldResult.buttonDisabled);

  // Debug: Screenshot after filling in credentials
  await page.screenshot({ path: 'login_filled.png' });

  // If button is still disabled, try typing with Puppeteer as a fallback
  if (fieldResult.buttonDisabled) {
    console.log('Button still disabled, trying to type with Puppeteer...');
    // Try to type into the first visible input fields
    const usernameInput = await page.$('input[name="username"]');
    const passwordInput = await page.$('input[name="password"]');
    if (usernameInput && passwordInput) {
      await usernameInput.click({ clickCount: 3 });
      await usernameInput.press('Backspace');
      await usernameInput.type(REDDIT_USERNAME, { delay: 50 });
      await passwordInput.click({ clickCount: 3 });
      await passwordInput.press('Backspace');
      await passwordInput.type(REDDIT_PASSWORD, { delay: 50 });
      await page.screenshot({ path: 'login_filled_typed.png' });
    }
  }

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

  console.log('Login button clicked. Taking screenshot...');
  await page.screenshot({ path: 'after_login_click.png' });

  // Wait for navigation, but also set a timeout and catch errors
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    console.log('Navigation after login succeeded.');
  } catch (e) {
    console.log('Navigation after login failed or timed out.');
    await page.screenshot({ path: 'login_timeout.png' });
  }

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