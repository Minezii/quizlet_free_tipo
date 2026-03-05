/**
 * script.js — Главная логика приложения English Trainer
 * SPA навигация, управление списками, режимы обучения, прогресс
 */

// ─── Состояние приложения ──────────────────────────────────────────────────
const AppState = {
  currentListId: null,     // ID текущего открытого списка
  currentListTitle: '',    // Название текущего списка
  studyWords: [],          // Слова для текущей сессии
  studyIndex: 0,           // Текущий индекс в учебном списке
  studyMode: null,         // 'flashcards' | 'type-test' | 'multi-choice'
  sessionCorrect: 0,       // Правильных ответов в сессии
  sessionWrong: 0,         // Ошибок в сессии
  isFlipped: false,        // Перевёрнута ли карточка
  isRandom10: false,       // Режим "случайные 10 слов"
};

// ─── Инициализация ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  showPage('home');
  await renderHome();
});

// ─── Навигация (SPA) ───────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ─── Домашняя страница ─────────────────────────────────────────────────────
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

  // Получаем количество слов для каждого списка
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

// ─── Детальная страница списка ─────────────────────────────────────────────
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

  // Загружаем прогресс для каждого слова
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
        <td class="word-ru">${escapeHtml(word.russian)} ${badgeHtml}</td>
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

// Поиск слов
let searchTimeout;
function onSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderListDetail(), 200);
}

// ─── Выбор режима обучения ─────────────────────────────────────────────────
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

