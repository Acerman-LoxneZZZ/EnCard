const {chromium}=require('./browser-runtime/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.APP_URL || 'http://127.0.0.1:4173';
const capture=process.env.CAPTURE!=='0';

(async()=>{
  const {validateDocument}=await import('../../server/document.mjs');
  const database=new Map();
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const contexts=[];
  async function fixture(page,id) {
    // UI-only identity fixture. Signed production authentication is covered by profiles.test.mjs.
    await page.context().route('**/telegram-auth.js',route=>route.fulfill({contentType:'text/javascript',body:'export async function verifyTelegram(data){const p=new URLSearchParams(data);if(p.get("signature")!=="test-fixture")throw new Error("Invalid fixture");const u=JSON.parse(p.get("user"));return {id:String(u.id),name:u.first_name,avatar:null};}'}));
    await page.addInitScript(id=>{
      window.Telegram={WebApp:{initData:new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:`Пользователь ${id}`}),signature:'test-fixture'}).toString(),ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},BackButton:{show(){},hide(){},onClick(callback){window.fixtureBack=callback;}}}};
      window.speechCalls=[];window.cancelCalls=0;window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
      Object.defineProperty(window,'speechSynthesis',{value:{cancel(){window.cancelCalls++;},getVoices(){return [];},speak(value){window.speechCalls.push(value.text);},paused:false}});
    },id);
    await page.route('**/api/profile',async route=>{
      const request=route.request(),auth=new URLSearchParams(request.headers().authorization?.slice(4));
      const user=JSON.parse(auth.get('user'));
      let row=database.get(user.id);
      if(!row){row={profile:{id:String(user.id),name:user.first_name,avatar:null},document:null,revision:0,updatedAt:0};database.set(user.id,row);}
      if(request.method()==='PUT'){
        const input=request.postDataJSON();
        if(input.revision!==row.revision){await route.fulfill({status:409,json:{error:'conflict'}});return;}
        try{row.document=JSON.parse(JSON.stringify(validateDocument(input.document)));}
        catch(error){await route.fulfill({status:error.status||400,json:{error:error.code,message:error.message}});return;}
        row.revision++;row.updatedAt=Date.now();await route.fulfill({json:{revision:row.revision,updatedAt:row.updatedAt}});
      }else await route.fulfill({json:row});
    });
    await page.route('https://commons.wikimedia.org/**',route=>route.abort());
  }
  async function ready(page){await page.waitForFunction(()=>window.WordflowData&&!document.body.classList.contains('profile-loading'));}
  async function idle(page){await page.waitForFunction(()=>!busy&&!navigationPending);}
  async function overview(page){
    if(!await page.locator('#library').isVisible()) await page.locator('#open-library').click();
    else if(!await page.locator('#library-overview').isVisible()) await page.locator('#close-library').click();
    await page.locator('#library-overview').waitFor({state:'visible'});await idle(page);
  }
  async function openDeck(page,id){await page.locator(`.library-collection-row[data-collection-id="${id}"] .secondary-action`).click();await page.locator('#library-detail').waitFor({state:'visible'});}
  async function createDeck(page,name){
    await page.locator(await page.locator('#library-overview').isVisible()?'#overview-new-collection':'#new-collection').click();
    await page.locator('#collection-name').fill(name);await page.locator('#save-collection').click();
    const id=await page.evaluate(name=>collections.find(item=>item.name===name)?.id,name);assert.ok(id);
    if(await page.locator('#library-overview').isVisible())await openDeck(page,id);
    return id;
  }
  async function openWord(page,id){await page.locator(`.word-row[data-word-id="${id}"] .word-details-button`).click();await page.locator('#word-panel').waitFor({state:'visible'});}
  async function answer(page,kind){const before=await page.evaluate(()=>state.attempts);await page.locator(`[data-answer="${kind}"]`).click();await page.waitForFunction(before=>state.attempts===before+1,before);await idle(page);}
  async function screenshot(page,name,width){if(capture){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`.impeccable/build/library-${width}-${name}.png`,fullPage:!await page.locator('#word-panel').isVisible()});}}
  try{
    fs.mkdirSync('.impeccable/build',{recursive:true});
    const finished=[];
    for(const width of [360,390,1280]){
      const id=1000+width;
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce',serviceWorkers:'allow'});contexts.push(context);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await fixture(page,id);await page.goto(base);await ready(page);
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      await page.evaluate(()=>{effectsEnabled=false;applyEffects();savePreferences();});
      if(width===360) {
        await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
        const before=await page.evaluate(()=>WordflowData.snapshot());
        await page.evaluate(()=>{window.answerSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('wordflow.profile.'))throw Error('Storage full');return window.answerSetItem.call(this,key,value);};});
        await page.locator('[data-answer="yes"]').click();await idle(page);
        assert.deepEqual(await page.evaluate(()=>WordflowData.snapshot()),before,'a failed answer leaves progress and history unchanged');
        await page.evaluate(()=>{Storage.prototype.setItem=window.answerSetItem;});
        await answer(page,'yes');const answered=await page.evaluate(()=>WordflowData.snapshot());
        await page.evaluate(()=>{Storage.prototype.setItem=function(key,value){if(key.startsWith('wordflow.profile.'))throw Error('Storage full');return window.answerSetItem.call(this,key,value);};});
        await page.locator('#undo').click();
        assert.deepEqual(await page.evaluate(()=>WordflowData.snapshot()),answered,'a failed undo preserves its answer and remains retryable');
        await page.evaluate(()=>{Storage.prototype.setItem=window.answerSetItem;});await page.locator('#undo').click();
        assert.deepEqual(await page.evaluate(()=>WordflowData.snapshot()),before);
      }
      await page.locator('#open-profile').click();
      assert.equal(await page.locator('#profile-weekly-empty').isVisible(),true);
      await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>state.attempts),0);
      await page.locator('#profile-back').click();
      await overview(page);
      assert.equal(await page.locator('.library-collection-row').count(),1);
      assert.equal(await page.locator('.library-collection-row').first().getAttribute('data-collection-id'),'all');
      await page.locator('#collection-overview-search').fill('такого словаря нет');
      assert.equal(await page.locator('.library-collection-row').count(),0);
      assert.equal(await page.locator('#collection-overview-empty').isVisible(),true);
      await page.locator('#collection-overview-search').fill('');
      const deck=await createDeck(page,'Слова для разговора');
      assert.equal(await page.locator('#study-collection').isDisabled(),true);
      await page.locator('#word-entry-bulk').click();
      await page.locator('#bulk-words').fill('sunshine - солнечный свет\nneighbour - сосед\nwhisper - говорить тихо');
      await page.locator('#add-bulk-words').click();
      assert.equal(await page.evaluate(()=>WORDS.length),23);
      assert.deepEqual(await page.evaluate(id=>collections.find(item=>item.id===id).wordIds,deck),[20,21,22]);
      await page.locator('#study-collection').click();await idle(page);
      await answer(page,'no');await answer(page,'hard');await answer(page,'yes');
      assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().answers),3);
      assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().uniqueWords),3);
      await page.locator('#undo').click();
      assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().answers),2);
      assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().uniqueWords),2);
      await overview(page);await openDeck(page,deck);
      await openWord(page,21);
      const attempts=await page.evaluate(()=>state.attempts);
      await page.keyboard.press('ArrowRight');await page.keyboard.press('Digit1');
      assert.equal(await page.evaluate(()=>state.attempts),attempts,'word panel blocks hidden card shortcuts');
      await page.locator('#panel-speak-word').click();assert.equal(await page.evaluate(()=>speechCalls.at(-1)),'neighbour');
      for(let i=0;i<12;i++)await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.getElementById('word-panel').contains(document.activeElement)),true,'native dialog traps focus');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#word-panel').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.closest('.word-row')?.dataset.wordId),'21');
      await openWord(page,21);await page.locator('#panel-edit-word').click();
      await page.locator('#edit-word-en').fill('SUNSHINE');await page.locator('#save-word-edit').click();
      assert.equal(await page.locator('#word-panel-error').isVisible(),true);
      assert.equal(await page.locator('#edit-word-en').inputValue(),'SUNSHINE');
      assert.equal(await page.locator('#word-edit-warning').isVisible(),true);
      await page.locator('#edit-word-en').fill('neighbour');await page.locator('#edit-word-ru').fill('сосед по улице');
      const oldKey=await page.evaluate(()=>WORDS[21].key);
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      const beforeQuota=await page.evaluate(()=>({document:JSON.stringify({...WordflowData.snapshot(),exportedAt:undefined}),cache:Object.entries(localStorage).find(([key])=>key.startsWith('wordflow.profile.'))}));
      await page.evaluate(()=>{window.fixtureSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('wordflow.profile.'))throw new DOMException('Quota exceeded','QuotaExceededError');return fixtureSetItem.call(this,key,value);};});
      await page.locator('#save-word-edit').click();
      assert.equal(await page.locator('#word-panel-error').isVisible(),true);
      assert.equal(await page.locator('#edit-word-ru').inputValue(),'сосед по улице','quota failure preserves the edit draft');
      assert.deepEqual(await page.evaluate(()=>({document:JSON.stringify({...WordflowData.snapshot(),exportedAt:undefined}),cache:Object.entries(localStorage).find(([key])=>key.startsWith('wordflow.profile.'))})),beforeQuota,'quota failure preserves live snapshot and account cache');
      await page.evaluate(()=>{Storage.prototype.setItem=window.fixtureSetItem;});
      await page.locator('#save-word-edit').click();
      assert.equal(await page.locator('.word-panel-translation').textContent(),'сосед по улице');
      assert.equal(await page.evaluate(()=>WORDS[21].key),oldKey);
      await page.evaluate(()=>fixtureBack());assert.equal(await page.locator('#word-panel').isVisible(),false,'Telegram Back closes word panel first');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('.word-row')?.dataset.wordId),'21','focus returns to the same word after an edit rerenders its row');
      assert.equal(await page.locator('#library-detail').isVisible(),true);
      const secondDeck=await createDeck(page,'Вторая подборка');
      await overview(page);await openDeck(page,'all');
      await page.locator('#select-library-words').click();
      await page.locator('.word-row[data-word-id="0"] .library-word-select input').check();
      await page.locator('#word-search').fill('sunshine');
      await page.locator('.word-row[data-word-id="20"] .library-word-select input').check();
      await page.locator('#word-search').fill('');
      assert.equal(await page.locator('#library-selected-count').textContent(),'Выбрано: 2');
      assert.equal(await page.locator('.word-row[data-word-id="0"] .library-word-select input').isChecked(),true);
      await page.locator('#add-selected-to-collections').click();
      await page.locator(`#word-collection-options input[value="${secondDeck}"]`).check();
      await page.locator('#save-word-collections').click();
      assert.deepEqual(await page.evaluate(id=>collections.find(item=>item.id===id).wordIds,secondDeck),[0,20]);
      await page.locator('#select-library-words').click();
      await openWord(page,21);await page.locator('#panel-delete-word').click();await page.locator('#confirm-delete-word').click();
      assert.equal(await page.evaluate(()=>WORDS[21].en),'whisper','deleting a middle custom word remaps following numeric IDs');
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().answers),2,'deletion preserves historical totals');
      validateDocument(await page.evaluate(()=>WordflowData.snapshot()));
      await page.locator('#open-profile').click();
      assert.equal(await page.locator('#profile-answer-count').textContent(),'2');
      assert.equal(await page.locator('.profile-week-day').count(),7);
      const deletedItem=page.locator('#profile-difficult-words li').filter({hasText:'neighbour'});
      assert.equal(await deletedItem.count(),1);
      assert.equal(await deletedItem.locator('button').count(),0,'deleted historical word has no stale open action');
      const profileWord=page.locator('#profile-difficult-words button').first();await profileWord.click();
      assert.equal(await page.locator('#word-panel').isVisible(),true,'difficult word opens above profile');
      await page.keyboard.press('Escape');assert.equal(await profileWord.evaluate(node=>node===document.activeElement),true);
      await page.locator('#profile-back').click();
      await overview(page);
      assert.equal(await page.locator('.library-collection-row').count(),3);
      assert.equal(await page.locator('.library-collection-row').first().getAttribute('data-collection-id'),'all');
      assert.deepEqual(errors,[]);
      await page.waitForFunction(()=>document.getElementById('profile-sync-status')?.dataset.state==='saved');
      assert.equal(database.get(id).document.activity.events.length,2);
      finished.push({page,context,width,deck,secondDeck,errors});
      console.log(`PASS ${width}: overview, creation, bulk words, details, edit validation, delete remap, selection, weekly undo, focus, Telegram Back`);
    }
    assert.equal(database.get(1360).document.customWords.length,2);
    assert.equal(database.get(1390).document.activity.events.length,2);
    for(const {page,context,width,deck,errors} of finished){
      await screenshot(page,'overview',width);
      await openDeck(page,deck);await page.locator('#word-list').scrollIntoViewIfNeeded();await screenshot(page,'detail',width);
      await openWord(page,20);await screenshot(page,'word',width);
      await page.locator('#panel-edit-word').click();await page.locator('#edit-word-en').fill('sunlight');await screenshot(page,'edit',width);
      await page.keyboard.press('Escape');await openWord(page,20);await page.locator('#panel-delete-word').click();await screenshot(page,'delete',width);
      await page.keyboard.press('Escape');await page.locator('#open-profile').click();await screenshot(page,'profile',width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      if(process.env.APP_OFFLINE==='1'){
        await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
        const assets=await page.evaluate(async()=>{const cache=await caches.open('wordflow-profiles-v3');return Promise.all(['/wordflow-model.js','/wordflow-activity.js','/wordflow-library.js','/wordflow-library.css'].map(url=>cache.match(url).then(Boolean)));});
        assert.deepEqual(assets,[true,true,true,true]);await context.setOffline(true);await page.reload();await ready(page);
        assert.equal(await page.evaluate(()=>WordflowData.getWeeklyStats().answers),2);await overview(page);await openDeck(page,'all');await openWord(page,20);
        assert.equal(await page.locator('#word-panel').isVisible(),true,'new word module works after offline reload');await context.setOffline(false);
      }
      if(width===1280){
        await page.evaluate(()=>WordflowData.closeOverlays());
        const stored=await page.evaluate(()=>{
          const next=WordflowData.snapshot();
          const session=queue=>({queue,learned:[],difficult:[],hinted:[],attempts:0,streak:0,bestStreak:0});
          while(next.customWords.length<500){const index=next.customWords.length;next.customWords.push({key:WordflowModel.createWordKey(),en:`sampleword${index}`,ru:'слово для проверки длинного списка',ipa:''});}
          next.session=session(Array.from({length:520},(_,i)=>i));
          next.collections={activeId:'all',items:Array.from({length:1000},(_,i)=>({id:`deck-scale-${i}`,name:`Словарь для длинного списка № ${i}`,wordIds:[]})),sessions:{}};
          for(const deck of next.collections.items)next.collections.sessions[deck.id]=session([]);
          return commitDocument(next);
        });
        assert.equal(stored,true,'500 words and 1000 dictionaries fit the supported data limits');
        if(await page.locator('#profile-panel').isVisible())await page.locator('#profile-back').click();
        await overview(page);assert.equal(await page.locator('.library-collection-row').count(),1001);
        await page.locator('#collection-overview-search').fill('№ 999');assert.equal(await page.locator('.library-collection-row').count(),1);
        await page.locator('#collection-overview-search').fill('');await openDeck(page,'all');
        assert.equal(await page.locator('.word-details-button').count(),520);
        await page.locator('#word-search').fill('sampleword499');assert.equal(await page.locator('.word-details-button').count(),1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        console.log('PASS 500 custom words / 1000 dictionaries: render, search and supported document limit');
      }
    }
    console.log('PASS separate authenticated accounts; consolidated responsive captures'+(process.env.APP_OFFLINE==='1'?', cached modules and offline history':' (offline covered separately by profiles suite)'));
  }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
