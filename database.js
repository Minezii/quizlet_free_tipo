const DB_NAME = 'english_trainer_db';
const DB_VERSION = 1;
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains('word_lists')) {
        const listStore = database.createObjectStore('word_lists', {
          keyPath: 'id',
          autoIncrement: true,
        });
        listStore.createIndex('created_at', 'created_at', { unique: false });
      }

      if (!database.objectStoreNames.contains('words')) {
        const wordStore = database.createObjectStore('words', {
          keyPath: 'id',
          autoIncrement: true,
        });
        wordStore.createIndex('list_id', 'list_id', { unique: false });
      }

      if (!database.objectStoreNames.contains('progress')) {
        database.createObjectStore('progress', { keyPath: 'word_id' });
      }
    };
  });
}

function createWordList(title) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('word_lists', 'readwrite');
    const store = tx.objectStore('word_lists');
    const req = store.add({ title, created_at: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getWordLists() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('word_lists', 'readonly');
    const store = tx.objectStore('word_lists');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getWordList(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('word_lists', 'readonly');
    const store = tx.objectStore('word_lists');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteWordList(id) {
  const words = await getWordsByListId(id);
  for (const word of words) {
    await deleteWord(word.id);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('word_lists', 'readwrite');
    const store = tx.objectStore('word_lists');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function updateWordList(id, title) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('word_lists', 'readwrite');
    const store = tx.objectStore('word_lists');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const list = getReq.result;
      list.title = title;
      const putReq = store.put(list);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function addWord(listId, english, russian) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const req = store.add({ list_id: listId, english: english.trim(), russian: russian.trim() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getWordsByListId(listId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    const index = store.index('list_id');
    const req = index.getAll(listId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllWords() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updateWord(id, english, russian) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const word = getReq.result;
      word.english = english.trim();
      word.russian = russian.trim();
      const putReq = store.put(word);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function deleteWord(id) {
  await deleteProgress(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getProgress(wordId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readonly');
    const store = tx.objectStore('progress');
    const req = store.get(wordId);
    req.onsuccess = () =>
      resolve(req.result || { word_id: wordId, correct: 0, wrong: 0, last_review: null });
    req.onerror = () => reject(req.error);
  });
}

function updateProgress(wordId, correct, wrong) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readwrite');
    const store = tx.objectStore('progress');
    const req = store.put({
      word_id: wordId,
      correct,
      wrong,
      last_review: new Date().toISOString(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteProgress(wordId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readwrite');
    const store = tx.objectStore('progress');
    const req = store.delete(wordId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllProgress() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readonly');
    const store = tx.objectStore('progress');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
