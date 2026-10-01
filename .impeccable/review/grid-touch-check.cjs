const { chromium } = require('./browser-runtime/node_modules/playwright');
const path = require('node:path');
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page = await browser.newPage({viewport:{width:360,height:780},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));
 await page.locator('#front-flip').tap(); await page.waitForTimeout(900);
 const flipped = await page.locator('.back').getAttribute('aria-hidden');
 await page.getByRole('button',{name:'Знаю',exact:true}).tap();await page.waitForTimeout(650);
 console.log(JSON.stringify({errors,touchFlip:flipped==='false',learned:await page.evaluate(()=>state.learned.length),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),canvas:await page.locator('#light-grid').evaluate(el=>({width:el.width,height:el.height}))}));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});