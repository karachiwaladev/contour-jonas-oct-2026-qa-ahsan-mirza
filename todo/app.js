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

// Today's date as YYYY-MM-DD in local time, comparable with <input type="date"> values.
function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}

const REPEAT_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

const toIso = (y, m, d) => [y, m, d].map((n) => String(n).padStart(2, "0")).join("-");
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based

// One step of a series. Monthly keeps the series' original day-of-month (anchorDay),
// clamped to short months, so Jan 31 -> Feb 28 -> Mar 31 rather than drifting to the 28th.
function stepDate(iso, repeat, anchorDay) {
  let [y, m, d] = iso.split("-").map(Number);
  if (repeat === "monthly") {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return toIso(y, m, Math.min(anchorDay || d, daysInMonth(y, m)));
  }
  const next = new Date(y, m - 1, d + (repeat === "weekly" ? 7 : 1));
  return toIso(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

// Next due date after `iso`, advanced until it's today or later so a late completion
// doesn't leave a trail of already-overdue occurrences.
function nextDueDate(iso, repeat, anchorDay) {
  let next = stepDate(iso, repeat, anchorDay);
  while (next < today()) next = stepDate(next, repeat, anchorDay);
  return next;
}

function formatDue(iso) {
  const [y, m, d] = iso.split("-").map(Number);
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
  if (task.dueDate || tags.length || task.repeat) {
    const meta = document.createElement("div");
    meta.className = "task-meta";
    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = "due";
      due.textContent = (isOverdue(task) ? "Overdue · " : "Due ") + formatDue(task.dueDate);
      meta.append(due);
    }
    if (task.repeat) {
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
  if (task.repeat && !task.done) {
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
  const dueDate = dueInput.value || (repeat ? today() : null);
  const task = { title, dueDate, tags: parseTags(tagsInput.value), repeat };
  if (repeat === "monthly") task.anchorDay = Number(dueDate.slice(8, 10));
  // Clear the form before the async save so input typed meanwhile isn't wiped afterwards.
  form.reset();
  try {
    await TaskDB.add(task);
    status.textContent = "";
    await refresh();
  } catch (err) {
    titleInput.value = task.title; // give the user their text back
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
    const task = await TaskDB.get(id);
    if (!task) return refresh();
    task.done = e.target.checked;
    // Completing a recurring task spawns the next occurrence, once. spawnedNext stays set
    // if the task is un-checked, so toggling it again can't create duplicates.
    const spawn = task.done && task.repeat && !task.spawnedNext;
    if (spawn) task.spawnedNext = true;
    await TaskDB.put(task);
    if (spawn) {
      await TaskDB.add({
        title: task.title,
        tags: task.tags || [],
        repeat: task.repeat,
        anchorDay: task.anchorDay,
        dueDate: nextDueDate(task.dueDate || today(), task.repeat, task.anchorDay),
      });
    }
    await refresh();
  } catch (err) {
    showError(err);
  }
});

list.addEventListener("click", async (e) => {
  const isDelete = e.target.classList.contains("delete");
  const isStop = e.target.classList.contains("stop-repeat");
  if (!isDelete && !isStop) return;
  const id = Number(e.target.closest(".task").dataset.id);
  try {
    if (isDelete) {
      await TaskDB.remove(id);
    } else {
      const task = await TaskDB.get(id);
      if (task) {
        task.repeat = null;
        await TaskDB.put(task);
      }
    }
    await refresh();
  } catch (err) {
    showError(err);
  }
});

refresh().catch(showError);
