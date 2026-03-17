import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('[Playwright] Opening https://yunzhijia.com...');
  await page.goto('https://yunzhijia.com', { waitUntil: 'domcontentloaded' });

  console.log('[Playwright] Page title:', await page.title());
  console.log('[Playwright] Page URL:', page.url());
  console.log('[Playwright] Browser window opened. Press Ctrl+C to close.');

  // Keep the browser open
  await new Promise(resolve => setTimeout(resolve, Infinity));
})().catch(err => {
  console.error('[Playwright] Error:', err.message);
  process.exit(1);
});