// ─── Режим: Карточки (Flashcards) ──────────────────────────────────────────
async function startFlashcards() {
  AppState.studyMode = 'flashcards';
  AppState.sessionCorrect = 0;
  AppState.sessionWrong = 0;

  // Загружаем прогресс и строим взвешенный список
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

/** Адаптивный алгоритм — слова с ошибками повторяются чаще */
function buildTrainingList(words) {
  const list = [];
  words.forEach(word => {
    let weight = 1 + Math.max(0, word.wrong - word.correct);
    weight = Math.min(weight, 4); // Максимум 4 копии
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

  // Сбросить переворот
  const card = document.getElementById('flashcard');
  card.classList.remove('flipped');
  document.getElementById('fc-buttons').classList.add('hidden');

  // Анимация появления
  card.classList.remove('card-enter');
  void card.offsetWidth; // reflow
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

  // Анимация ухода карточки
  const card = document.getElementById('flashcard');
  card.classList.add(knew ? 'card-exit-right' : 'card-exit-left');

  setTimeout(() => {
    card.classList.remove('card-exit-right', 'card-exit-left');
    AppState.studyIndex++;
    renderFlashcard();
  }, 350);
}

// ─── Режим: Тест (ввод ответа) ─────────────────────────────────────────────
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

// Проверка с Enter
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

// ─── Режим: Тест (множественный выбор) ─────────────────────────────────────
async function startMultiChoice() {
  AppState.studyMode = 'multi-choice';
  AppState.sessionCorrect = 0;
  AppState.sessionWrong = 0;
  AppState.studyWords = shuffle([...AppState.studyWords]);
  AppState.studyIndex = 0;

  // Для вариантов ответов нужен общий пул слов
  // Загружаем все слова из базы для дистракторов
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

  // Генерируем 4 варианта ответа
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
  // Берём случайные слова-дистракторы
  const others = allWords
    .filter(w => w.english !== correct)
    .map(w => w.english);

  const distractors = shuffle(others).slice(0, 3);
  // Если слов меньше 4 — добавляем заглушки
  while (distractors.length < 3) {
    distractors.push(`option${distractors.length + 1}`);
  }
  return shuffle([correct, ...distractors]);
}

async function checkMcAnswer(btn, selected, correct, wordId) {
  // Блокируем все кнопки
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
    // Подсветить правильный ответ
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

// ─── Результат сессии ──────────────────────────────────────────────────────
function showSessionResult(mode) {
  const total = AppState.sessionCorrect + AppState.sessionWrong;
  const pct = total > 0 ? Math.round((AppState.sessionCorrect / total) * 100) : 0;

  document.getElementById('result-correct').textContent = AppState.sessionCorrect;
  document.getElementById('result-wrong').textContent = AppState.sessionWrong;
  document.getElementById('result-pct').textContent = `${pct}%`;

  // Эмодзи по результату
  const emoji = pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪';
  document.getElementById('result-emoji').textContent = emoji;

  const msg = pct >= 80
    ? 'Отличный результат!'
    : pct >= 50
    ? 'Хороший результат!'
    : 'Продолжайте практиковаться!';
  document.getElementById('result-msg').textContent = msg;

  // Кольцо прогресса
  const circle = document.getElementById('result-circle');
  const circumference = 2 * Math.PI * 54;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = circumference;
  setTimeout(() => {
    circle.style.strokeDashoffset = circumference * (1 - pct / 100);
  }, 100);

  showPage('result');
}

// ─── Прогресс ──────────────────────────────────────────────────────────────
async function renderProgress() {
  showPage('progress');

  const allWords = await getAllWords();
  const allProgress = await getAllProgress();
  const allLists = await getWordLists();

  // Создаём карту прогресса
  const progressMap = {};
  allProgress.forEach(p => { progressMap[p.word_id] = p; });

  // Считаем статистику
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

  // Прогресс-бар
  document.getElementById('prog-bar-fill').style.width = `${pct}%`;

  // Сложные слова (wrong > correct)
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

  // Статистика по спискам
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

  // Найти список первого сложного слова для контекста
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

// ─── Модальные окна ────────────────────────────────────────────────────────
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

// Закрытие модалок по клику на оверлей
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ─── Toast уведомления ─────────────────────────────────────────────────────
let toastTimeout;
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Утилиты ───────────────────────────────────────────────────────────────
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

// Добавление слова по Enter
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

// Импорт слов из текста (bulk)
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

// Обратно к списку
function backToList() {
  showPage('list-detail');
  renderListDetail();
}

function backToHome() {
  showPage('home');
  renderHome();
}

// ─── JSON Шеринг ───────────────────────────────────────────────────────────

/**
 * Экспортировать список в JSON-файл.
 * Формат: { version, title, created_at, words: [{english, russian}] }
 */
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

/**
 * Показать модальное окно экспорта со ссылкой на JSON-текст.
 * Позволяет скачать файл или скопировать JSON в буфер.
 */
async function showExportModal(listId) {
  const list  = await getWordList(listId || AppState.currentListId);
  const words = await getWordsByListId(listId || AppState.currentListId);

  const payload = {
    version:    1,
    app:        'english-trainer',
    title:      list.title,
    created_at: list.created_at,
    words:      words.map(w => ({ english: w.english, russian: w.russian })),
  };

  const json = JSON.stringify(payload, null, 2);
  document.getElementById('export-title').textContent  = `Экспорт: ${list.title}`;
  document.getElementById('export-count').textContent  = `${words.length} ${pluralWords(words.length)}`;
  document.getElementById('export-textarea').value     = json;
  document.getElementById('modal-export').classList.add('active');

  // Привязываем кнопку «Скачать файл»
  document.getElementById('export-download-btn').onclick = () => exportListAsJSON(listId || AppState.currentListId);
}

/**
 * Скопировать JSON из модального окна в буфер обмена.
 */
async function copyExportJSON() {
  const text = document.getElementById('export-textarea').value;
  try {
    await navigator.clipboard.writeText(text);
    showToast('JSON скопирован в буфер!');
  } catch {
    // Fallback для браузеров без Clipboard API
    document.getElementById('export-textarea').select();
    document.execCommand('copy');
    showToast('JSON скопирован!');
  }
}

/**
 * Открыть модальное окно импорта JSON.
 */
function openImportJSONModal() {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-error').textContent = '';
  document.getElementById('modal-import').classList.add('active');
  setTimeout(() => document.getElementById('import-textarea').focus(), 100);
}

/**
 * Загрузить JSON-файл через <input type="file"> и вставить в textarea.
 */
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

/**
 * Выполнить импорт: распарсить JSON и создать новый список.
 */
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

  // Валидация структуры
  if (!payload.title || !Array.isArray(payload.words)) {
    errEl.textContent = '❌ Неверный формат. Ожидается { title, words: [{english, russian}] }';
    return;
  }

  const validWords = payload.words.filter(w => w.english && w.russian);
  if (validWords.length === 0) {
    errEl.textContent = '❌ В файле нет слов с полями english и russian';
    return;
  }

  // Создать список и добавить слова
  const newTitle  = payload.title + (payload.title ? ' (импорт)' : 'Импортированный список');
  const newListId = await createWordList(newTitle);
  for (const w of validWords) {
    await addWord(newListId, w.english, w.russian);
  }

  closeModal('modal-import');
  await renderHome();
  showToast(`Импортировано ${validWords.length} ${pluralWords(validWords.length)} в «${newTitle}»`);
}
