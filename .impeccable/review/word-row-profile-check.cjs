const {chromium}=require('./browser-runtime/node_modules/playwright');
const assert=require('node:assert/strict');

(async()=>{
  const {validateDocument,BUILTIN_WORDS}=await import('../../server/document.mjs');
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for(const width of [390,1280]) {
      const ids=Array.from({length:23},(_,i)=>i);
      const old={format:'wordflow-backup',version:1,builtinWords:[...BUILTIN_WORDS],customWords:['sunshine','neighbour','whisper'].map(en=>({en,ru:'перевод',ipa:''})),
        session:{queue:ids.filter(id=>id!==20),learned:[20],difficult:[],hinted:[],attempts:1,streak:1,bestStreak:1},collections:{items:[],activeId:'all',sessions:{}},preferences:{effects:false,shortcuts:true}};
      const remote={profile:{id:'909',name:'Проверка',avatar:null},document:old,revision:1,updatedAt:Date.now()};
      const page=await browser.newPage({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce',serviceWorkers:'block'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{window.Telegram={WebApp:{initData:new URLSearchParams({user:JSON.stringify({id:909,first_name:'Проверка'}),signature:'fixture'}).toString(),ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},BackButton:{show(){},hide(){},onClick(){}}}};});
      await page.route('**/telegram-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function verifyTelegram(){return {id:"909",name:"Проверка",avatar:null};}'}));
      await page.route('https://commons.wikimedia.org/**',r=>r.abort());
      await page.route('**/api/profile',async route=>{
        const request=route.request();
        if(request.method()==='PUT') {
          const input=request.postDataJSON();
          if(input.revision!==remote.revision){await route.fulfill({status:409,json:{error:'conflict'}});return;}
          try {remote.document=JSON.parse(JSON.stringify(validateDocument(input.document)));}catch(error){await route.fulfill({status:400,json:{message:error.message}});return;}
          remote.revision++;remote.updatedAt=Date.now();await route.fulfill({json:{revision:remote.revision,updatedAt:remote.updatedAt}});
        }else await route.fulfill({json:remote});
      });
      await page.goto('http://127.0.0.1:4175');
      await page.waitForFunction(()=>window.WordflowData&&!document.body.classList.contains('profile-loading'));
      await page.locator('#open-library').click();
      await page.locator('.word-row[data-word-id="20"] .word-row-edit').click();
      await page.locator('.word-row-editor [name="ru"]').fill('солнечный свет');
      await page.locator('.word-row-editor button[type="submit"]').click();
      await page.waitForFunction(()=>document.getElementById('profile-sync-status').dataset.state==='saved');
      assert.equal(remote.document.version,2);
      assert.equal(remote.document.customWords[0].ru,'солнечный свет');
      assert.deepEqual(remote.document.session.learned,[20]);
      const key=remote.document.customWords[1].key;
      await page.locator('.word-row[data-word-id="21"] .word-row-delete').click();
      await page.locator('#confirm-delete-word').click();
      await page.locator('#undo-delete-word').click();
      const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordflow.profile.909.v1')).document);
      assert.equal(cached.customWords.length,3,'immediate account cache includes the restoration');
      assert.equal(cached.customWords[1].key,key);
      await page.waitForFunction(()=>document.getElementById('profile-sync-status').dataset.state==='saved');
      assert.equal(remote.document.customWords.length,3);
      await page.locator('.word-row[data-word-id="21"] .word-row-delete').click();
      await page.locator('#confirm-delete-word').click();
      await page.waitForFunction(()=>document.getElementById('profile-sync-status').dataset.state==='saved');
      assert.equal(remote.document.customWords.length,2);
      await page.reload();await page.waitForFunction(()=>window.WordflowData&&!document.body.classList.contains('profile-loading'));
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      assert.equal(await page.evaluate(()=>WORDS[21].en),'whisper');
      assert.equal(await page.evaluate(()=>WORDS[20].ru),'солнечный свет');
      assert.deepEqual(await page.evaluate(()=>state.learned),[20]);
      await page.locator('#open-profile').click();
      await page.evaluate(()=>WordflowData.openWordByKey(WORDS[20].key,document.getElementById('open-profile')));
      await page.locator('#panel-delete-word').click();await page.locator('#confirm-delete-word').click();
      assert.equal(await page.locator('#undo-delete-word').isVisible(),true,'deletion undo is also visible above the profile');
      await page.locator('#undo-delete-word').click();
      assert.equal(await page.evaluate(()=>WORDS[20].en),'sunshine');
      await page.evaluate(()=>WordflowData.openWordByKey(WORDS[0].key,document.getElementById('open-profile')));
      await page.locator('#panel-delete-word').click();await page.locator('#confirm-delete-word').click();
      await page.waitForFunction(()=>document.getElementById('profile-sync-status').dataset.state==='saved');
      assert.deepEqual(remote.document.collections.deletedBuiltinIds,[0]);
      assert.equal(remote.document.session.queue.includes(0),false);
      await page.reload();await page.waitForFunction(()=>window.WordflowData&&!document.body.classList.contains('profile-loading'));
      assert.deepEqual(await page.evaluate(()=>WordflowData.snapshot().collections.deletedBuiltinIds),[0]);
      assert.deepEqual(await page.evaluate(()=>state.learned),[20]);
      await page.locator('#open-library').click();
      assert.equal(await page.locator('.word-row[data-word-id="0"]').count(),0);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: v1 profile migration, inline editing, cloud validation, immediate undo cache, synced deletion, reload and preserved progress`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
