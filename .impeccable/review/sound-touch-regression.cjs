const {chromium,webkit}=require('./browser-runtime/node_modules/playwright');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 for(const [name,engine] of [['chrome',chromium],['webkit',webkit]]){
 const browser=await engine.launch(name==='chrome'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}:{headless:true});
 try {
 for(const width of [360,390]){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls=[];window.fetch=()=>new Promise(()=>{});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return []},speak(u){calls.push({text:u.text,active:navigator.userActivation.isActive})},paused:false}});});
 await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));
 await page.locator('#front-flip').tap();await page.waitForTimeout(900);
 const r=await page.locator('#word-sound').boundingBox();
 for(const [x,y] of [[r.x+r.width/2,r.y+r.height/2],[r.x+2,r.y+2],[r.x+r.width-2,r.y+r.height-2],[r.x-5,r.y+r.height/2]]){
 const before=await page.evaluate(()=>calls.length);await page.touchscreen.tap(x,y);await page.waitForTimeout(100);
 const result=await page.evaluate(()=>({flipped,count:calls.length,active:calls.at(-1)?.active,dragging:!!drag}));
 assert.deepEqual(result,{flipped:true,count:before+1,active:true,dragging:false});
 }
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'.impeccable/build/sound-fixed-'+name+'-'+width+'.png'});
 console.log('PASS',name,width,'center, two corners, padded edge: one speech per tap, no flip, no errors');await page.close();
 }
 }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});