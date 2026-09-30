let dictionaryTrigger = null, dictionaryMode = 'library', dictionaryAnimation = null;
let screenAnimation = null, pendingScreenChange = null, navigationPending = false;

function closeDictionaryMenu(restoreFocus = false) {
  const trigger = dictionaryTrigger;
  dictionaryTrigger = null;
  dictionaryAnimation?.cancel(); dictionaryAnimation = null;
  $('dictionary-menu').hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && trigger && !trigger.hidden) trigger.focus({preventScroll: true});
}
function toggleDictionaryMenu(trigger, mode) {
  if (busy || navigationPending) return;
  if (dictionaryTrigger === trigger) { closeDictionaryMenu(true); return; }
  closeDictionaryMenu();
  dictionaryTrigger = trigger; dictionaryMode = mode;
  const selected = mode === 'study' ? activeCollectionId : browsingCollectionId;
  const menu = $('dictionary-menu');
  menu.replaceChildren(...[{id: 'all', name: 'Общий словарь'}, ...collections].map(item => {
    const option = document.createElement('button'); option.type = 'button'; option.className = 'dictionary-option';
    option.dataset.collectionId = item.id; option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.id === selected)); option.tabIndex = -1;
    const content = document.createElement('span'), name = document.createElement('span'), meta = document.createElement('small');
    name.className = 'dictionary-option-name'; name.textContent = item.name;
    const count = collectionWordIds(item.id).length;
    meta.textContent = count ? `Слов: ${count} · Выучено: ${collectionSessions[item.id].learned.length}` : 'Пока нет слов';
    content.append(name, meta);
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); mark.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-check'); mark.append(use);
    option.append(content, mark);
    option.addEventListener('click', () => {
      const destination = dictionaryMode;
      closeDictionaryMenu(true);
      if (destination === 'library') selectCollection(item.id);
      else if (item.id !== activeCollectionId) {
        if (count) studyCollection(item.id, false);
        else toggleLibrary(true, item.id);
      }
    });
    return option;
  }));
  menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  positionDictionaryMenu();
  const current = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
  current?.focus({preventScroll: true});
  scrollDictionaryOption(current);
  if (moving() && menu.animate) dictionaryAnimation = menu.animate([
    {opacity: 0, transform: 'translateY(-4px) scale(.975)'},
    {opacity: 1, transform: 'translateY(0) scale(1)'}
  ], {duration: 240, easing: 'cubic-bezier(.16,1,.3,1)'});
}
function positionDictionaryMenu() {
  if (!dictionaryTrigger) return;
  const trigger = dictionaryTrigger, menu = $('dictionary-menu'), mode = dictionaryMode;
  const rect = trigger.getBoundingClientRect(), gap = 8, edge = 16;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(Math.max(rect.width, 304), 460, viewportWidth - edge * 2);
  const left = mode === 'study' ? rect.left + (rect.width - width) / 2 : rect.left;
  const bottom = rect.top + rect.height;
  const below = viewportHeight - bottom - gap - edge, above = rect.top - gap - edge;
  const opensAbove = below < 240 && above > below;
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(edge, Math.min(left, viewportWidth - width - edge))}px`;
  menu.style.maxHeight = `${Math.max(80, Math.min(360, opensAbove ? above : below))}px`;
  menu.style.top = opensAbove ? 'auto' : `${Math.max(edge, bottom + gap)}px`;
  menu.style.bottom = opensAbove ? `${viewportHeight - rect.top + gap}px` : 'auto';
  menu.style.transformOrigin = opensAbove ? 'bottom center' : 'top center';
}
function scrollDictionaryOption(option) {
  if (!option) return;
  const menu = $('dictionary-menu');
  // Scroll only the list, never the page: scrolling the page used to close the menu.
  const top = option.offsetTop, bottom = top + option.offsetHeight;
  if (top < menu.scrollTop) menu.scrollTop = top;
  else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
}
function settleScreenTransition() {
  if (screenAnimation) { screenAnimation.onfinish = null; screenAnimation.cancel(); screenAnimation = null; }
  const change = pendingScreenChange; pendingScreenChange = null; navigationPending = false;
  $('screen-stage').inert = false;
  change?.();
  if (change) updateControls();
}
function navigateScreen(change, direction = 1) {
  if (navigationPending) return;
  closeDictionaryMenu(); settleScreenTransition();
  const stage = $('screen-stage');
  if (!moving() || !stage.animate) { change(); return; }
  pendingScreenChange = change; navigationPending = true; stage.inert = true; updateControls();
  screenAnimation = stage.animate([
    {opacity: 1, transform: 'translateX(0) scale(1)'},
    {opacity: 0, transform: `translateX(${-12 * direction}px) scale(.99)`}
  ], {duration: 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards'});
  screenAnimation.onfinish = () => {
    screenAnimation.cancel(); screenAnimation = null;
    pendingScreenChange = null; navigationPending = false; stage.inert = false;
    change();
    screenAnimation = stage.animate([
      {opacity: 0, transform: `translateX(${20 * direction}px) scale(.99)`},
      {opacity: 1, transform: 'translateX(0) scale(1)'}
    ], {duration: 380, easing: 'cubic-bezier(.16,1,.3,1)'});
    screenAnimation.onfinish = () => { screenAnimation.cancel(); screenAnimation = null; };
  };
}
function initNavigation() {
  $('collection-select').addEventListener('click', event => toggleDictionaryMenu(event.currentTarget, 'library'));
  $('active-collection').addEventListener('click', event => toggleDictionaryMenu(event.currentTarget, 'study'));
  for (const [id, mode] of [['collection-select', 'library'], ['active-collection', 'study']]) {
    $(id).addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!dictionaryTrigger) toggleDictionaryMenu(event.currentTarget, mode);
      }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (dictionaryTrigger && !dictionaryTrigger.contains(event.target) && !$('dictionary-menu').contains(event.target)) closeDictionaryMenu();
  });
  document.addEventListener('focusin', event => {
    if (dictionaryTrigger && !dictionaryTrigger.contains(event.target) && !$('dictionary-menu').contains(event.target)) closeDictionaryMenu();
  });
  document.addEventListener('keydown', event => {
    if (!dictionaryTrigger) return;
    const options = [...$('dictionary-menu').querySelectorAll('[role="option"]')], index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDictionaryMenu(true); return; }
    if (event.key === 'Tab') { closeDictionaryMenu(true); return; }
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next >= 0) { event.preventDefault(); event.stopPropagation(); options[next].focus({preventScroll: true}); scrollDictionaryOption(options[next]); }
  });
  window.addEventListener('resize', positionDictionaryMenu);
  window.addEventListener('scroll', positionDictionaryMenu, {passive: true});
}
