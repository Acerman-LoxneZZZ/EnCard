const {chromium}=require('./browser-runtime/node_modules/playwright');
const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{
  window.spoken=[];
  window.fetch=()=>new Promise(()=>{});
  Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return []},speak(u){window.spoken.push({text:u.text,active:navigator.userActivation.isActive});},paused:false}});
 });
 await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));
 await page.locator('#front-flip').tap();await page.waitForTimeout(900);
 await page.locator('#word-sound').tap();
 const result=await page.evaluate(()=>({spoken,flipped,dragging:!!drag}));
 assert.deepEqual(result,{spoken:[{text:'discover',active:true}],flipped:true,dragging:false});
 console.log('PASS mobile sound tap starts speech with active user gesture during stalled network, without flipping or dragging');
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});