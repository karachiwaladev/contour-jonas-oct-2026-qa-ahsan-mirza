# Todo app

A small todo app with a simple interface. Tasks are stored in the browser with **IndexedDB**,
a client-side database, so they persist across page reloads with no server. Built for ticket #5.

## Features

- **Create** a task: type a title and press Enter or click **Add**.
- **Mark done**: tick the checkbox. Done tasks are struck through and move below open ones.
- **Delete**: click **Delete** on a task.

## Run it

No build step or dependencies. Open `todo/index.html` in a browser, or serve the folder:

```
python -m http.server 8000 --directory todo
```

Then visit http://localhost:8000.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `db.js` | `TaskDB`: IndexedDB wrapper (`all`, `add`, `get`, `put`, `remove`) |
| `app.js` | UI logic: renders tasks and wires up create, done and delete |
| `styles.css` | Styling, with light and dark themes |

Data lives in the browser's `todo-app` IndexedDB database. Clearing site data resets it.
