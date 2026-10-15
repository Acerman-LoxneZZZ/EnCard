const {chromium}=require('./browser-runtime/node_modules/playwright');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for(const [name,width,height] of [['mobile',390,844],['desktop',1280,900]]) {
      const page=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('https://**/*',r=>r.abort());
      await page.goto(pathToFileURL(path.resolve(process.argv[2]||'index.html')).href);
      await page.evaluate(()=>document.fonts.ready);
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      const events=[];cdp.on('Tracing.dataCollected',event=>events.push(...event.value));
      await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
      for(const target of [true,false,true,false]) {
        await page.evaluate(target=>setFlipped(target),target);
        await page.waitForFunction(()=>!flipping);
        assert.equal(await page.evaluate(()=>flipped),target);
        const visible=await page.evaluate(()=>[...document.querySelectorAll('#card .face')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.id));
        assert.deepEqual(visible,[target?'back':'front']);
      }
      const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
      await cdp.send('Tracing.end');await completed;
      const summary={};
      for(const type of ['Paint','Layout','UpdateLayoutTree']) {
        const samples=events.filter(event=>event.name===type&&event.ph==='X');
        summary[type]={count:samples.length,ms:Math.round(samples.reduce((sum,e)=>sum+(e.dur||0),0)/100)/10};
      }
      assert.deepEqual(errors,[]);
      console.log(name,JSON.stringify(summary));
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
