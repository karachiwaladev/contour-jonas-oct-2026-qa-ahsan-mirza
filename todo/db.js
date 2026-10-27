// Client-side database for tasks, backed by IndexedDB.
// Each task: { id: number (auto), title: string, done: boolean, createdAt: number,
//              dueDate: "YYYY-MM-DD" | null, tags: string[],
//              repeat: "daily" | "weekly" | "monthly" | null,
//              priority: "high" | "medium" | "low",   // missing = "medium"
//              anchorDay?: number,      // monthly: day-of-month the series started on
//              edited?: boolean,        // changed via the edit form (undo won't delete it)
//              spawnedId?: number }     // recurring: id of the next occurrence it created
// Tasks saved before a field existed simply lack it; the UI treats missing as empty.
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
      // An explicit tx.abort() (e.g. "task no longer exists") has no tx.error; say why instead.
      tx.onabort = () => reject(tx.error || new Error(tx.abortReason || "The change was not saved."));
    });
  }

  return {
    all: () => run("readonly", (s) => s.getAll()),
    add: ({ title, dueDate = null, tags = [], repeat = null, priority = "medium", anchorDay }) =>
      run("readwrite", (s) =>
        s.add({ title, done: false, createdAt: Date.now(), dueDate, tags, repeat, priority, ...(anchorDay ? { anchorDay } : {}) })
      ),
    // Apply an edit (title, dueDate, tags, priority, repeat, anchorDay) in one readwrite
    // transaction: read, merge and write can't interleave with a concurrent setDone.
    // Rejects if the task no longer exists (e.g. deleted in another tab), so the UI can say so.
    // Marks the task `edited`, so undoing its predecessor never deletes the user's changes.
    update: (id, patch) =>
      run("readwrite", (s) => {
        const req = s.get(id);
        req.onsuccess = () => {
          const task = req.result;
          if (!task) {
            req.transaction.abortReason = "This task no longer exists. It may have been deleted in another tab.";
            req.transaction.abort();
            return;
          }
          const next = { ...task, ...patch, edited: true };
          if (next.repeat !== "monthly") delete next.anchorDay;
          s.put(next);
        };
        return req;
      }),
    get: (id) => run("readonly", (s) => s.get(id)),
    put: (task) => run("readwrite", (s) => s.put(task)),
    remove: (id) => run("readwrite", (s) => s.delete(id)),
    setDone,
    // Turn recurrence off in one transaction, so it can't race a concurrent setDone.
    stopRepeat: (id) =>
      run("readwrite", (s) => {
        const req = s.get(id);
        req.onsuccess = () => {
          const task = req.result;
          if (task) s.put({ ...task, repeat: null });
        };
        return req;
      }),
  };

  // Mark a task done/not done in ONE readwrite transaction, so the read-modify-write can't
  // interleave with another click and a half-finished change can't be left behind.
  // - Completing a recurring task that hasn't spawned yet creates its next occurrence
  //   (built by nextFor(task)) and records its id in spawnedId.
  // - Un-completing it removes that next occurrence again if it's still open, so undoing an
  //   accidental tick doesn't leave two active copies of the series.
  async function setDone(id, done, nextFor) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      store.get(id).onsuccess = (e) => {
        const task = e.target.result;
        if (!task || task.done === done) return; // already in that state (e.g. a double click)
        task.done = done;

        if (done && task.repeat && task.spawnedId == null) {
          store.add({ ...nextFor(task), done: false, createdAt: Date.now() }).onsuccess = (ev) => {
            task.spawnedId = ev.target.result;
            store.put(task);
          };
        } else if (!done && task.spawnedId != null) {
          store.get(task.spawnedId).onsuccess = (ev) => {
            const next = ev.target.result;
            if (!next) {
              delete task.spawnedId; // the next one was deleted: re-ticking may spawn again
            } else if (!next.done && !next.edited && next.repeat === task.repeat) {
              store.delete(task.spawnedId); // untouched next occurrence: undo it
              delete task.spawnedId;
            } else {
              // The series has moved on (next was completed, edited, or the user stopped it there).
              // Reopen this one as a plain task so there's never a second live copy and a
              // stopped series isn't revived.
              task.repeat = null;
            }
            store.put(task);
          };
        } else {
          store.put(task);
        }
      };
    });
  }
})();
