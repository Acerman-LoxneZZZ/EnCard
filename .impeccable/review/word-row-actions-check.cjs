const {chromium}=require('./browser-runtime/node_modules/playwright');
const assert=require('node:assert/strict');

(async()=>{
  const {validateDocument}=await import('../../server/document.mjs');
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    for(const width of [320,390,1280]) {
      const page=await browser.newPage({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://**/*',route=>route.abort());
      await page.goto('http://127.0.0.1:4176');
      await page.locator('#open-library').click();
      assert.equal(await page.locator('#library-detail').isVisible(),true,'single dictionary opens directly');
      assert.equal(await page.locator('#library-overview').isVisible(),false);
      assert.equal(await page.locator('#select-library-words').isVisible(),false);
      await page.locator('#word-entry-bulk').click();
      await page.locator('#bulk-words').fill('sunshine - солнечный свет\nneighbour - сосед\nwhisper - шептать');
      await page.locator('#add-bulk-words').click();
      await page.evaluate(()=>{const doc=WordflowData.snapshot();doc.session.queue=doc.session.queue.filter(id=>id!==20&&id!==21);doc.session.learned=[20,21];doc.session.attempts=2;commitDocument(doc);});
      const row=id=>page.locator(`.word-row[data-word-id="${id}"]`);
      await row(20).locator('.word-row-edit').click();
      assert.equal(await page.locator('#word-panel').isVisible(),false,'editing stays in the row');
      await row(20).locator('[name="en"]').fill('NEIGHBOUR');
      await row(20).locator('button[type="submit"]').click();
      assert.equal(await row(20).locator('.word-row-error').isVisible(),true);
      assert.equal(await page.evaluate(()=>WORDS[20].en),'sunshine');
      await row(20).locator('[name="en"]').fill('sunshine');
      await row(20).locator('[name="ru"]').fill('солнечный день');
      await row(20).locator('button[type="submit"]').click();
      assert.equal(await row(20).locator('.row-translation').innerText(),'солнечный день');
      assert.deepEqual(await page.evaluate(()=>state.learned),[20,21],'translation edit keeps progress');
      await row(20).locator('.word-row-edit').click();
      await row(20).locator('[name="en"]').fill('sunlight');
      assert.equal(await row(20).locator('.word-edit-warning').isVisible(),true);
      await row(20).locator('button[type="submit"]').click();
      assert.deepEqual(await page.evaluate(()=>state.learned),[21]);
      assert.equal(await page.evaluate(()=>state.queue.at(-1)),20);
      const before=await page.evaluate(()=>JSON.stringify({...WordflowData.snapshot(),exportedAt:undefined}));
      await row(21).locator('.word-row-delete').click();
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      assert.equal(await page.evaluate(()=>WORDS[21].en),'whisper');
      const undo=page.locator('#undo-delete-word');
      assert.equal(await undo.isVisible(),true);
      const undoRect=await undo.boundingBox();assert.ok(undoRect.y>=0&&undoRect.y+undoRect.height<=900,'undo stays in the visible screen');
      await undo.click();
      assert.equal(await page.evaluate(()=>JSON.stringify({...WordflowData.snapshot(),exportedAt:undefined})),before,'undo restores exact words and progress');
      validateDocument(await page.evaluate(()=>WordflowData.snapshot()));
      await row(22).locator('.word-row-delete').click();
      await row(20).locator('.word-row-edit').click();
      await row(20).locator('[name="ru"]').fill('свет солнца');
      await row(20).locator('button[type="submit"]').click();
      assert.equal(await undo.isVisible(),false,'a subsequent change invalidates old deletion undo');
      await row(20).locator('.word-row-edit').click();
      await row(20).locator('[name="ru"]').fill('не сохранять');
      await row(20).locator('[name="ru"]').press('Escape');
      assert.equal(await row(20).locator('.row-translation').innerText(),'свет солнца');
      await page.locator('#word-search').fill('sunlight');
      if(width!==320) {
        await row(20).locator('.word-row-edit').click();
        await row(20).scrollIntoViewIfNeeded();
        await page.screenshot({path:`.impeccable/build/word-row-edit-${width}.png`,fullPage:true});
        await row(20).locator('[name="en"]').press('Escape');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      await page.locator('#close-library').click();
      assert.equal(await page.locator('#session').isVisible(),true,'Back returns to cards directly');
      await page.reload();await page.locator('#open-library').click();
      assert.equal(await page.evaluate(()=>WORDS[20].ru),'свет солнца');
      assert.equal(await page.evaluate(()=>WORDS.length),22);
      console.log(`PASS ${width}: direct library, inline edits, duplicates, progress, delete remap, visible undo, lossless restore, invalidation, Escape, persistence`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
