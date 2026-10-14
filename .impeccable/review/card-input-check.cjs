const {chromium} = require('./browser-runtime/node_modules/playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for (const [width,mobile] of [[360,true],[390,true],[1280,false]]) {
      const page = await browser.newPage({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(() => {
        window.calls=[];
        window.fetch=()=>new Promise(()=>{});
        window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
        Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return [];},speak(u){calls.push(u.text);},paused:false}});
      });
      await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));
      const snapshot=()=>page.evaluate(()=>({queue:[...state.queue],attempts:state.attempts,learned:[...state.learned],flipped,transform:card.style.transform}));
      const before=await snapshot();
      if (mobile) {
        const cdp=await page.context().newCDPSession(page);
        for (const [dx,dy] of [[110,0],[-110,0],[0,110],[0,-110]]) {
          const r=await page.locator('#card').boundingBox(), x=r.x+r.width/2, y=r.y+r.height/2;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
          for(let step=1;step<=4;step++) {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/4,y:y+dy*step/4}]});
            await page.waitForTimeout(25);
          }
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await page.waitForTimeout(100);
          assert.deepEqual(await snapshot(),before,'swipes must not change or move the card');
        }
        await page.locator('#front-flip').tap();
      } else {
        const r=await page.locator('#card').boundingBox();
        await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down();
        await page.mouse.move(r.x+20,r.y+r.height/2,{steps:6}); await page.mouse.up();
        assert.deepEqual(await snapshot(),before,'mouse dragging must not answer or flip');
        await page.locator('#front-flip').click();
      }
      await page.waitForTimeout(900);
      assert.equal(await page.evaluate(()=>flipped),true,'tap/click still flips');
      if (mobile) {
        const r=await page.locator('#word-sound').boundingBox();
        for(const [x,y] of [[r.x+r.width/2,r.y+r.height/2],[r.x+2,r.y+2],[r.x-5,r.y+r.height/2]]) {
          const count=await page.evaluate(()=>calls.length);
          await page.touchscreen.tap(x,y); await page.waitForTimeout(80);
          assert.equal(await page.evaluate(()=>calls.length),count+1,'one speech per tap');
          assert.equal(await page.evaluate(()=>flipped),true,'sound must not flip');
        }
      } else {
        await page.locator('#word-sound').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>calls.length),1,'keyboard sound still works');
      }
      await page.screenshot({path:'.impeccable/build/buttons-only-'+width+'.png',fullPage:true});
      for(const kind of ['no','hard','yes']) {
        const previous=await page.evaluate(()=>({queue:[...state.queue],learned:[...state.learned],attempts:state.attempts}));
        const button=page.locator(`[data-answer="${kind}"]`);
        if(mobile) await button.tap(); else await button.click();
        await page.waitForTimeout(700);
        const current=await page.evaluate(()=>({queue:[...state.queue],learned:[...state.learned],attempts:state.attempts,flipped}));
        assert.equal(current.attempts,previous.attempts+1);
        if(kind==='no') assert.equal(current.queue.at(-1),previous.queue[0]);
        if(kind==='hard') assert.equal(current.queue[3],previous.queue[0]);
        if(kind==='yes') assert.deepEqual(current.learned,[...previous.learned,previous.queue[0]]);
        assert.equal(current.flipped,false);
      }
      await page.locator('#undo').click();
      assert.equal(await page.evaluate(()=>state.attempts),2,'undo still works');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      console.log('PASS',width,mobile?'touch':'mouse','no swipes, flip, sound, all answer buttons, undo, no page errors');
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
