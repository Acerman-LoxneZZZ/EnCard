const {chromium}=require('./browser-runtime/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.APP_URL || 'http://127.0.0.1:4173';

(async()=>{
  const {validateDocument}=await import('../../server/document.mjs');
  const database=new Map();
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  async function telegram(page,id) {
    // UI fixture only. Production verification is exercised by signed Node tests.
    await page.context().route('**/telegram-auth.js',route=>route.fulfill({contentType:'text/javascript',body:'export async function verifyTelegram(data){const params=new URLSearchParams(data);if(params.get("signature")!=="test-fixture")throw Object.assign(new Error("Откройте приложение через Telegram."),{status:401});const user=JSON.parse(params.get("user"));return {id:String(user.id),name:user.first_name,avatar:null};}'}));
    await page.addInitScript(id=>{
      window.Telegram={WebApp:{initData:new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:`Пользователь ${id}`}),signature:'test-fixture'}).toString(),
        ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},BackButton:{show(){},hide(){},onClick(){}}}};
      window.calls=[];window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
      Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices(){return [];},speak(u){calls.push(u.text);},paused:false}});
    },id);
    await page.route('**/api/profile',async route=>{
      const request=route.request(),data=new URLSearchParams(request.headers().authorization?.slice(4)),user=JSON.parse(data.get('user'));
      let row=database.get(user.id);if(!row) {row={profile:{id:String(user.id),name:user.first_name,avatar:null},document:null,revision:0,updatedAt:0};database.set(user.id,row);}
      if(request.method()==='PUT') {
        const input=request.postDataJSON();
        if(input.revision!==row.revision) {await route.fulfill({status:409,json:{error:'conflict'}});return;}
        try {row.document=JSON.parse(JSON.stringify(validateDocument(input.document)));} catch(error) {await route.fulfill({status:error.status || 400,json:{error:error.code,message:error.message}});return;}
        row.revision++;row.updatedAt=Date.now();await route.fulfill({json:{revision:row.revision,updatedAt:row.updatedAt}});
      } else await route.fulfill({json:row});
    });
    await page.route('https://commons.wikimedia.org/**',route=>route.abort());
  }
  try {
    const outside=await browser.newPage({viewport:{width:390,height:844}});
    await outside.route('https://telegram.org/**',route=>route.abort());
    await outside.goto(base);
    await outside.waitForFunction(()=>document.getElementById('gate-open')?.hidden===false);
    assert.equal(await outside.locator('.app').isVisible(),false);
    assert.equal(await outside.evaluate(()=>!!window.WordflowData),false);
    await outside.screenshot({path:'.impeccable/build/telegram-only-gate.png'});
    const blocked=await outside.request.get(base+'/api/profile');assert.equal(blocked.status(),401);
    await outside.close();
    for(const [width,mobile,id] of [[390,true,101],[1280,false,202]]) {
      const context=await browser.newContext({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'allow'});
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await telegram(page,id);await page.goto(base);
      await page.waitForFunction(()=>window.WordflowData && !document.body.classList.contains('profile-loading'));
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      await page.locator('#front-flip').click();await page.waitForTimeout(900);
      await page.locator('#word-sound').click();assert.equal(await page.evaluate(()=>calls.length),1);
      await page.locator('[data-answer="yes"]').click();await page.waitForTimeout(1500);
      assert.equal(database.get(id).document.session.learned.length,1);
      await page.locator('#open-profile').click();
      assert.equal(await page.locator('#profile-name').textContent(),`Пользователь ${id}`);
      assert.equal(await page.locator('#profile-learned-count').textContent(),'1');
      await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>state.attempts),1,'profile keys must not answer hidden cards');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:'.impeccable/build/telegram-profile-'+width+'.png',fullPage:true});
      await page.locator('#profile-back').click();
      await page.locator('#open-library').click();await page.waitForTimeout(400);
      await page.locator('#custom-en').fill('sunshine');await page.locator('#custom-ru').fill('солнечный свет');
      await page.locator('#add-word-form button[type="submit"]').click();
      database.get(id).revision++;
      await page.waitForFunction(()=>document.getElementById('profile-conflict')?.hidden===false);
      assert.equal(database.get(id).document.customWords.length,0,'conflict must not overwrite cloud');
      await page.locator('#profile-keep-local').click();
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      assert.equal(database.get(id).document.customWords[0].en,'sunshine');
      await page.evaluate(()=>navigator.serviceWorker.ready);
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await context.setOffline(true);
      await page.reload();await page.waitForFunction(()=>window.WordflowData && !document.body.classList.contains('profile-loading'));
      assert.equal(await page.evaluate(()=>WORDS.at(-1).en),'sunshine','offline reload preserves personal words');
      await page.locator('[data-answer="no"]').click();await page.waitForTimeout(750);
      const attempts=await page.evaluate(()=>state.attempts);
      await context.setOffline(false);
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      assert.equal(database.get(id).document.session.attempts,attempts,'reconnect uploads offline changes');
      assert.deepEqual(errors,[]);
      console.log('PASS',width,'Telegram gate, profile, cards, cloud save, conflict and offline reload');
      await context.close();
    }
    const {valuesFromDocument}=await import('../../public/profile-sync.js');
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const page=await context.newPage();await telegram(page,303);
    await page.addInitScript(values=>Object.entries(values).forEach(([key,value])=>localStorage.setItem(key,value)),valuesFromDocument(database.get(101).document));
    await page.goto(base);await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
    assert.equal(database.get(303).document.customWords.length,0,'legacy data is not imported automatically');
    await page.locator('#profile-import-legacy').click();
    await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
    assert.equal(database.get(303).document.customWords[0].en,'sunshine');
    const second=await context.newPage();await telegram(second,404);await second.goto(base);
    await second.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
    assert.equal(await second.evaluate(()=>WORDS.length),20,'switching Telegram accounts never leaks cached words');
    assert.equal(database.get(404).document.customWords.length,0);
    const forged=await context.newPage();await telegram(forged,303);
    await forged.addInitScript(()=>{const data=new URLSearchParams(window.Telegram.WebApp.initData);data.set('signature','forged');window.Telegram.WebApp.initData=data.toString();});
    await forged.route('**/api/profile',route=>route.abort());await forged.goto(base);
    await forged.waitForFunction(()=>document.getElementById('gate-title')?.textContent==='Не удалось проверить вход');
    assert.equal(await forged.evaluate(()=>!!window.WordflowData),false,'unverified identity cannot open a cached profile');
    console.log('PASS legacy import, two accounts and unsigned cache access rejection');await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
