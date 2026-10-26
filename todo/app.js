// UI for the todo app: create tasks (with optional due date and tags), mark them
// done, delete them, and filter by status and tag. Data lives in TaskDB.
const form = document.getElementById("new-task");
const titleInput = document.getElementById("task-title");
const dueInput = document.getElementById("task-due");
const tagsInput = document.getElementById("task-tags");
const repeatInput = document.getElementById("task-repeat");
const statusButtons = document.querySelectorAll(".status-filter button");
const tagFilter = document.getElementById("tag-filter");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");

const filters = { status: "all", tag: "" };

function showError(err) {
  status.textContent = "Something went wrong: " + (err && err.message ? err.message : err);
}

// "work, Urgent, work" -> ["work", "urgent"]
function parseTags(text) {
  const tags = text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return [...new Set(tags)];
}

const toIso = (y, m, d) => [y, m, d].map((n) => String(n).padStart(2, "0")).join("-");
const parseIso = (iso) => iso.split("-").map(Number); // -> [y, m, d], m is 1-based
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based
const DAY_MS = 86400000;

// Today's date as YYYY-MM-DD in local time, comparable with <input type="date"> values
// (the date inputs are limited to 4-digit years, so string order is date order).
function today() {
  const d = new Date();
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const REPEAT_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

// One step of a series. Monthly keeps the series' original day-of-month (anchorDay),
// clamped to short months, so Jan 31 -> Feb 28 -> Mar 31 rather than drifting to the 28th.
function stepDate(iso, repeat, anchorDay, steps = 1) {
  let [y, m, d] = parseIso(iso);
  if (repeat === "monthly") {
    const total = (m - 1) + steps;
    y += Math.floor(total / 12);
    m = (total % 12) + 1;
    return toIso(y, m, Math.min(anchorDay || d, daysInMonth(y, m)));
  }
  const next = new Date(y, m - 1, d + (repeat === "weekly" ? 7 : 1) * steps);
  return toIso(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

// Next due date after `iso`, jumped forward to today or later so a late completion
// doesn't leave a trail of already-overdue occurrences. Computed in one step rather
// than a loop, so any due date (however old) finishes instantly.
function nextDueDate(iso, repeat, anchorDay) {
  const next = stepDate(iso, repeat, anchorDay);
  const t = today();
  if (next >= t) return next;
  const [ny, nm, nd] = parseIso(next);
  const [ty, tm, td] = parseIso(t);
  let behind; // whole steps needed to reach today, possibly one short
  if (repeat === "monthly") {
    behind = (ty - ny) * 12 + (tm - nm);
  } else {
    const days = Math.round((new Date(ty, tm - 1, td) - new Date(ny, nm - 1, nd)) / DAY_MS);
    behind = Math.floor(days / (repeat === "weekly" ? 7 : 1));
  }
  let caught = stepDate(next, repeat, anchorDay, behind);
  if (caught < t) caught = stepDate(caught, repeat, anchorDay);
  return caught;
}

function formatDue(iso) {
  const [y, m, d] = parseIso(iso);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(task) {
  return !task.done && !!task.dueDate && task.dueDate < today();
}

// Open tasks first; then by due date (no date last); then oldest first.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done - b.done;
  const ad = a.dueDate || "9999-12-31";
  const bd = b.dueDate || "9999-12-31";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt - b.createdAt;
}

function matchesFilters(task) {
  if (filters.status === "active" && task.done) return false;
  if (filters.status === "completed" && !task.done) return false;
  if (filters.tag && !(task.tags || []).includes(filters.tag)) return false;
  return true;
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task" + (task.done ? " done" : "") + (isOverdue(task) ? " overdue" : "");
  li.dataset.id = task.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.id = "task-" + task.id;
  checkbox.setAttribute("aria-label", "Mark done: " + task.title);

  const body = document.createElement("div");
  body.className = "task-body";

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = task.title; // textContent, never innerHTML, so titles can't inject markup
  body.append(label);

  const tags = task.tags || [];
  // The ↻ badge marks a live series, so only open tasks show it; completed occurrences
  // are history and shouldn't suggest they still recur.
  const showRepeat = task.repeat && !task.done;
  if (task.dueDate || tags.length || showRepeat) {
    const meta = document.createElement("div");
    meta.className = "task-meta";
    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = "due";
      due.textContent = (isOverdue(task) ? "Overdue · " : "Due ") + formatDue(task.dueDate);
      meta.append(due);
    }
    if (showRepeat) {
      const rep = document.createElement("span");
      rep.className = "repeat";
      rep.textContent = "↻ " + REPEAT_LABELS[task.repeat];
      meta.append(rep);
    }
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      meta.append(chip);
    }
    body.append(meta);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "Delete";
  del.setAttribute("aria-label", "Delete: " + task.title);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  if (showRepeat) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "stop-repeat";
    stop.textContent = "Stop repeating";
    stop.setAttribute("aria-label", "Stop repeating: " + task.title);
    actions.append(stop);
  }
  actions.append(del);

  li.append(checkbox, body, actions);
  return li;
}

// Rebuild the tag dropdown from the tags in use, keeping the current choice if it still exists.
function renderTagOptions(tasks) {
  const used = [...new Set(tasks.flatMap((t) => t.tags || []))].sort();
  if (filters.tag && !used.includes(filters.tag)) filters.tag = "";
  const options = [new Option("All tags", "")].concat(used.map((t) => new Option("#" + t, t)));
  tagFilter.replaceChildren(...options);
  tagFilter.value = filters.tag;
}

async function refresh() {
  const tasks = await TaskDB.all();
  renderTagOptions(tasks);
  const visible = tasks.filter(matchesFilters).sort(compareTasks);
  list.replaceChildren(...visible.map(renderTask));
  empty.hidden = visible.length > 0;
  empty.textContent = tasks.length ? "No tasks match these filters." : "No tasks yet. Add one above.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  const repeat = repeatInput.value || null;
  // A recurring task needs a date to recur from; default the first occurrence to today.
  // (The date input's min/max make the browser block out-of-range dates before submit.)
  const dueDate = dueInput.value || (repeat ? today() : null);
  const typed = { title: titleInput.value, due: dueInput.value, tags: tagsInput.value, repeat: repeatInput.value };
  const task = { title, dueDate, tags: parseTags(tagsInput.value), repeat };
  if (repeat === "monthly") task.anchorDay = Number(dueDate.slice(8, 10));
  // Clear the form before the async save so input typed meanwhile isn't wiped afterwards.
  form.reset();
  try {
    await TaskDB.add(task);
    status.textContent = "";
    await refresh();
  } catch (err) {
    // Give the user back what they entered, but never overwrite a field they've
    // already started filling in again since the form was cleared.
    if (!titleInput.value) titleInput.value = typed.title;
    if (!dueInput.value) dueInput.value = typed.due;
    if (!tagsInput.value) tagsInput.value = typed.tags;
    if (!repeatInput.value) repeatInput.value = typed.repeat;
    showError(err);
  }
  titleInput.focus();
});

