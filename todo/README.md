# Todo app

A small todo app with a simple interface. Tasks are stored in the browser with **IndexedDB**,
a client-side database, so they persist across page reloads with no server. Built for ticket #5.

## Features

- **Create** a task: type a title and press Enter or click **Add**.
- **Mark done**: tick the checkbox. Done tasks are struck through and move below open ones.
- **Delete**: click **Delete** on a task.
- **Due date** (optional): pick a date when adding a task. Open tasks past their due date show **Overdue** in red. Tasks sort by due date, with undated tasks last.
- **Tags** (optional): type comma-separated tags when adding a task (`work, urgent`). They're trimmed, lowercased and shown as chips.
- **Recurring tasks** (optional): pick **Repeat** (Daily / Weekly / Monthly) when adding a task. If there's no due date, it starts today. Completing one keeps it in Completed and creates the next occurrence with the same title and tags. Monthly tasks keep their day of the month, clamped to short months (Jan 31 → Feb 28 → Mar 31). If you complete one late, the next date jumps forward to today or later. Un-ticking a task you completed by mistake removes the occurrence it created, as long as that one is still open. **Stop repeating** turns recurrence off and keeps the task.
- **Priority**: pick **High / Medium / Low** when adding a task (default Medium). Each task shows a coloured badge, and open tasks sort High → Low, then by due date. Tasks saved before priorities existed count as Medium.
- **Edit**: click **Edit** on a task to change its title, due date, tags, priority or repeat inline. **Save** or Enter saves; **Cancel** or Esc discards. A task can't be saved without a title.
- **Filters**: **All / Active / Completed** buttons, a priority dropdown, and a tag dropdown built from the tags in use. All three combine.

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
