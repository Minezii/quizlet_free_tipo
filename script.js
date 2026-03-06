const AppState = {
  currentListId: null,
  currentListTitle: '',
  studyWords: [],
  studyIndex: 0,
  studyMode: null,
  sessionCorrect: 0,
  sessionWrong: 0,
  isFlipped: false,
  isRandom10: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await initDB();

  const shared = getShareHashData();
  if (shared) {
    history.replaceState(null, '', window.location.pathname);
    showPage('home');
    await renderHome();
    setTimeout(() => openImportFromShareData(shared), 400);
    return;
  }

  showPage('home');
  await renderHome();
});

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  syncBottomNav(pageId);
}

function syncBottomNav(pageId) {
  const nav = document.getElementById('bottom-nav');
  const fab = document.getElementById('theme-btn');
  const studyPages = ['flashcards', 'type-test', 'multi-choice'];
  const hide = studyPages.includes(pageId);
  if (nav) nav.classList.toggle('hidden-nav', hide);
  if (fab) fab.style.display = hide ? 'none' : '';

  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  if (pageId === 'home')     document.getElementById('bnav-home')?.classList.add('active');
  if (pageId === 'progress') document.getElementById('bnav-progress')?.classList.add('active');
}

function bottomNavTo(page) {
  if (page === 'home') { showPage('home'); renderHome(); }
  if (page === 'progress') renderProgress();
}

