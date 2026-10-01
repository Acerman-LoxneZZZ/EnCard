const {chromium}=require('./browser-runtime/node_modules/playwright');
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['wide',{width:2560,height:1080}],['mobile',{width:390,height:844}],['small',{width:320,height:740}]]){
   const page=await browser.newPage({viewport}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**/*',r=>r.abort());
   await page.goto('file:///'+path.resolve('index.html').replace(/\\/g,'/'));await page.waitForTimeout(600);
   const initial=await page.evaluate(()=>{const r=document.querySelector('.deck-viewport').getBoundingClientRect();return {left:r.left,right:r.right,viewport:document.documentElement.getBoundingClientRect().width,cardWidth:card.offsetWidth,height:document.documentElement.scrollHeight};});
   if(process.argv.includes('--baseline')){
    console.log(name,JSON.stringify(initial));
    if(name==='desktop'||name==='mobile')await page.screenshot({path:'.impeccable/build/swipe-before-'+name+'.png'});
    await page.close();continue;
   }
   assert.ok(Math.abs(initial.left)<1,name+': left clip edge');
   assert.ok(Math.abs(initial.right-initial.viewport)<1,name+': right clip edge');
   for(const kind of ['yes','no']){
    await page.evaluate(kind=>{rate(kind);clearTimeout(transitionTimer);card.style.transition='none';},kind);
    const end=await page.evaluate(()=>{const r=card.getBoundingClientRect();return {left:r.left,right:r.right,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight};});
    assert.ok(kind==='yes'?end.left>initial.viewport:end.right<0,name+': complete exit '+kind);
    assert.ok(end.width<=viewport.width,name+': no horizontal overflow');
    assert.equal(end.height,initial.height,name+': stable height');
    await page.evaluate(()=>{busy=false;render();});
   }
   const r=await page.locator('#card').boundingBox();
   await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
   await page.mouse.move(viewport.width-20,r.y+r.height/2,{steps:10});
   const during=await page.evaluate(()=>({width:card.offsetWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   assert.equal(during.width,initial.cardWidth,name+': unchanged card width');
   assert.equal(during.height,initial.height,name+': stable drag height');
   assert.ok(during.scrollWidth<=viewport.width,name+': no drag overflow');
   if(name==='desktop'||name==='mobile')await page.screenshot({path:'.impeccable/build/swipe-after-'+name+'.png'});
   await page.mouse.up();await page.waitForTimeout(560);
   await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>rate('no'));await page.waitForTimeout(30);
   assert.equal(await page.evaluate(()=>busy),false,name+': reduced motion');
   await page.setViewportSize({width:700,height:900});await page.waitForTimeout(50);
   const resized=await page.evaluate(()=>{const r=document.querySelector('.deck-viewport').getBoundingClientRect();return {left:r.left,right:r.right,width:document.documentElement.getBoundingClientRect().width};});
   assert.ok(Math.abs(resized.left)<1&&Math.abs(resized.right-resized.width)<1,name+': resized screen edges');
   assert.deepEqual(errors,[],name+': no runtime errors');
   console.log('PASS '+name+': both edges, drag, stable scroll, reduced motion');await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

