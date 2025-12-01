// fb_loader.js
// Usage:
// node fb_loader.js "<cookies_or_appstate>" "<sender>" "<type>" "<uid>" "<delay>" "<msg_path>" "<loader_id>"

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 7) {
  console.error('Usage: node fb_loader.js <cookies_or_appstate> <sender> <type> <uid> <delay> <msg_path> <loader_id>');
  process.exit(1);
}

const [cookiesArg, sender, targetType, uid, delayArg, msgPath, loaderId] = args;
const delaySeconds = parseInt(delayArg) || 5;
const LOG_FILE = path.join('loaders', `${loaderId}.txt`);

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function parseCookies(arg) {
  // If arg is path to file
  try {
    if (fs.existsSync(arg)) {
      const txt = fs.readFileSync(arg, 'utf8').trim();
      // If file contains JSON array, parse it
      try {
        const parsed = JSON.parse(txt);
        return normalizeCookieArray(parsed);
      } catch (e) {
        // fallback to cookie string
        return cookieStringToArray(txt);
      }
    }
  } catch (e) {
    // ignore
  }

  // Try parse as JSON
  if (arg.trim().startsWith('{') || arg.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(arg);
      return normalizeCookieArray(parsed);
    } catch (e) {
      // fallthrough to cookie string parse
    }
  }

  // Otherwise treat as raw cookie header string
  return cookieStringToArray(arg);
}

function cookieStringToArray(str) {
  const arr = [];
  str.split(';').forEach(part => {
    const p = part.trim();
    if (!p) return;
    const idx = p.indexOf('=');
    if (idx === -1) return;
    const name = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    // assign domain to facebook so cookies are applied
    arr.push({ name, value, domain: '.facebook.com', path: '/' });
  });
  return arr;
}

function normalizeCookieArray(parsed) {
  // parsed may be array of objects with {name,value} or {key,value} or {name, value, domain}
  if (!Array.isArray(parsed)) return cookieStringToArray(String(parsed));
  return parsed.map(c => {
    if (!c) return null;
    const name = c.name || c.key || c.keyName || c.Key || c.k || '';
    const value = c.value || c.val || c.v || '';
    const domain = c.domain || '.facebook.com';
    const path = c.path || '/';
    return { name, value, domain, path, httpOnly: !!c.httpOnly, secure: !!c.secure };
  }).filter(Boolean);
}

async function waitForMessageBox(page) {
  // multiple selectors tried for the messenger message input
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"] div[aria-label="Message"]',
    'div[role="textbox"][contenteditable="true"]',
    'div.notranslate[contenteditable="true"]',
    'textarea'
  ];
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      return sel;
    } catch (e) {
      // try next
    }
  }
  return null;
}

(async () => {
  log('Starting fb_loader.js', `sender=${sender}`, `type=${targetType}`, `uid=${uid}`, `delay=${delaySeconds}`);

  // read messages
  let messages = [];
  try {
    if (fs.existsSync(msgPath)) {
      const txt = fs.readFileSync(msgPath, 'utf8');
      messages = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      log(`Loaded ${messages.length} messages from ${msgPath}`);
    } else {
      log('Message file not found:', msgPath);
    }
  } catch (e) {
    log('Error reading msg file:', e.toString());
  }

  const cookies = await parseCookies(cookiesArg);
  log('Parsed', cookies.length, 'cookies');

  const browser = await puppeteer.launch({
    headless: false,            // change to true if you want headless
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  try {
    // set viewport
    await page.setViewport({ width: 1200, height: 800 });

    // set cookies
    for (const c of cookies) {
      try {
        // ensure cookie has proper fields for puppeteer
        const cookieObj = {
          name: c.name,
          value: String(c.value),
          domain: c.domain || '.facebook.com',
          path: c.path || '/',
        };
        if (c.httpOnly) cookieObj.httpOnly = true;
        if (c.secure) cookieObj.secure = true;
        await page.setCookie(cookieObj);
      } catch (e) {
        log('Failed to set cookie', c.name, e.toString());
      }
    }

    // open messenger thread - works for individual & group threads
    const threadUrl = `https://www.messenger.com/t/${uid}`;
    log('Opening thread URL', threadUrl);
    await page.goto(threadUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // check if logged in
    const loggedIn = await page.evaluate(() => {
      return !!document.querySelector('a[aria-label="Profile"]') || !!document.querySelector('[aria-label="Chats"]') || !!document.querySelector('[data-testid="mwthreadlist-item"]');
    }).catch(()=>false);

    if (!loggedIn) {
      log('Not detected as logged in. Trying facebook.com and re-apply cookies.');
      // try go to facebook main to ensure cookies applied
      await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 45000 }).catch(()=>{});
      // small wait
      await page.waitForTimeout(3000);
    } else {
      log('Login appears OK');
    }

    // reload thread (in case cookies applied after facebook load)
    await page.goto(threadUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // try locating message box
    const boxSelector = await waitForMessageBox(page);
    if (!boxSelector) {
      log('Message box not found on messenger page. Attempting fallback to m.facebook.com/messages/thread/' + uid);
      // fallback open m.facebook mobile web messages
      const mUrl = `https://m.facebook.com/messages/t/${uid}`;
      await page.goto(mUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(()=>{});
      const fallback = await waitForMessageBox(page);
      if (!fallback) {
        log('Fallback message box not found. Aborting.');
        await browser.close();
        process.exit(1);
      }
    }

    // main send loop
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      log(`Sending message ${i+1}/${messages.length}:`, msg);

      let sent = false;
      for (let attempt=1; attempt<=3 && !sent; attempt++) {
        try {
          // focus on contenteditable box
          const selector = await waitForMessageBox(page);
          if (!selector) throw new Error('Message box selector not found for typing');

          // click to focus
          await page.click(selector);
          // small pause
          await page.waitForTimeout(200);

          // type message
          await page.evaluate((sel, txt) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            // use innerText for contenteditable; clear previous content
            el.focus();
            // try clearing
            if (el.innerText !== undefined) el.innerText = '';
            if (el.value !== undefined) el.value = '';
            return true;
          }, selector, msg);

          // type using keyboard to simulate real typing
          await page.type(selector, msg, {delay: 30});
          await page.keyboard.press('Enter');
          // wait a bit for send to complete
          await page.waitForTimeout(1000 + 500*attempt);

          // basic check - look for a "seen" or message bubble containing text on page (not perfect)
          const found = await page.evaluate(t => {
            // find last message bubbles
            const items = Array.from(document.querySelectorAll('div[role="row"], div[aria-label], div'));
            return items.some(el => (el.innerText || '').includes(t));
          }, msg).catch(()=>false);

          if (found) {
            sent = true;
            log('Sent OK:', msg);
          } else {
            // sometimes messenger renders differently; consider it sent but log response
            sent = true;
            log('Assuming sent (no DOM confirmation):', msg);
          }
        } catch (err) {
          log('Attempt', attempt, 'failed:', err.toString());
          await page.waitForTimeout(1000 * attempt);
        }
      } // attempts

      if (!sent) {
        log('Failed to send message after retries:', msg);
      }

      // wait for provided delay before sending next
      await page.waitForTimeout(delaySeconds * 1000);
    } // for messages

    log('All messages processed. Closing browser.');
    await browser.close();
    process.exit(0);

  } catch (err) {
    log('Fatal error:', err.toString());
    try { await browser.close(); } catch(e){}
    process.exit(1);
  }
})();
    