for (const button of statusButtons) {
  button.addEventListener("click", () => {
    filters.status = button.dataset.status;
    statusButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    refresh().catch(showError);
  });
}

tagFilter.addEventListener("change", () => {
  filters.tag = tagFilter.value;
  refresh().catch(showError);
});

list.addEventListener("change", async (e) => {
  if (e.target.type !== "checkbox") return;
  const id = Number(e.target.closest(".task").dataset.id);
  try {
    // Completing a recurring task spawns its next occurrence; un-completing removes it again.
    // TaskDB.setDone does both in one transaction (see db.js).
    await TaskDB.setDone(id, e.target.checked, (task) => ({
      title: task.title,
      tags: task.tags || [],
      repeat: task.repeat,
      ...(task.anchorDay ? { anchorDay: task.anchorDay } : {}),
      dueDate: nextDueDate(task.dueDate || today(), task.repeat, task.anchorDay),
    }));
    await refresh();
  } catch (err) {
    showError(err);
    refresh().catch(showError); // re-sync the checkbox with what was actually saved
  }
});

list.addEventListener("click", async (e) => {
  const isDelete = e.target.classList.contains("delete");
  const isStop = e.target.classList.contains("stop-repeat");
  if (!isDelete && !isStop) return;
  const id = Number(e.target.closest(".task").dataset.id);
  try {
    if (isDelete) await TaskDB.remove(id);
    else await TaskDB.stopRepeat(id);
    await refresh();
  } catch (err) {
    showError(err);
    refresh().catch(showError);
  }
});

refresh().catch(showError);
