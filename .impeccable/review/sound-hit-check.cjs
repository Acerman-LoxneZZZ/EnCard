const {chromium,webkit}=require('./browser-runtime/node_modules/playwright');const path=require('node:path');
(async()=>{
 for(const [name,engine] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await engine.launch(name==='chrome'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}:{headless:true});
  try{
   for(const file of ['index.html','.impeccable/review/github-reference.html']){
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.addInitScript(()=>{window.fetch=()=>new Promise(()=>{});window.calls=[];Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return []},speak(u){calls.push(u.text)}}});});
    await page.goto('file:///'+path.resolve(file).replace(/\\/g,'/'));
    await page.locator('#front-flip').tap();await page.waitForTimeout(1000);
    console.log(name,file,await page.locator('#word-sound').evaluate(b=>{const r=b.getBoundingClientRect();return {rect:r.toJSON(),hits:[[.5,.5],[.1,.5],[.9,.5],[.5,.1],[.5,.9]].map(([x,y])=>document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)?.outerHTML.slice(0,150))}}));
    await page.locator('#word-sound').tap({timeout:3000});await page.waitForTimeout(950);
    console.log('tap',await page.evaluate(()=>({flipped,calls})));
    await page.screenshot({path:'.impeccable/build/sound-'+name+'-'+(file==='index.html'?'local':'github')+'.png'});await page.close();
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});