async function renderHome() {
  const lists = await getWordLists();
  const container = document.getElementById('lists-container');

  if (lists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>У вас ещё нет списков слов</p>
        <p class="empty-sub">Создайте первый список и начните учиться!</p>
      </div>`;
    return;
  }

  const listsWithCounts = await Promise.all(
    lists.map(async (list) => {
      const words = await getWordsByListId(list.id);
      return { ...list, wordCount: words.length };
    })
  );

  container.innerHTML = listsWithCounts
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(list => `
      <div class="list-card" onclick="openList(${list.id})">
        <div class="list-card-body">
          <h3 class="list-title">${escapeHtml(list.title)}</h3>
          <span class="word-count">${list.wordCount} ${pluralWords(list.wordCount)}</span>
        </div>
        <div class="list-card-actions">
          <button class="btn-icon" onclick="event.stopPropagation(); showExportModal(${list.id})" title="Экспорт JSON">📤</button>
          <button class="btn-icon btn-edit" onclick="event.stopPropagation(); editListTitle(${list.id}, '${escapeHtml(list.title)}')" title="Переименовать">✏️</button>
          <button class="btn-icon btn-delete" onclick="event.stopPropagation(); confirmDeleteList(${list.id}, '${escapeHtml(list.title)}')" title="Удалить">🗑️</button>
        </div>
      </div>
    `).join('');
}

async function createList() {
  const input = document.getElementById('new-list-input');
  const title = input.value.trim();
  if (!title) { shakeInput(input); return; }
  await createWordList(title);
  input.value = '';
  await renderHome();
  showToast('Список создан!');
}

async function confirmDeleteList(id, title) {
  showConfirm(`Удалить список «${title}»?<br><small>Все слова и прогресс будут удалены</small>`, async () => {
    await deleteWordList(id);
    await renderHome();
    showToast('Список удалён');
  });
}

async function editListTitle(id, currentTitle) {
  showPromptModal('Переименовать список', currentTitle, async (newTitle) => {
    if (newTitle && newTitle.trim()) {
      await updateWordList(id, newTitle.trim());
      await renderHome();
      showToast('Название обновлено');
    }
  });
}

async function openList(listId) {
  AppState.currentListId = listId;
  const list = await getWordList(listId);
  AppState.currentListTitle = list.title;
  document.getElementById('list-detail-title').textContent = list.title;
  showPage('list-detail');
  await renderListDetail();
}

async function renderListDetail() {
  const searchVal = (document.getElementById('word-search')?.value || '').toLowerCase();
  const words = await getWordsByListId(AppState.currentListId);

  const filtered = searchVal
    ? words.filter(w =>
        w.english.toLowerCase().includes(searchVal) ||
        w.russian.toLowerCase().includes(searchVal))
    : words;

  const tbody = document.getElementById('words-table-body');
  document.getElementById('words-count').textContent = `${words.length} ${pluralWords(words.length)}`;

  if (words.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="3" class="table-empty">
        <div class="empty-state small">
          <div class="empty-icon">📝</div>
          <p>Добавьте первое слово в список</p>
        </div>
      </td></tr>`;
    updateStudyButtons(0);
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Ничего не найдено</td></tr>`;
    return;
  }

  const progressData = await Promise.all(filtered.map(w => getProgress(w.id)));
  const progressMap = {};
  progressData.forEach(p => { progressMap[p.word_id] = p; });

  tbody.innerHTML = filtered.map(word => {
    const p = progressMap[word.id] || { correct: 0, wrong: 0 };
    const total = p.correct + p.wrong;
    const pct = total > 0 ? Math.round((p.correct / total) * 100) : null;
    const badgeHtml = pct !== null
      ? `<span class="progress-badge ${pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad'}">${pct}%</span>`
      : '';
    return `
      <tr class="word-row">
        <td class="word-en">${escapeHtml(word.english)}</td>
        <td class="word-ru"><span class="word-ru-inner">${escapeHtml(word.russian)} ${badgeHtml}</span></td>
        <td class="word-actions">
          <button class="btn-icon" onclick="editWord(${word.id}, '${escapeHtml(word.english)}', '${escapeHtml(word.russian)}')" title="Редактировать">✏️</button>
          <button class="btn-icon btn-delete" onclick="confirmDeleteWord(${word.id}, '${escapeHtml(word.english)}')" title="Удалить">🗑️</button>
        </td>
      </tr>`;
  }).join('');

  updateStudyButtons(words.length);
}

function updateStudyButtons(count) {
  const studyBtn = document.getElementById('btn-study');
  const random10Btn = document.getElementById('btn-random10');
  if (studyBtn) studyBtn.disabled = count < 1;
  if (random10Btn) random10Btn.disabled = count < 1;
}

async function addWordToList() {
  const enInput = document.getElementById('word-en-input');
  const ruInput = document.getElementById('word-ru-input');
  const en = enInput.value.trim();
  const ru = ruInput.value.trim();
  if (!en) { shakeInput(enInput); return; }
  if (!ru) { shakeInput(ruInput); return; }
  await addWord(AppState.currentListId, en, ru);
  enInput.value = '';
  ruInput.value = '';
  enInput.focus();
  await renderListDetail();
  showToast('Слово добавлено!');
}

async function editWord(id, currentEn, currentRu) {
  showEditWordModal(currentEn, currentRu, async (newEn, newRu) => {
    if (newEn && newRu) {
      await updateWord(id, newEn, newRu);
      await renderListDetail();
      showToast('Слово обновлено');
    }
  });
}

async function confirmDeleteWord(id, english) {
  showConfirm(`Удалить слово «${english}»?`, async () => {
    await deleteWord(id);
    await renderListDetail();
    showToast('Слово удалено');
  });
}

let searchTimeout;
function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderListDetail(), 200);
}

async function openStudySelect(isRandom10 = false) {
  AppState.isRandom10 = isRandom10;
  let words = await getWordsByListId(AppState.currentListId);

  if (words.length === 0) {
    showToast('Добавьте слова в список!', 'error');
    return;
  }

  if (isRandom10) {
    words = shuffle([...words]).slice(0, 10);
  }

  AppState.studyWords = words;
  document.getElementById('study-select-title').textContent = AppState.currentListTitle;
  document.getElementById('study-select-count').textContent =
    `${words.length} ${pluralWords(words.length)}`;
  showPage('study-select');
}

async function startFlashcards() {
  AppState.studyMode = 'flashcards';
  AppState.sessionCorrect = 0;
  AppState.sessionWrong = 0;

  const wordsWithProgress = await Promise.all(
    AppState.studyWords.map(async (w) => {
      const p = await getProgress(w.id);
      return { ...w, correct: p.correct, wrong: p.wrong };
    })
  );

  AppState.studyWords = buildTrainingList(wordsWithProgress);
  AppState.studyIndex = 0;

  showPage('flashcards');
  renderFlashcard();
}

function buildTrainingList(words) {
  const list = [];
  words.forEach(word => {
    let weight = 1 + Math.max(0, word.wrong - word.correct);
    weight = Math.min(weight, 4);
    for (let i = 0; i < weight; i++) list.push({ ...word });
  });
  return shuffle(list);
}

function renderFlashcard() {
  const total = AppState.studyWords.length;
  const idx = AppState.studyIndex;
  AppState.isFlipped = false;

  if (idx >= total) {
    showSessionResult('flashcards');
    return;
  }

  const word = AppState.studyWords[idx];
  document.getElementById('fc-progress-text').textContent = `${idx + 1} / ${total}`;
  document.getElementById('fc-progress-bar').style.width = `${((idx + 1) / total) * 100}%`;
  document.getElementById('fc-front-text').textContent = word.english;
  document.getElementById('fc-back-text').textContent = word.russian;
  document.getElementById('fc-front-sub').textContent = 'нажмите чтобы перевернуть';

  const card = document.getElementById('flashcard');
  card.classList.remove('flipped');
  document.getElementById('fc-buttons').classList.add('hidden');

  card.classList.remove('card-enter');
  void card.offsetWidth;
  card.classList.add('card-enter');
}

function flipCard() {
  if (AppState.isFlipped) return;
  AppState.isFlipped = true;
  const card = document.getElementById('flashcard');
  card.classList.add('flipped');
  document.getElementById('fc-buttons').classList.remove('hidden');
}

async function fcAnswer(knew) {
  const word = AppState.studyWords[AppState.studyIndex];
  const p = await getProgress(word.id);
  if (knew) {
    AppState.sessionCorrect++;
    await updateProgress(word.id, p.correct + 1, p.wrong);
  } else {
    AppState.sessionWrong++;
    await updateProgress(word.id, p.correct, p.wrong + 1);
  }

  const card = document.getElementById('flashcard');
  card.classList.add(knew ? 'card-exit-right' : 'card-exit-left');

  setTimeout(() => {
    card.classList.remove('card-exit-right', 'card-exit-left');
    AppState.studyIndex++;
    renderFlashcard();
  }, 350);
}

async function startTypeTest() {
  AppState.studyMode = 'type-test';
  AppState.sessionCorrect = 0;
  AppState.sessionWrong = 0;
  AppState.studyWords = shuffle([...AppState.studyWords]);
  AppState.studyIndex = 0;
  showPage('type-test');
  renderTypeTest();
}

function renderTypeTest() {
  const total = AppState.studyWords.length;
  const idx = AppState.studyIndex;

  if (idx >= total) {
    showSessionResult('type-test');
    return;
  }

  const word = AppState.studyWords[idx];
  document.getElementById('tt-progress-text').textContent = `${idx + 1} / ${total}`;
  document.getElementById('tt-progress-bar').style.width = `${((idx + 1) / total) * 100}%`;
  document.getElementById('tt-question').textContent = word.russian;
  document.getElementById('tt-input').value = '';
  document.getElementById('tt-feedback').innerHTML = '';
  document.getElementById('tt-feedback').className = 'tt-feedback';
  document.getElementById('tt-btn-check').style.display = 'inline-flex';
  document.getElementById('tt-btn-next').style.display = 'none';

  const card = document.getElementById('tt-card');
  card.classList.remove('card-enter');
  void card.offsetWidth;
  card.classList.add('card-enter');

  setTimeout(() => document.getElementById('tt-input').focus(), 100);
}

async function checkTypeAnswer() {
  const input = document.getElementById('tt-input');
  const answer = input.value.trim().toLowerCase();
  if (!answer) { shakeInput(input); return; }

  const word = AppState.studyWords[AppState.studyIndex];
  const correct = word.english.toLowerCase();
  const isCorrect = answer === correct || normalizeAnswer(answer) === normalizeAnswer(correct);

  const feedback = document.getElementById('tt-feedback');
  const p = await getProgress(word.id);

  if (isCorrect) {
    AppState.sessionCorrect++;
    await updateProgress(word.id, p.correct + 1, p.wrong);
    feedback.innerHTML = `<span class="correct-icon">✓</span> Верно!`;
    feedback.className = 'tt-feedback correct';
  } else {
    AppState.sessionWrong++;
    await updateProgress(word.id, p.correct, p.wrong + 1);
    feedback.innerHTML = `<span class="wrong-icon">✗</span> Неверно. Правильно: <strong>${escapeHtml(word.english)}</strong>`;
    feedback.className = 'tt-feedback wrong';
  }

  input.disabled = true;
  document.getElementById('tt-btn-check').style.display = 'none';
  document.getElementById('tt-btn-next').style.display = 'inline-flex';
}

function ttNextWord() {
  document.getElementById('tt-input').disabled = false;
  AppState.studyIndex++;
  renderTypeTest();
}

document.addEventListener('keydown', (e) => {
  const page = document.querySelector('.page.active');
  if (!page) return;
  const pageId = page.id;

  if (pageId === 'page-type-test' && e.key === 'Enter') {
    const nextBtn = document.getElementById('tt-btn-next');
    if (nextBtn.style.display !== 'none') {
      ttNextWord();
    } else {
      checkTypeAnswer();
    }
  }

  if (pageId === 'page-flashcards') {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!AppState.isFlipped) flipCard();
    }
    if (e.key === 'ArrowRight' || e.key === '1') {
      if (AppState.isFlipped) fcAnswer(true);
    }
    if (e.key === 'ArrowLeft' || e.key === '2') {
      if (AppState.isFlipped) fcAnswer(false);
    }
  }
});

function normalizeAnswer(str) {
  return str.replace(/[.,!?;:'"()\-]/g, '').trim();
}

async function startMultiChoice() {
  AppState.studyMode = 'multi-choice';
  AppState.sessionCorrect = 0;
  AppState.sessionWrong = 0;
  AppState.studyWords = shuffle([...AppState.studyWords]);
  AppState.studyIndex = 0;

  const allWords = await getWordsByListId(AppState.currentListId);
  AppState.allWordsForDistractors = allWords;

  showPage('multi-choice');
  renderMultiChoice();
}

function renderMultiChoice() {
  const total = AppState.studyWords.length;
  const idx = AppState.studyIndex;

  if (idx >= total) {
    showSessionResult('multi-choice');
    return;
  }

  const word = AppState.studyWords[idx];
  document.getElementById('mc-progress-text').textContent = `${idx + 1} / ${total}`;
  document.getElementById('mc-progress-bar').style.width = `${((idx + 1) / total) * 100}%`;
  document.getElementById('mc-question').textContent = word.russian;

  const options = generateOptions(word, AppState.allWordsForDistractors);

  const optionsContainer = document.getElementById('mc-options');
  optionsContainer.innerHTML = options.map(opt => `
    <button class="mc-option" onclick="checkMcAnswer(this, '${escapeHtml(opt)}', '${escapeHtml(word.english)}', ${word.id})">
      ${escapeHtml(opt)}
    </button>
  `).join('');

  const card = document.getElementById('mc-card');
  card.classList.remove('card-enter');
  void card.offsetWidth;
  card.classList.add('card-enter');
}

function generateOptions(correctWord, allWords) {
  const correct = correctWord.english;
  const others = allWords
    .filter(w => w.english !== correct)
    .map(w => w.english);

  const distractors = shuffle(others).slice(0, 3);
  while (distractors.length < 3) {
    distractors.push(`option${distractors.length + 1}`);
  }
  return shuffle([correct, ...distractors]);
}

async function checkMcAnswer(btn, selected, correct, wordId) {
  document.querySelectorAll('.mc-option').forEach(b => b.disabled = true);

  const isCorrect = selected.toLowerCase() === correct.toLowerCase();
  const p = await getProgress(wordId);

  if (isCorrect) {
    AppState.sessionCorrect++;
    btn.classList.add('correct');
    await updateProgress(wordId, p.correct + 1, p.wrong);
  } else {
    AppState.sessionWrong++;
    btn.classList.add('wrong');
    document.querySelectorAll('.mc-option').forEach(b => {
      if (b.textContent.trim() === correct) b.classList.add('correct');
    });
    await updateProgress(wordId, p.correct, p.wrong + 1);
  }

  setTimeout(() => {
    AppState.studyIndex++;
    renderMultiChoice();
  }, 900);
}

function showSessionResult(mode) {
  const total = AppState.sessionCorrect + AppState.sessionWrong;
  const pct = total > 0 ? Math.round((AppState.sessionCorrect / total) * 100) : 0;

  document.getElementById('result-correct').textContent = AppState.sessionCorrect;
  document.getElementById('result-wrong').textContent = AppState.sessionWrong;
  document.getElementById('result-pct').textContent = `${pct}%`;

  const emoji = pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪';
  document.getElementById('result-emoji').textContent = emoji;

  const msg = pct >= 80
    ? 'Отличный результат!'
    : pct >= 50
    ? 'Хороший результат!'
    : 'Продолжайте практиковаться!';
  document.getElementById('result-msg').textContent = msg;

  const circle = document.getElementById('result-circle');
  const circumference = 2 * Math.PI * 54;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = circumference;
  setTimeout(() => {
    circle.style.strokeDashoffset = circumference * (1 - pct / 100);
  }, 100);

  showPage('result');
}

async function renderProgress() {
  showPage('progress');

  const allWords = await getAllWords();
  const allProgress = await getAllProgress();
  const allLists = await getWordLists();

  const progressMap = {};
  allProgress.forEach(p => { progressMap[p.word_id] = p; });

  let totalCorrect = 0, totalWrong = 0, studied = 0;
  allWords.forEach(w => {
    const p = progressMap[w.id];
    if (p) {
      totalCorrect += p.correct;
      totalWrong += p.wrong;
      if (p.correct + p.wrong > 0) studied++;
    }
  });

  const total = totalCorrect + totalWrong;
  const pct = total > 0 ? Math.round((totalCorrect / total) * 100) : 0;

  document.getElementById('prog-total-words').textContent = allWords.length;
  document.getElementById('prog-studied').textContent = studied;
  document.getElementById('prog-correct').textContent = totalCorrect;
  document.getElementById('prog-wrong').textContent = totalWrong;
  document.getElementById('prog-pct').textContent = `${pct}%`;

  document.getElementById('prog-bar-fill').style.width = `${pct}%`;

  const hardWords = allWords
    .map(w => ({ ...w, prog: progressMap[w.id] || { correct: 0, wrong: 0 } }))
    .filter(w => w.prog.wrong > w.prog.correct && w.prog.wrong > 0)
    .sort((a, b) => (b.prog.wrong - b.prog.correct) - (a.prog.wrong - a.prog.correct))
    .slice(0, 20);

  const hardContainer = document.getElementById('hard-words-list');
  if (hardWords.length === 0) {
    hardContainer.innerHTML = `<p class="no-hard">🎊 Нет сложных слов! Так держать!</p>`;
    document.getElementById('btn-repeat-hard').disabled = true;
  } else {
    hardContainer.innerHTML = hardWords.map(w => `
      <div class="hard-word-item">
        <span class="hard-en">${escapeHtml(w.english)}</span>
        <span class="hard-ru">${escapeHtml(w.russian)}</span>
        <span class="hard-stats">✓${w.prog.correct} ✗${w.prog.wrong}</span>
      </div>
    `).join('');
    document.getElementById('btn-repeat-hard').disabled = false;
    document.getElementById('btn-repeat-hard').onclick = () => repeatHardWords(hardWords);
  }

  const listsContainer = document.getElementById('prog-lists-stats');
  const listsHtml = await Promise.all(allLists.map(async list => {
    const words = await getWordsByListId(list.id);
    let c = 0, w = 0;
    words.forEach(word => {
      const p = progressMap[word.id];
      if (p) { c += p.correct; w += p.wrong; }
    });
    const t = c + w;
    const lPct = t > 0 ? Math.round((c / t) * 100) : 0;
    return `
      <div class="list-stat-card">
        <span class="list-stat-name">${escapeHtml(list.title)}</span>
        <span class="list-stat-words">${words.length} сл.</span>
        <div class="list-stat-bar">
          <div class="list-stat-fill" style="width:${lPct}%"></div>
        </div>
        <span class="list-stat-pct">${lPct}%</span>
      </div>`;
  }));
  listsContainer.innerHTML = listsHtml.join('') || '<p class="empty-sub">Нет списков</p>';
}

async function repeatHardWords(hardWords) {
  if (!hardWords || hardWords.length === 0) return;

  const firstWord = hardWords[0];
  AppState.currentListId = firstWord.list_id;
  const list = await getWordList(firstWord.list_id);
  AppState.currentListTitle = list ? list.title : 'Сложные слова';

  AppState.studyWords = hardWords;
  AppState.isRandom10 = false;

  document.getElementById('study-select-title').textContent = 'Повторение ошибок';
  document.getElementById('study-select-count').textContent =
    `${hardWords.length} ${pluralWords(hardWords.length)}`;
  showPage('study-select');
}

function showConfirm(message, onConfirm) {
  document.getElementById('confirm-message').innerHTML = message;
  document.getElementById('modal-confirm').classList.add('active');
  document.getElementById('confirm-ok').onclick = () => {
    closeModal('modal-confirm');
    onConfirm();
  };
}

function showPromptModal(title, defaultValue, onConfirm) {
  document.getElementById('prompt-title').textContent = title;
  const input = document.getElementById('prompt-input');
  input.value = defaultValue;
  document.getElementById('modal-prompt').classList.add('active');
  setTimeout(() => { input.focus(); input.select(); }, 100);
  document.getElementById('prompt-ok').onclick = () => {
    closeModal('modal-prompt');
    onConfirm(input.value);
  };
}

function showEditWordModal(currentEn, currentRu, onConfirm) {
  document.getElementById('edit-en-input').value = currentEn;
  document.getElementById('edit-ru-input').value = currentRu;
  document.getElementById('modal-edit-word').classList.add('active');
  setTimeout(() => document.getElementById('edit-en-input').focus(), 100);
  document.getElementById('edit-word-ok').onclick = () => {
    const newEn = document.getElementById('edit-en-input').value.trim();
    const newRu = document.getElementById('edit-ru-input').value.trim();
    if (!newEn || !newRu) return;
    closeModal('modal-edit-word');
    onConfirm(newEn, newRu);
  };
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

let toastTimeout;
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pluralWords(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'слово';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'слова';
  return 'слов';
}

function shakeInput(input) {
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 500);
  input.focus();
}

document.addEventListener('keydown', (e) => {
  const page = document.querySelector('.page.active');
  if (!page || page.id !== 'page-list-detail') return;
  if (e.key === 'Enter') {
    const focused = document.activeElement;
    if (focused && (focused.id === 'word-en-input' || focused.id === 'word-ru-input')) {
      if (focused.id === 'word-en-input') {
        document.getElementById('word-ru-input').focus();
      } else {
        addWordToList();
      }
    }
  }
  if (e.key === 'Enter' && document.activeElement.id === 'prompt-input') {
    document.getElementById('prompt-ok').click();
  }
  if (e.key === 'Enter' && (document.activeElement.id === 'edit-en-input' || document.activeElement.id === 'edit-ru-input')) {
    document.getElementById('edit-word-ok').click();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

function openBulkImport() {
  document.getElementById('bulk-textarea').value = '';
  document.getElementById('modal-bulk').classList.add('active');
  setTimeout(() => document.getElementById('bulk-textarea').focus(), 100);
}

async function doBulkImport() {
  const text = document.getElementById('bulk-textarea').value.trim();
  if (!text) return;

  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    const parts = line.split(/[-—–|,;]/);
    if (parts.length >= 2) {
      const en = parts[0].trim();
      const ru = parts[1].trim();
      if (en && ru) {
        await addWord(AppState.currentListId, en, ru);
        count++;
      }
    }
  }

  closeModal('modal-bulk');
  await renderListDetail();
  showToast(`Добавлено ${count} ${pluralWords(count)}!`);
}

function backToList() {
  showPage('list-detail');
  renderListDetail();
}

function backToHome() {
  showPage('home');
  renderHome();
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const fab = document.getElementById('theme-btn');
  if (fab) {
    // Clear the base animation first so it won't replay on class change
    fab.style.animation = 'none';
    void fab.offsetWidth;
    fab.classList.remove('spinning');
    void fab.offsetWidth;
    fab.classList.add('spinning');
    fab.addEventListener('animationend', () => {
      fab.classList.remove('spinning');
      fab.style.animation = '';
    }, { once: true });
  }
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const isDark = theme === 'dark';
  const metaColor = isDark ? '#141210' : '#1C3D2E';

  const moon = document.getElementById('icon-moon');
  const sun  = document.getElementById('icon-sun');
  if (moon) moon.style.display = isDark ? 'none' : 'block';
  if (sun)  sun.style.display  = isDark ? 'block' : 'none';

  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = metaColor;
}

function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeSharePayload(b64) {
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

function getShareHashData() {
  const hash = window.location.hash;
  if (!hash.startsWith('#share=')) return null;
  try {
    return decodeSharePayload(hash.slice(7));
  } catch {
    return null;
  }
}

async function buildShareLink(listId) {
  const list  = await getWordList(listId);
  const words = await getWordsByListId(listId);
  const payload = {
    version: 1,
    app: 'english-trainer',
    title: list.title,
    words: words.map(w => ({ english: w.english, russian: w.russian })),
  };
  const encoded = encodeSharePayload(payload);
  const base = 'https://minezii.github.io/quizlet_free_tipo/';
  return `${base}#share=${encoded}`;
}

async function showExportModal(listId) {
  const id    = listId || AppState.currentListId;
  const list  = await getWordList(id);
  const words = await getWordsByListId(id);

  const payload = {
    version: 1,
    app: 'english-trainer',
    title: list.title,
    created_at: list.created_at,
    words: words.map(w => ({ english: w.english, russian: w.russian })),
  };
  const json = JSON.stringify(payload, null, 2);

  document.getElementById('export-title').textContent  = `📤 ${list.title}`;
  document.getElementById('export-count').textContent  = `${words.length} ${pluralWords(words.length)}`;
  document.getElementById('export-textarea').value     = json;

  const link = await buildShareLink(id);
  document.getElementById('share-link-input').value = link;

  const filename = list.title.replace(/[^a-zа-яёA-ZА-ЯЁ0-9_\- ]/gi, '_').slice(0, 60) + '.json';
  document.getElementById('export-file-name').textContent = filename;
  document.getElementById('export-file-size').textContent = `${(new Blob([json]).size / 1024).toFixed(1)} KB · ${words.length} слов`;
  document.getElementById('export-download-btn').onclick = () => exportListAsJSON(id);

  switchShareTab('link', document.querySelector('.share-tab'));
  document.getElementById('modal-export').classList.add('active');
}

function switchShareTab(name, btn) {
  document.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.share-panel').forEach(p => p.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  document.getElementById(`share-panel-${name}`)?.classList.remove('hidden');
}

async function copyShareLink() {
  const val = document.getElementById('share-link-input').value;
  try {
    await navigator.clipboard.writeText(val);
    showToast('Ссылка скопирована! 🔗');
  } catch {
    document.getElementById('share-link-input').select();
    document.execCommand('copy');
    showToast('Ссылка скопирована!');
  }
}

async function openImportFromShareData(payload) {
  const validWords = (payload.words || []).filter(w => w.english && w.russian);
  if (!validWords.length) { showToast('Ссылка не содержит слов', 'error'); return; }

  showConfirm(
    `Импортировать список «${escapeHtml(payload.title)}»?<br><small>${validWords.length} ${pluralWords(validWords.length)}</small>`,
    async () => {
      const newListId = await createWordList(payload.title || 'Импортированный список');
      for (const w of validWords) await addWord(newListId, w.english, w.russian);
      await renderHome();
      showToast(`Импортировано ${validWords.length} ${pluralWords(validWords.length)}!`);
    }
  );
  const btn = document.getElementById('confirm-ok');
  btn.textContent = 'Импортировать';
  btn.className = 'btn btn-primary';
}

(function initSwipe() {
  let startX = 0, startY = 0, isDragging = false;

  document.addEventListener('touchstart', (e) => {
    const scene = e.target.closest('.flashcard-scene');
    if (!scene) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dx = e.touches[0].clientX - startX;
    const card = document.getElementById('flashcard');
    if (!card || !AppState.isFlipped) return;
    card.style.transform = `rotateY(180deg) translateX(${-dx * 0.3}px) rotate(${dx * 0.02}deg)`;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const card = document.getElementById('flashcard');

    if (card) card.style.transform = '';

    if (Math.abs(dy) > Math.abs(dx)) return;

    const page = document.querySelector('.page.active');
    if (!page || page.id !== 'page-flashcards') return;

    if (Math.abs(dx) < 60) {
      if (!AppState.isFlipped) flipCard();
      return;
    }

    if (!AppState.isFlipped) return;
    if (dx > 60)  fcAnswer(true);
    if (dx < -60) fcAnswer(false);
  }, { passive: true });
})();

async function exportListAsJSON(listId) {
  const list  = await getWordList(listId);
  const words = await getWordsByListId(listId);

  const payload = {
    version:    1,
    app:        'english-trainer',
    title:      list.title,
    created_at: list.created_at,
    words:      words.map(w => ({ english: w.english, russian: w.russian })),
  };

  const json     = JSON.stringify(payload, null, 2);
  const blob     = new Blob([json], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const filename = list.title.replace(/[^a-zа-яёA-ZА-ЯЁ0-9_\- ]/gi, '_').slice(0, 60) + '.json';

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Файл «${filename}» скачан`);
}

async function copyExportJSON() {
  const text = document.getElementById('export-textarea').value;
  try {
    await navigator.clipboard.writeText(text);
    showToast('JSON скопирован в буфер!');
  } catch {
    document.getElementById('export-textarea').select();
    document.execCommand('copy');
    showToast('JSON скопирован!');
  }
}

function openImportJSONModal() {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-error').textContent = '';
  document.getElementById('modal-import').classList.add('active');
  setTimeout(() => document.getElementById('import-textarea').focus(), 100);
}

function onImportFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('import-textarea').value = e.target.result;
    document.getElementById('import-error').textContent = '';
  };
  reader.readAsText(file, 'utf-8');
}

async function doImportJSON() {
  const text  = document.getElementById('import-textarea').value.trim();
  const errEl = document.getElementById('import-error');
  errEl.textContent = '';

  if (!text) {
    errEl.textContent = 'Вставьте JSON или выберите файл';
    return;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    errEl.textContent = '❌ Некорректный JSON. Проверьте формат.';
    return;
  }

  if (!payload.title || !Array.isArray(payload.words)) {
    errEl.textContent = '❌ Неверный формат. Ожидается { title, words: [{english, russian}] }';
    return;
  }

  const validWords = payload.words.filter(w => w.english && w.russian);
  if (validWords.length === 0) {
    errEl.textContent = '❌ В файле нет слов с полями english и russian';
    return;
  }

  const newTitle  = payload.title + (payload.title ? ' (импорт)' : 'Импортированный список');
  const newListId = await createWordList(newTitle);
  for (const w of validWords) {
    await addWord(newListId, w.english, w.russian);
  }

  closeModal('modal-import');
  await renderHome();
  showToast(`Импортировано ${validWords.length} ${pluralWords(validWords.length)} в «${newTitle}»`);
}
