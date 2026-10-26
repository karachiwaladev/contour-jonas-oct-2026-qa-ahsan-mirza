// Client-side database for tasks, backed by IndexedDB.
// Each task: { id: number (auto), title: string, done: boolean, createdAt: number }
const TaskDB = (() => {
  const DB_NAME = "todo-app";
  const STORE = "tasks";
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Runs fn(store) in a transaction and resolves with the request's result.
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    all: () => run("readonly", (s) => s.getAll()),
    add: (title) => run("readwrite", (s) => s.add({ title, done: false, createdAt: Date.now() })),
    get: (id) => run("readonly", (s) => s.get(id)),
    put: (task) => run("readwrite", (s) => s.put(task)),
    remove: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
