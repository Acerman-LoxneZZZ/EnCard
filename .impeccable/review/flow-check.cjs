const {chromium}=require('./browser-runtime/node_modules/playwright');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));await page.waitForTimeout(1200);
  await page.screenshot({path:'.impeccable/build/grid-'+name+'.png'});
  const snap=()=>page.evaluate(()=>document.getElementById('light-grid').toDataURL());
  const first=await snap();await page.waitForTimeout(200);const second=await snap();
  await page.evaluate(() => { effectsEnabled = false; applyEffects(); }); await page.waitForTimeout(100);
  const paused=await snap();await page.waitForTimeout(200);
  console.log(name,JSON.stringify({errors,animated:first!==second,paused:paused===await snap(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
  await page.evaluate(() => { effectsEnabled = true; applyEffects(); }); await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);const reduced=await snap();await page.waitForTimeout(200);console.log('reduced static',reduced===await snap());
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});