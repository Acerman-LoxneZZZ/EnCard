(function (global) {
  'use strict';

  const statusLabels = {learned: 'Выучено', review: 'На повторении', new: 'Впереди'};
  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function button(label, className, action) {
    const node = element('button', className, label);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  function mount(adapter) {
    const library = document.getElementById('library');
    if (!library) return null;
    if (library.wordflowLibraryController) return library.wordflowLibraryController;
    const heading = library.querySelector('.panel-heading');
    const title = document.getElementById('library-title');
    const closeLibrary = document.getElementById('close-library');
    const editor = document.getElementById('collection-editor');
    const detail = element('div', 'library-detail');
    detail.id = 'library-detail';
    [...library.children].filter(node => node !== heading && node !== editor).forEach(node => detail.append(node));
    if (editor) library.append(editor);
    const overview = element('div', 'library-overview');
    overview.id = 'library-overview';
    const toolbar = element('div', 'library-overview-toolbar');
    const searchLabel = element('label', 'search');
    const searchName = element('span', 'sr-only', 'Поиск по названию словаря');
    const search = element('input');
    search.id = 'collection-overview-search';
    search.type = 'search'; search.placeholder = 'Найти словарь'; search.autocomplete = 'off';
    searchLabel.append(searchName, icon('search'), search);
    const create = button('Новый словарь', 'primary-action', () => adapter.createCollection());
    create.id = 'overview-new-collection';
    create.prepend(icon('plus'));
    toolbar.append(searchLabel, create);
    const list = element('ul', 'library-collection-list');
    list.id = 'collection-overview-list';
    const empty = element('p', 'library-overview-empty');
    empty.id = 'collection-overview-empty';
    const firstCollection = element('div', 'library-first-collection');
    firstCollection.append(element('p', '', 'Соберите слова по теме в личный словарь.'),
      button('Создать первый словарь', 'text-action', () => adapter.createCollection()));
    overview.append(toolbar, list, empty, firstCollection);
    library.append(overview, detail);

    const selectionBar = element('div', 'library-selection-bar');
    const selectionToggle = button('Выбрать', 'secondary-action', () => {
      selecting = !selecting;
      if (!selecting) selected.clear();
      updateSelection(); decorateRows();
    });
    selectionToggle.id = 'select-library-words';
    selectionToggle.setAttribute('aria-pressed', 'false');
    const selectionCount = element('span', 'library-selection-count');
    selectionCount.id = 'library-selected-count'; selectionCount.setAttribute('role', 'status');
    const selectionAdd = button('Добавить в словари', 'primary-action', () => {
      if (selected.size) openCollections([...selected], selectionAdd);
    });
    selectionAdd.id = 'add-selected-to-collections';
    selectionBar.append(selectionToggle, selectionCount, selectionAdd);
    const wordList = document.getElementById('word-list');
    wordList.before(selectionBar);
    const undoBar = element('div', 'word-delete-undo');
    undoBar.hidden = true; undoBar.setAttribute('role', 'status');
    const undoLabel = element('span');
    const undoDelete = button('Отменить', 'text-action', () => {
      const pending = lastDeleted;
      if (!pending || !commit(pending.document)) return;
      clearDeleteUndo();
      adapter.notify(`Слово «${pending.en}» восстановлено.`);
      const word = words().find(item => item.key === pending.key);
      wordList.querySelector(`[data-word-id="${word?.id}"] .word-row-edit`)?.focus({preventScroll:true});
    });
    undoDelete.id = 'undo-delete-word';
    undoBar.append(undoLabel, undoDelete); wordList.before(undoBar);

    const dialog = element('dialog', 'word-panel');
    dialog.id = 'word-panel';
    dialog.setAttribute('aria-labelledby', 'word-panel-title');
    const dialogHeader = element('div', 'word-panel-header');
    const dialogTitle = element('h2', '', 'Слово');
    dialogTitle.id = 'word-panel-title'; dialogTitle.tabIndex = -1;
    const close = button('', 'icon-button word-panel-close', () => closeOverlay());
    close.id = 'close-word-panel'; close.setAttribute('aria-label', 'Закрыть подробности слова');
    close.append(icon('x'));
    dialogHeader.append(dialogTitle, close);
    const dialogContent = element('div', 'word-panel-content');
    const error = element('p', 'word-panel-error');
    error.id = 'word-panel-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    dialog.append(dialogHeader, dialogContent, error);
    document.body.append(dialog);
    let mode = 'overview', selecting = false, selected = new Set();
    let currentWordId = null, trigger = null, savedOverflow = '', previousDialogMode = 'word';
    let inlineDraft = null, lastDeleted = null;

    const words = () => adapter.words();
    const wordById = id => words().find(word => word.id === id);
    const collectionId = () => adapter.getBrowsingCollectionId?.() || adapter.snapshot().collections.activeId;
    const collectionName = id => id === 'all' ? 'Общий словарь' : adapter.snapshot().collections.items.find(item => item.id === id)?.name || 'Словарь';
    const sessionFor = (doc, id) => id === 'all' ? doc.session : doc.collections.sessions[id];
    function setError(message) { error.textContent = message; error.hidden = !message; }
    function reportError(failure) {
      const known = {
        duplicate_word: 'Такое английское слово уже есть. Измените написание.',
        builtin_word: 'Встроенные слова нельзя изменять.',
        too_large: 'Не удалось сохранить: превышен размер данных. Сохраните копию в профиле.'
      };
      setError(known[failure?.code] || failure?.message || 'Не удалось сохранить. Попробуйте ещё раз.');
    }
    function commit(document) {
      const ok = adapter.commitDocument(document);
      if (!ok) setError('Не удалось сохранить изменения. Проверьте доступ к памяти устройства и попробуйте ещё раз.');
      return ok;
    }
    function statusFor(id, deckId) {
      if (adapter.getWordStatus) return adapter.getWordStatus(id, deckId);
      const session = sessionFor(adapter.snapshot(), deckId);
      return session?.learned.includes(id) ? 'learned' : session?.difficult.includes(id) ? 'review' : 'new';
    }
    function updateNavigation() {
      const single = !adapter.snapshot().collections.items.length;
      library.classList.toggle('is-single-dictionary', single);
      detail.hidden = mode !== 'collection'; overview.hidden = mode !== 'overview';
      library.dataset.libraryMode = mode;
      title.textContent = single ? 'Словарь' : mode === 'overview' ? 'Словари' : 'Состав словаря';
      closeLibrary.setAttribute('aria-label', single || mode === 'overview' ? 'Вернуться к карточкам' : 'Вернуться к словарям');
      const visibleLabel = closeLibrary.querySelector('span:not(.sr-only)');
      if (visibleLabel) visibleLabel.textContent = single || mode === 'overview' ? 'К карточкам' : 'К словарям';
    }
    function renderOverview() {
      const doc = adapter.snapshot();
      const query = search.value.trim().toLocaleLowerCase('ru');
      const collections = [{id: 'all', name: 'Общий словарь', wordIds: words().map(word => word.id)}, ...doc.collections.items];
      const fragment = document.createDocumentFragment();
      let count = 0;
      for (const collection of collections) {
        if (!collection.name.toLocaleLowerCase('ru').includes(query)) continue;
        count += 1;
        const session = sessionFor(doc, collection.id);
        const total = collection.wordIds.length, learned = session?.learned.length || 0;
        const row = element('li', 'library-collection-row'); row.dataset.collectionId = collection.id;
        const info = element('div', 'library-collection-info');
        const name = element('h2', '', collection.name);
        const summary = element('p', '', total ? `Слов: ${total} · Выучено: ${learned} из ${total}` : 'Пока нет слов');
        const progress = element('progress', 'library-collection-progress');
        progress.max = Math.max(total, 1); progress.value = learned;
        progress.setAttribute('aria-label', `Прогресс словаря «${collection.name}»: ${learned} из ${total}`);
        info.append(name, summary, progress);
        const actions = element('div', 'library-collection-actions');
        const open = button('Открыть', 'secondary-action', () => openCollection(collection.id));
        open.setAttribute('aria-label', `Открыть словарь «${collection.name}»`);
        const complete = total > 0 && learned === total;
        const label = complete ? 'Пройти заново' : (session?.attempts || learned) ? 'Продолжить' : 'Учить';
        const study = button(label, 'primary-action', () => adapter.studyCollection(collection.id, complete));
        study.disabled = !total; study.setAttribute('aria-label', `${label}: ${collection.name}`);
        actions.append(open, study); row.append(info, actions); fragment.append(row);
      }
      list.replaceChildren(fragment);
      empty.hidden = count > 0;
      empty.textContent = query ? 'Словарей с таким названием нет. Попробуйте другой запрос.' : 'Словари пока не добавлены.';
      firstCollection.hidden = !!doc.collections.items.length || !!query;
    }
    function updateSelection() {
      selectionBar.hidden = !adapter.snapshot().collections.items.length;
      selectionToggle.textContent = selecting ? 'Отменить выбор' : 'Выбрать';
      selectionToggle.setAttribute('aria-pressed', String(selecting));
      selectionCount.hidden = !selecting; selectionAdd.hidden = !selecting;
      selectionCount.textContent = `Выбрано: ${selected.size}`;
      selectionAdd.disabled = !selected.size;
      wordList.classList.toggle('is-selecting', selecting);
    }
    function decorateRows() {
      const builtinCount = adapter.snapshot().builtinWords.length;
      for (const row of wordList.querySelectorAll('.word-row[data-word-id]')) {
        const id = Number(row.dataset.wordId), word = wordById(id);
        if (!word) continue;
        row.classList.add('has-word-details');
        let open = row.querySelector('.word-details-button');
        if (!open) {
          open = button('', 'word-details-button', () => openWord(Number(row.dataset.wordId), open));
          open.append(icon('chevron'));
          row.append(open);
        }
        open.setAttribute('aria-label', `Открыть слово ${word.en}`);
        if (word.id >= builtinCount && !row.querySelector('.word-row-actions')) {
          const actions = element('div', 'word-row-actions');
          const edit = button('Редактировать', 'word-row-edit', () => openInlineEdit(word.key));
          edit.setAttribute('aria-label', `Редактировать слово ${word.en}`);
          const remove = button('Удалить', 'word-row-delete', () => deleteWordNow(word.id));
          remove.setAttribute('aria-label', `Удалить слово ${word.en}`);
          actions.append(edit, remove); row.append(actions);
        }
        // Removal remains available in the focused word panel, reducing competing row actions.
        const oldRemove = row.querySelector('.remove-membership');
        if (oldRemove) oldRemove.hidden = true;
        let select = row.querySelector('.library-word-select');
        if (selecting && !select) {
          select = element('label', 'library-word-select');
          const input = element('input'); input.type = 'checkbox'; input.value = id;
          input.setAttribute('aria-label', `Выбрать слово ${word.en}`);
          input.addEventListener('change', () => {
            if(input.checked) selected.add(id); else selected.delete(id);
            row.classList.toggle('is-selected', input.checked); updateSelection();
          });
          select.append(input); row.prepend(select);
        }
        if (select) {
          select.hidden = !selecting;
          select.querySelector('input').checked = selected.has(id);
        }
        row.classList.toggle('is-selected', selecting && selected.has(id));
        if (inlineDraft?.key === word.key && !row.querySelector('.word-row-editor')) renderInlineEdit(row, word);
      }
    }
    function clearDeleteUndo() { lastDeleted = null; undoBar.hidden = true; }
    window.addEventListener('wordflow:datachange', clearDeleteUndo);
    function deleteWordNow(id) {
      const word = wordById(id);
      if (!word || adapter.isBusy?.()) return false;
      const before = adapter.snapshot();
      try {
        if (!commit(global.WordflowModel.deleteWord(before, id))) return false;
        selected.clear(); updateSelection(); decorateRows(); closeOverlay();
        lastDeleted = {document:before,key:word.key,en:word.en};
        undoLabel.textContent = `Удалено: ${word.en}`; undoBar.hidden = false;
        if (inlineDraft?.key === word.key) closeInlineEdit();
        return true;
      } catch (failure) { adapter.notify(failure.message || 'Не удалось удалить слово.'); return false; }
    }
    function closeInlineEdit() {
      inlineDraft = null;
      wordList.querySelectorAll('.word-row-editor').forEach(form => form.remove());
      wordList.querySelectorAll('.is-editing').forEach(row => row.classList.remove('is-editing'));
    }
    function openInlineEdit(key) {
      const word = words().find(item => item.key === key);
      if (!word || adapter.isBusy?.()) return;
      closeInlineEdit(); adapter.stopSpeech?.();
      inlineDraft = {key,en:word.en,ru:word.ru};
      const row = wordList.querySelector(`[data-word-id="${word.id}"]`);
      if (row) { renderInlineEdit(row, word); row.querySelector('input').focus({preventScroll:true}); }
    }
    function renderInlineEdit(row, word) {
      row.classList.add('is-editing');
      const form = element('form', 'word-row-editor');
      const enLabel = element('label', '', 'Английское слово'), ruLabel = element('label', '', 'Перевод');
      const en = element('input'), ru = element('input');
      en.value = inlineDraft.en; en.lang = 'en'; en.maxLength = 80; en.autocomplete = 'off'; en.spellcheck = false; en.required = true;
      ru.value = inlineDraft.ru; ru.maxLength = 120; ru.required = true;
      en.name = 'en'; ru.name = 'ru'; enLabel.append(en); ruLabel.append(ru);
      const warning = element('p', 'word-edit-warning', 'Новое английское написание вернёт это слово на изучение. Прогресс остальных слов сохранится.');
      const issue = element('p', 'word-row-error'); issue.setAttribute('role', 'alert'); issue.hidden = true;
      const issueId = `word-row-error-${word.id}`, warningId = `word-row-warning-${word.id}`;
      issue.id = issueId; warning.id = warningId;
      en.setAttribute('aria-describedby', `${warningId} ${issueId}`); ru.setAttribute('aria-describedby', issueId);
      const changed = () => {
        inlineDraft.en = en.value; inlineDraft.ru = ru.value;
        warning.hidden = en.value.trim().toLowerCase() === word.en.toLowerCase(); issue.hidden = true;
      };
      en.addEventListener('input', changed); ru.addEventListener('input', changed); changed();
      const actions = element('div', 'word-row-editor-actions');
      const save = button('Сохранить', 'secondary-action'); save.type = 'submit';
      const cancel = button('Отмена', 'text-action', () => { closeInlineEdit(); row.querySelector('.word-row-edit')?.focus({preventScroll:true}); });
      actions.append(save, cancel); form.append(enLabel, ruLabel, warning, issue, actions);
      form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); cancel.click(); } });
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          const current = words().find(item => item.key === word.key);
          if (!current) return;
          const result = global.WordflowModel.editWord(adapter.snapshot(), current.id, {en:en.value.trim().replace(/\s+/g,' '),ru:ru.value.trim().replace(/\s+/g,' ')}, adapter.transcriptionFor);
          if (!commit(result.document)) { issue.textContent = 'Не удалось сохранить изменения. Попробуйте ещё раз.'; issue.hidden = false; return; }
          closeInlineEdit(); adapter.notify('Изменения сохранены.');
          const updated = words().find(item => item.key === word.key);
          wordList.querySelector(`[data-word-id="${updated?.id}"] .word-row-edit`)?.focus({preventScroll:true});
        } catch (failure) { issue.textContent = failure.message || 'Проверьте слово и перевод.'; issue.hidden = false; }
      });
      row.append(form);
    }
    function refresh() {
      const validIds = new Set(words().map(word => word.id));
      for (const id of selected) if (!validIds.has(id)) selected.delete(id);
      updateNavigation();
      if (mode === 'overview') renderOverview();
      updateSelection(); decorateRows();
      if (mode === 'collection') {
        const doc = adapter.snapshot(), id = collectionId(), session = sessionFor(doc, id);
        const total = id === 'all' ? words().length : doc.collections.items.find(item => item.id === id)?.wordIds.length || 0;
        const study = document.getElementById('study-collection');
        study.textContent = total && session?.learned.length === total ? 'Пройти заново' : session?.attempts ? 'Продолжить' : 'Учить словарь';
      }
    }
    function openOverview() {
      if (!adapter.snapshot().collections.items.length) return openCollection('all');
      if (adapter.isBusy?.() && library.hidden) return false;
      closeOverlay(false); selecting = false; selected.clear(); mode = 'overview';
      if (editor) editor.hidden = true;
      adapter.showLibrary(true); refresh(); title.focus({preventScroll: true});
      return true;
    }
    function openCollection(id) {
      if (adapter.isBusy?.()) return false;
      closeOverlay(false); selecting = false; selected.clear(); mode = 'collection';
      adapter.selectCollection(id); adapter.showLibrary(true); refresh();
      title.focus({preventScroll: true}); return true;
    }
    function showDialog(label, source) {
      setError(''); dialogTitle.textContent = label;
      if (!dialog.open) {
        trigger = source || document.activeElement;
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        adapter.stopSpeech?.(); adapter.setOverlayOpen(true);
        dialog.showModal();
      }
      dialog.scrollTop = 0;
      dialogTitle.focus({preventScroll: true});
    }
    function closeOverlay(restoreFocus = true) {
      if (!dialog.open) return false;
      const returnWordId = currentWordId;
      const triggerLabel = trigger?.getAttribute('aria-label');
      adapter.stopSpeech?.(); dialog.close(); adapter.setOverlayOpen(false);
      document.body.style.overflow = savedOverflow;
      currentWordId = null; dialogContent.replaceChildren(); setError('');
      if (restoreFocus) {
        const replacementRow = returnWordId === null ? null : wordList.querySelector(`[data-word-id="${returnWordId}"] .word-details-button`);
        const replacementProfile = triggerLabel ? [...document.querySelectorAll('#profile-difficult-words button')].find(node => node.getAttribute('aria-label') === triggerLabel) : null;
        const target = trigger?.isConnected ? trigger : !library.hidden ? replacementRow || wordList.querySelector('.word-details-button') || title : replacementProfile || document.getElementById('profile-heading');
        if (target && !target.closest('[hidden]')) target.focus({preventScroll: true});
      }
      trigger = null; return true;
    }
    function back() {
      if (closeOverlay()) return true;
      if (mode === 'collection' && !library.hidden && adapter.snapshot().collections.items.length) { openOverview(); return true; }
      return false;
    }
    function openWord(id, source) {
      if (adapter.isBusy?.() || !wordById(id)) return false;
      currentWordId = id; previousDialogMode = 'word';
      showDialog('Слово', source); renderWord(); return true;
    }
    function renderWord() {
      const word = wordById(currentWordId);
      if (!word) { closeOverlay(); return; }
      previousDialogMode = 'word'; setError(''); dialogTitle.textContent = 'Слово';
      const intro = element('div', 'word-panel-intro');
      const name = element('p', 'word-panel-word', word.en); name.lang = 'en';
      const translation = element('p', 'word-panel-translation', word.ru);
      const pronunciation = element('p', 'word-panel-ipa', word.ipa || ''); pronunciation.hidden = !word.ipa;
      const sound = button('Послушать', 'secondary-action', () => adapter.speakWord(word.id, sound));
      sound.id = 'panel-speak-word'; sound.prepend(icon('sound'));
      intro.append(name, pronunciation, translation, sound);
      const status = element('p', 'word-panel-status', `${collectionName(collectionId())}: ${statusLabels[statusFor(word.id, collectionId())] || 'Впереди'}`);
      const actions = element('div', 'word-panel-actions');
      const add = button('Добавить в словари', 'primary-action', () => openCollections([word.id]));
      add.id = 'panel-add-collections';
      const repeat = button('Повторить', 'secondary-action', () => {
        try {
          const doc = global.WordflowModel.repeatWord(adapter.snapshot(), word.id, collectionId());
          if (commit(doc)) { renderWord(); adapter.notify('Слово в начале очереди этого словаря.'); }
        } catch (failure) { reportError(failure); }
      });
      repeat.id = 'panel-repeat-word'; actions.append(add, repeat);
      const own = word.id >= adapter.snapshot().builtinWords.length;
      if (own) {
        const edit = button('Изменить', 'secondary-action', () => renderEdit()); edit.id = 'panel-edit-word';
        actions.append(edit);
      }
      const more = element('div', 'word-panel-secondary');
      if (collectionId() !== 'all') {
        const remove = button('Убрать из этого словаря', 'text-action', () => removeMembership(word.id));
        remove.id = 'panel-remove-membership'; more.append(remove);
      }
      if (own) {
        const remove = button('Удалить слово', 'text-action word-panel-danger', () => renderDelete());
        remove.id = 'panel-delete-word'; more.append(remove);
      }
      dialogContent.replaceChildren(intro, status, actions, more);
    }
    function renderEdit() {
      const word = wordById(currentWordId);
      if (!word) return;
      adapter.stopSpeech?.(); previousDialogMode = 'edit'; setError(''); dialogTitle.textContent = 'Изменить слово';
      const form = element('form', 'word-edit-form'); form.id = 'word-edit-form';
      const enLabel = element('label', '', 'Английское слово');
      const en = element('input'); en.id = 'edit-word-en'; en.name = 'en'; en.lang = 'en'; en.maxLength = 80; en.required = true;
      en.autocomplete = 'off'; en.spellcheck = false; en.value = word.en; en.setAttribute('aria-describedby', 'word-edit-warning word-panel-error');
      enLabel.append(en);
      const ruLabel = element('label', '', 'Перевод');
      const ru = element('input'); ru.id = 'edit-word-ru'; ru.name = 'ru'; ru.maxLength = 120; ru.required = true; ru.value = word.ru;
      ru.setAttribute('aria-describedby', 'word-panel-error'); ruLabel.append(ru);
      const warning = element('p', 'word-edit-warning', 'Изменение английского слова вернёт его на изучение во всех словарях. Прогресс остальных слов сохранится.');
      warning.id = 'word-edit-warning'; warning.hidden = true;
      en.addEventListener('input', () => { warning.hidden = en.value.trim().toLocaleLowerCase('en') === word.en.toLocaleLowerCase('en'); });
      const actions = element('div', 'word-panel-actions');
      const save = button('Сохранить изменения', 'primary-action'); save.type = 'submit'; save.id = 'save-word-edit';
      actions.append(save, button('Отмена', 'secondary-action', () => { renderWord(); dialogTitle.focus({preventScroll: true}); }));
      form.append(enLabel, ruLabel, warning, actions);
      form.addEventListener('submit', event => {
        event.preventDefault(); setError('');
        if (!en.value.trim() || !ru.value.trim()) { setError('Заполните английское слово и перевод.'); return; }
        try {
          const result = global.WordflowModel.editWord(adapter.snapshot(), word.id, {en: en.value, ru: ru.value}, adapter.transcriptionFor);
          if (commit(result.document)) { renderWord(); dialogTitle.focus({preventScroll: true}); adapter.notify('Изменения слова сохранены.'); }
        } catch (failure) { reportError(failure); }
      });
      dialogContent.replaceChildren(form); en.focus();
    }
    function renderDelete() {
      const word = wordById(currentWordId);
      if (!word) return;
      adapter.stopSpeech?.(); previousDialogMode = 'delete'; setError(''); dialogTitle.textContent = 'Удалить слово?';
      const text = element('p', 'word-delete-copy', `«${word.en}» исчезнет из общего словаря и всех подборок. Другие слова и история занятий сохранятся.`);
      const actions = element('div', 'word-panel-actions');
      const remove = button('Удалить слово', 'word-delete-confirm', () => deleteWordNow(word.id));
      remove.id = 'confirm-delete-word';
      const cancel = button('Отмена', 'secondary-action', () => { renderWord(); dialogTitle.focus({preventScroll: true}); });
      actions.append(cancel, remove); dialogContent.replaceChildren(text, actions); cancel.focus();
    }
    function removeMembership(id) {
      const deckId = collectionId(), doc = adapter.snapshot();
      const deck = doc.collections.items.find(item => item.id === deckId);
      if (!deck) return;
      const session = doc.collections.sessions[deckId];
      const nextSession = {...session};
      for (const key of ['queue', 'learned', 'difficult', 'hinted']) nextSession[key] = (session[key] || []).filter(value => value !== id);
      const next = {...doc, collections: {...doc.collections,
        items: doc.collections.items.map(item => item.id === deckId ? {...item, wordIds: item.wordIds.filter(value => value !== id)} : item),
        sessions: {...doc.collections.sessions, [deckId]: nextSession}}};
      if (commit(next)) { closeOverlay(); adapter.notify('Слово убрано из этого словаря. В общем словаре оно осталось.'); }
    }
    function openCollections(ids, source) {
      if (adapter.isBusy?.()) return;
      adapter.stopSpeech?.();
      const fromWord = dialog.open && previousDialogMode === 'word';
      showDialog(ids.length === 1 ? 'Добавить в словари' : `Добавить слова (${ids.length})`, source);
      previousDialogMode = 'collections';
      const doc = adapter.snapshot();
      const decks = doc.collections.items;
      const content = element('div', 'word-collection-picker');
      const picked = new Set();
      const pickerList = element('ul', 'word-collection-options'); pickerList.id = 'word-collection-options';
      const pickerSearchLabel = element('label', 'search');
      const pickerSearch = element('input'); pickerSearch.type = 'search'; pickerSearch.placeholder = 'Найти личный словарь'; pickerSearch.autocomplete = 'off';
      pickerSearchLabel.append(element('span', 'sr-only', 'Поиск личного словаря'), icon('search'), pickerSearch);
      const emptyPicker = element('p', 'word-panel-note'); emptyPicker.hidden = true;
      const actions = element('div', 'word-panel-actions');
      const save = button('Сохранить', 'primary-action', () => {
        if (!picked.size) return;
        try {
          const next = global.WordflowModel.addWordsToCollections(adapter.snapshot(), ids, [...picked]);
          if (commit(next)) {
            adapter.notify(ids.length === 1 ? 'Слово добавлено в выбранные словари.' : 'Выбранные слова добавлены в словари.');
            if (fromWord && wordById(currentWordId)) { renderWord(); dialogTitle.focus({preventScroll: true}); }
            else closeOverlay();
          }
        } catch (failure) { reportError(failure); }
      });
      save.id = 'save-word-collections'; save.disabled = true;
      const cancel = button('Отмена', 'secondary-action', () => {
        if (fromWord) { renderWord(); dialogTitle.focus({preventScroll: true}); } else closeOverlay();
      });
      actions.append(save, cancel);
      function renderOptions() {
        const query = pickerSearch.value.trim().toLocaleLowerCase('ru');
        const visible = decks.filter(deck => deck.name.toLocaleLowerCase('ru').includes(query));
        pickerList.replaceChildren(...visible.map(deck => {
          const row = element('li'), label = element('label');
          const input = element('input'); input.type = 'checkbox'; input.value = deck.id;
          const present = ids.filter(id => deck.wordIds.includes(id)).length;
          const included = present === ids.length;
          input.checked = included || picked.has(deck.id); input.disabled = included;
          input.addEventListener('change', () => {
            if(input.checked) picked.add(deck.id); else picked.delete(deck.id);
            save.disabled = !picked.size;
          });
          const text = element('span'), name = element('strong', '', deck.name);
          text.append(name, element('small', '', included ? 'Уже добавлено' : present ? `Уже есть: ${present} из ${ids.length}` : `Слов: ${deck.wordIds.length}`));
          label.append(input, text); row.append(label); return row;
        }));
        emptyPicker.hidden = visible.length > 0;
        emptyPicker.textContent = decks.length ? 'Словарей с таким названием нет.' : 'Личных словарей пока нет. Создайте словарь в библиотеке и добавьте в него слова.';
      }
      pickerSearch.addEventListener('input', renderOptions);
      if (decks.length > 5) content.append(pickerSearchLabel);
      content.append(pickerList, emptyPicker, actions); dialogContent.replaceChildren(content); renderOptions();
      dialogTitle.focus({preventScroll: true});
    }

    search.addEventListener('input', renderOverview);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeOverlay(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeOverlay();
    }});
    updateNavigation(); updateSelection();
    const controller = {openOverview, openCollection, openWord, refresh, decorateRows, closeOverlay,
      hasOverlay: () => dialog.open, back, isOverview: () => mode === 'overview'};
    library.wordflowLibraryController = controller;
    refresh(); return Object.freeze(controller);
  }
  global.WordflowLibrary = Object.freeze({mount});
})(window);
