const {chromium} = require('./browser-runtime/node_modules/playwright');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for (const [name,width,height] of [['small',320,740],['mobile',390,844],['desktop',1440,1000],['wide',2560,1080]]) {
      const page = await browser.newPage({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://**/*',route=>route.abort());
      await page.goto(pathToFileURL(path.resolve('index.html')).href);
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('.audio-credit, .audio-credit-slot').count(),0);
      const dimensions = () => page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,scrollY}));
      const initial = await dimensions();
      for (const kind of ['hard','no','yes']) {
        const before = await page.evaluate(()=>({queue:[...state.queue],attempts:state.attempts}));
        const surface = await page.evaluate(()=>{
          const face=document.querySelector('#front');
          return {background:getComputedStyle(face).background,shadow:getComputedStyle(face).boxShadow,
            border:getComputedStyle(face,'::before').opacity,tint:getComputedStyle(document.body,'::before').opacity};
        });
        // Freeze the exit at its end to prove it clears the actual screen edges.
        await page.evaluate(kind=>{
          rate(kind); rate(kind);
          clearTimeout(transitionTimer);
          const animation = document.querySelector('.card-flight .card').getAnimations()[0];
          animation.pause(); animation.currentTime = animation.effect.getTiming().duration;
          document.querySelector('#queued-card').getAnimations().forEach(a=>a.finish());
        },kind);
        const exit = await page.evaluate(()=>{
          const r=document.querySelector('.card-flight .card').getBoundingClientRect();
          return {left:r.left,right:r.right,top:r.top,opacity:getComputedStyle(document.querySelector('.card-flight .face:not([inert])')).opacity,
            next:document.getElementById('queued-word').textContent,attempts:state.attempts};
        });
        assert.ok(kind==='hard'?exit.top>height:kind==='yes'?exit.left>width:exit.right<0,`${name}: ${kind} clears viewport`);
        assert.equal(exit.opacity,'1',`${name}: opaque card`);
        const during = await page.evaluate(()=>{
          const queued=document.getElementById('queued-card');
          return {background:getComputedStyle(queued).background,shadow:getComputedStyle(queued).boxShadow,
            border:getComputedStyle(queued,'::before').opacity,tint:getComputedStyle(document.body,'::before').opacity,
            controls:[...document.querySelectorAll('.answer')].map(button=>getComputedStyle(button).opacity)};
        });
        assert.deepEqual(during,{...surface,controls:['1','1','1']},`${name}: surfaces, border, screen and controls keep their brightness`);
        assert.equal(exit.attempts,before.attempts+1,`${name}: double answers ignored`);
        assert.deepEqual(await dimensions(),initial,`${name}: exit never grows or scrolls page`);
        if (kind==='hard' && ['mobile','desktop'].includes(name)) {
          await page.evaluate(()=>{
            const animation=document.querySelector('.card-flight .card').getAnimations()[0];
            animation.currentTime=animation.effect.getTiming().duration*.52;
          });
          await page.screenshot({path:`.impeccable/build/card-transition-${name}.png`});
        }
        const previewPosition = await page.locator('#queued-word').boundingBox();
        await page.evaluate(()=>document.querySelector('.card-flight .card').getAnimations()[0].finish());
        await page.waitForFunction(()=>!busy);
        assert.equal(await page.locator('.card-flight').count(),0,`${name}: exit layer removed`);
        assert.equal(await page.locator('#translation').textContent(),exit.next);
        const currentPosition = await page.locator('#translation').boundingBox();
        assert.ok(Math.abs(previewPosition.y-currentPosition.y)<1,`${name}: no text jump on handoff`);
        if(kind==='hard') assert.equal(await page.evaluate(()=>state.queue[3]),before.queue[0]);
        if(kind==='no') assert.equal(await page.evaluate(()=>state.queue.at(-1)),before.queue[0]);
        if(kind==='yes') assert.equal(await page.evaluate(()=>state.learned.at(-1)),before.queue[0]);
        await page.locator('#undo').click();
        assert.deepEqual(await page.evaluate(()=>({queue:[...state.queue],attempts:state.attempts})),before);
      }
      // A real button press, flip and natural animation completion.
      await page.locator('#front-flip').click();
      await page.waitForFunction(()=>!flipping);
      await page.locator('[data-answer="yes"]').click();
      await page.waitForFunction(()=>!busy);
      assert.equal(await page.evaluate(()=>flipped),false);
      assert.equal(await page.locator('.card-flight').count(),0);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>rate('hard'));
      assert.equal(await page.evaluate(()=>busy),false);
      assert.equal(await page.locator('.card-flight').count(),0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>rate('hard'));
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(()=>!busy);
      assert.equal(await page.locator('.card-flight').count(),0,'reduced motion cancels an in-flight exit');
      await page.evaluate(()=>{
        effectsEnabled=false; applyEffects();
        state=fresh([0]); render(); rate('no');
      });
      assert.deepEqual(await page.evaluate(()=>[...state.queue]),[0]);
      await page.evaluate(()=>rate('yes'));
      assert.equal(await page.locator('#finish').isVisible(),true);
      await page.locator('#finish-undo').click();
      assert.equal(await page.locator('#session').isVisible(),true);
      assert.deepEqual(errors,[],`${name}: no page errors`);
      console.log(`PASS ${name}: all exits clear screen, stable scroll, no handoff jump, undo, repeated answers, flip, reduced motion, final card`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
