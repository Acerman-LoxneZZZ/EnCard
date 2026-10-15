const {chromium}=require('./browser-runtime/node_modules/playwright');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');

(async()=>{
  const {validateDocument}=await import('../../server/document.mjs');
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for(const [name,width,height] of [['small',320,740],['mobile',390,844],['desktop',1280,1000]]) {
      const page=await browser.newPage({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://**/*',route=>route.abort());
      await page.goto(pathToFileURL(path.resolve('index.html')).href);
      await page.evaluate(()=>{effectsEnabled=false;applyEffects();savePreferences();rate('yes');toggleLibrary(true);});
      await page.locator('#custom-en').fill('draft');
      if(width<600) {
        await page.locator('#word-entry-title').scrollIntoViewIfNeeded();
        const r=await page.locator('#word-entry-title').boundingBox(), y=r.y+r.height/2;
        const cdp=await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width*.85,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width*.15,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else await page.locator('#word-entry-bulk').click();
      assert.equal(await page.locator('#word-entry-bulk').getAttribute('aria-selected'),'true');
      await page.locator('#bulk-words').fill('add - добавлять\nnurse _ медсестра\nADD : прибавлять\ndiscover → открывать');
      await page.locator('#word-entry-single').click();
      assert.equal(await page.locator('#custom-en').inputValue(),'draft');
      await page.locator('#word-entry-single').press('ArrowRight');
      assert.match(await page.locator('#bulk-words').inputValue(),/nurse/);
      await page.locator('#add-bulk-words').click();
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      assert.deepEqual(await page.evaluate(()=>[...state.learned]),[0],'existing learning progress is preserved');
      assert.match(await page.locator('#word-entry-result').textContent(),/Добавлено в словарь: 2/);
      assert.equal(await page.evaluate(()=>WORDS.at(-1).ipa.length>0),true);
      validateDocument(await page.evaluate(()=>window.WordflowData.snapshot()));
      await page.locator('#bulk-words').fill('help - помогать\ninvalid');
      await page.locator('#add-bulk-words').click();
      assert.equal(await page.evaluate(()=>WORDS.length),22,'an invalid list adds nothing');
      assert.match(await page.locator('#bulk-word-error').textContent(),/Строка 2/);
      assert.equal(await page.locator('#bulk-words').getAttribute('aria-invalid'),'true');
      // A failed second storage write rolls back the first and preserves the draft.
      await page.locator('#bulk-words').fill('help - помогать');
      const saved=await page.evaluate(()=>[...Object.keys(localStorage)].sort().map(key=>[key,localStorage.getItem(key)]));
      await page.evaluate(()=>{
        window.originalSetItem=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key===STORAGE_KEY)throw Error('Storage full');return window.originalSetItem.call(this,key,value);};
      });
      await page.locator('#add-bulk-words').click();
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      assert.equal(await page.locator('#bulk-words').inputValue(),'help - помогать');
      assert.deepEqual(await page.evaluate(()=>[...Object.keys(localStorage)].sort().map(key=>[key,localStorage.getItem(key)])),saved);
      await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
      await page.locator('#new-collection').click();
      await page.locator('#collection-name').fill('Работа');await page.locator('#save-collection').click();
      await page.locator('#word-entry-bulk').click();
      await page.locator('#bulk-words').fill('nurse - медсестра\nwork = работать\nwork : работа');
      await page.locator('#add-bulk-words').click();
      assert.deepEqual(await page.evaluate(()=>collectionWordIds(browsingCollectionId).map(id=>WORDS[id].en)),['nurse','work']);
      assert.equal(await page.evaluate(()=>WORDS.length),23);
      assert.match(await page.locator('#word-entry-result').textContent(),/Добавлено в словарь: 2/);
      validateDocument(await page.evaluate(()=>window.WordflowData.snapshot()));
      await page.locator('#study-collection').click();
      await page.locator('#open-library').click();
      await page.locator('#bulk-words').fill('duty = обязанность');
      await page.locator('#add-bulk-words').click();
      assert.equal(await page.evaluate(()=>state.queue.length),3,'adding to the active personal deck updates its live queue');
      await page.locator('#bulk-words').fill('agree - соглашаться\ncare — забота');
      if(name!=='small') {
        await page.locator('#word-entry').scrollIntoViewIfNeeded();
        await page.screenshot({path:`.impeccable/build/word-list-${name}.png`,fullPage:true});
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const before=await page.evaluate(()=>JSON.stringify({...window.WordflowData.snapshot(),exportedAt:undefined}));
      await page.reload();
      assert.equal(await page.evaluate(()=>JSON.stringify({...window.WordflowData.snapshot(),exportedAt:undefined})),before,'words, memberships and progress survive reload');
      await page.evaluate(()=>{effectsEnabled=false;applyEffects();toggleLibrary(true);});
      await page.locator('#custom-en').fill('care');await page.locator('#custom-ru').fill('забота');
      await page.locator('#add-word-form button[type="submit"]').click();
      assert.equal(await page.evaluate(()=>WORDS.at(-1).en),'care','single entry still works');
      validateDocument(await page.evaluate(()=>window.WordflowData.snapshot()));
      assert.deepEqual(errors,[]);
      console.log(`PASS ${name}: tabs, keyboard, drafts, examples, duplicates, validation, storage rollback, personal dictionary, persistence, single entry, valid cloud document`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
