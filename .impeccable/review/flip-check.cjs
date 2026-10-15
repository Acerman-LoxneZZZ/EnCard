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
      await page.goto(pathToFileURL(path.resolve('index.html')).href);
      await page.evaluate(()=>document.fonts.ready);
      for(const target of [true,false]) {
        await page.evaluate(target=>{
          setFlipped(target,true); const active=flipAnimation;
          setFlipped(!target); if(flipAnimation!==active) throw Error('A second tap restarted the flip');
          active.pause(); active.currentTime=active.effect.getTiming().duration*.65;
        },target);
        const middle=await page.evaluate(()=>({
          running:flipping,
          animations:inner.getAnimations().length,
          prepared:[...document.querySelectorAll('#card .face')].every(face=>getComputedStyle(face).display==='flex'),
          border:getComputedStyle(document.querySelector('#card .face'),'::before').animationPlayState,
          sound:document.getElementById('word-sound').hidden
        }));
        assert.equal(middle.running,true);assert.equal(middle.animations,1);
        assert.equal(middle.prepared,true);assert.equal(middle.border,'paused');
        if(target) await page.screenshot({path:`.impeccable/build/flip-${name}.png`});
        await page.evaluate(()=>flipAnimation.finish());
        await page.waitForFunction(()=>!flipping);
        assert.equal(await page.evaluate(()=>document.activeElement.id),target?'back-flip':'front-flip');
        assert.equal(await page.locator('#word-sound').isVisible(),target);
        assert.equal(await page.evaluate(()=>document.querySelectorAll('.flip-incoming,.flip-outgoing,.card-turning').length),0);
        assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#card .face'),'::before').animationPlayState),'running');
      }
      await page.evaluate(()=>{setFlipped(true); rate('hard');});
      await page.waitForFunction(()=>!busy);
      assert.equal(await page.evaluate(()=>flipping||flipped),false,'answer interrupts the flip and resets the next card');
      await page.evaluate(()=>setFlipped(true));
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(()=>!flipping);
      assert.equal(await page.evaluate(()=>flipped),true,'reduced motion completes the requested flip');
      await page.evaluate(()=>setFlipped(false));
      assert.equal(await page.evaluate(()=>flipping||flipped),false);
      assert.equal(await page.evaluate(()=>document.body.classList.contains('card-turning')),false);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${name}: both directions, one animation, prepared faces, paused decorations, focus, speech visibility, repeated taps, answer interruption, reduced motion`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
