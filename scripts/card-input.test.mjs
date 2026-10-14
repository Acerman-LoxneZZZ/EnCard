import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('// Track taps only:');
const end = html.indexOf("window.addEventListener('keydown'", start);
assert.ok(start >= 0 && end > start, 'Find the production card input handlers');

function input({ captureFails = false, reducedMotion = false, sound = false } = {}) {
  let now = 0, captured = null, flipCount = 0;
  const ratings = [], listeners = new Map(), windowListeners = new Map();
  const inner = { closest() { return null; } };
  const card = {
    style: {}, addEventListener(name, handler) { listeners.set(name, handler); },
    setPointerCapture(id) { if (captureFails) throw new Error('Capture unavailable'); captured = id; },
    hasPointerCapture(id) { return captured === id; },
    releasePointerCapture() { captured = null; },
    contains(target) { return target === inner || target === this; },
    getBoundingClientRect() { return {left:0,top:0,width:350,height:450}; }
  };
  const context = {
    card, cardTap:null, busy:false, flipping:false, flipped:false, tiltFrame:0,
    tilt:{style:{setProperty() {}}}, suppressClickUntil:0,
    navigationPending:false, dictionaryTrigger:null, libraryOpen:false, state:{queue:[0,1,2]},
    precisePointer:{matches:false}, performance:{now:() => now},
    moving:() => !reducedMotion, overSound:() => sound, resetTilt() {},
    setFlipped(value) { flipCount++; context.flipped=value; }, rate(kind) { ratings.push(kind); },
    requestAnimationFrame() {}, cancelAnimationFrame() {},
    window:{addEventListener(name, handler) { windowListeners.set(name, handler); }}
  };
  vm.runInNewContext(html.slice(start, end), context);
  function send(type, {x=100,y=150,id=1,target=inner,...options} = {}, destination='card') {
    now += 16;
    const event = {pointerId:id,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y,
      target,preventDefault() {},...options};
    (destination === 'card' ? listeners : windowListeners).get(type)?.(event);
  }
  return {send,card,inner,ratings,context,flips:() => flipCount};
}

test('a tap flips once even when pointerup bubbles to the window', () => {
  const app=input(); app.send('pointerdown'); app.send('pointerup'); app.send('pointerup',{},'window');
  assert.equal(app.flips(),1); assert.equal(app.context.flipped,true); assert.deepEqual(app.ratings,[]);
});

test('swipes in every direction never move, answer or flip the card', () => {
  for (const [x,y] of [[240,150],[0,150],[100,300],[100,0]]) {
    const app=input(); app.send('pointerdown'); app.send('pointermove',{x,y}); app.send('pointerup',{x,y});
    assert.deepEqual(app.ratings,[]); assert.equal(app.flips(),0); assert.deepEqual(app.card.style,{});
  }
});

test('returning a moved finger to the start does not turn a swipe into a tap', () => {
  const app=input(); app.send('pointerdown'); app.send('pointermove',{x:220}); app.send('pointerup');
  assert.equal(app.flips(),0); assert.deepEqual(app.ratings,[]);
});

test('release coordinates alone suppress a swipe without pointermove', () => {
  const app=input(); app.send('pointerdown'); app.send('pointerup',{x:240});
  assert.equal(app.flips(),0); assert.deepEqual(app.ratings,[]);
});

test('cancelled or lost capture never flips the card', () => {
  for (const event of ['pointercancel','lostpointercapture']) {
    const app=input(); app.send('pointerdown'); app.send(event,{target:app.card}); app.send('pointerup');
    assert.equal(app.flips(),0); assert.equal(app.context.cardTap,null);
  }
});

test('capture failure still finishes a tap through the window', () => {
  const app=input({captureFails:true}); app.send('pointerdown'); app.send('pointerup',{},'window');
  assert.equal(app.flips(),1); assert.equal(app.context.cardTap,null);
});

test('leaving the card or losing window focus cancels a tap', () => {
  const app=input(); app.send('pointerdown',{x:349}); app.send('pointerup',{x:351},'window');
  assert.equal(app.flips(),0);
  app.send('pointerdown'); app.send('blur',{},'window'); app.send('pointerup');
  assert.equal(app.flips(),0); assert.equal(app.context.cardTap,null);
});

test('sound gestures and secondary pointers do not flip the card', () => {
  const sound=input({sound:true}); sound.send('pointerdown'); sound.send('pointerup');
  assert.equal(sound.flips(),0);
  const app=input(); app.send('pointerdown'); app.send('pointerdown',{id:2,isPrimary:false});
  app.send('pointerup',{id:2}); assert.equal(app.flips(),0);
  app.send('pointerup'); assert.equal(app.flips(),1);
});

test('reduced motion keeps taps and disables swipe answers', () => {
  const app=input({reducedMotion:true}); app.send('pointerdown'); app.send('pointerup');
  assert.equal(app.flips(),1);
  app.send('pointerdown'); app.send('pointermove',{x:240}); app.send('pointerup',{x:240});
  assert.equal(app.flips(),1); assert.deepEqual(app.ratings,[]);
});
