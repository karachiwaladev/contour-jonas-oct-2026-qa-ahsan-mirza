// UI for the todo app: create tasks (with optional due date, tags, priority and repeat),
// edit them inline, mark them done, delete them, and filter by status, priority and tag.
// Data lives in TaskDB.
const form = document.getElementById("new-task");
const titleInput = document.getElementById("task-title");
const dueInput = document.getElementById("task-due");
const tagsInput = document.getElementById("task-tags");
const repeatInput = document.getElementById("task-repeat");
const priorityInput = document.getElementById("task-priority");
const statusButtons = document.querySelectorAll(".status-filter button");
const tagFilter = document.getElementById("tag-filter");
const priorityFilter = document.getElementById("priority-filter");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");

const filters = { status: "all", tag: "", priority: "" };
let editingId = null; // id of the task currently shown as an inline edit form
let editDirty = false; // whether that form has unsaved changes

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
const PRIORITY_LABELS = { high: "High", medium: "Medium", low: "Low" };
// Tasks saved before priorities existed have none; treat them as Medium everywhere.
const priorityOf = (task) => (PRIORITY_RANK[task.priority] ? task.priority : "medium");

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

// Open tasks first, ordered by priority (High → Low); then by due date (no date last);
// then oldest first. Completed tasks are history, so priority doesn't reorder them.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done - b.done;
  if (!a.done) {
    const pa = PRIORITY_RANK[priorityOf(a)], pb = PRIORITY_RANK[priorityOf(b)];
    if (pa !== pb) return pb - pa;
  }
  const ad = a.dueDate || "9999-12-31";
  const bd = b.dueDate || "9999-12-31";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt - b.createdAt;
}

function matchesFilters(task) {
  if (filters.status === "active" && task.done) return false;
  if (filters.status === "completed" && !task.done) return false;
  if (filters.tag && !(task.tags || []).includes(filters.tag)) return false;
  if (filters.priority && priorityOf(task) !== filters.priority) return false;
  return true;
}

// Small helpers for building the edit form without innerHTML.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function selectOf(name, options, value, label) {
  const select = el("select", { name, "aria-label": label });
  for (const [v, text] of options) select.append(new Option(text, v));
  select.value = value;
  return select;
}

// The date inputs only offer 4-digit years, so string comparison is date comparison (see today()).
// Anything else (a typed 5-digit year, a partial value) is rejected rather than stored.
const VALID_DATE = /^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Due date and series fields shared by the add and edit forms: a series needs a date to recur
// from (default today), and a monthly series remembers its day of the month (anchorDay). When an
// existing monthly task is edited without moving its date, it keeps its original anchor, so a
// Jan 31 series clamped to Feb 28 still continues on Mar 31.
function seriesFields(dueValue, repeat, existing = null) {
  const dueDate = dueValue || (repeat ? today() : null);
  const fields = { dueDate, repeat };
  if (repeat === "monthly") {
    const keepAnchor = existing && existing.repeat === "monthly" && existing.anchorDay && existing.dueDate === dueDate;
    fields.anchorDay = keepAnchor ? existing.anchorDay : Number(dueDate.slice(8, 10));
  }
  return fields;
}

// The inline edit form that replaces a task row while it's being edited.
function renderEditForm(task) {
  const li = el("li", { className: "task editing" });
  li.dataset.id = task.id;
  // Native validation stays on, so the date input's min/max are enforced on submit.
  const form = el("form", { className: "task-edit" });
  const title = el("input", { name: "title", type: "text", value: task.title, maxLength: 200, "aria-label": "Title" });
  const due = el("input", { name: "due", type: "date", value: task.dueDate || "", min: "1900-01-01", max: "9999-12-31", "aria-label": "Due date" });
  const priority = selectOf("priority", Object.entries(PRIORITY_LABELS), priorityOf(task), "Priority");
  const repeat = selectOf("repeat", [["", "No repeat"], ...Object.entries(REPEAT_LABELS)], task.repeat || "", "Repeat");
  const tags = el("input", { name: "tags", type: "text", value: (task.tags || []).join(", "), maxLength: 200, placeholder: "tags", "aria-label": "Tags" });
  form.append(
    title,
    el("div", { className: "task-edit-row" }, [due, priority, repeat, tags]),
    el("div", { className: "task-edit-actions" }, [
      el("button", { type: "submit", className: "save", text: "Save" }),
      el("button", { type: "button", className: "cancel-edit", text: "Cancel" }),
    ])
  );
  li.append(form);
  return li;
}

function renderTask(task) {
  if (task.id === editingId) return renderEditForm(task);
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
  const prio = priorityOf(task);
  {
    const meta = document.createElement("div");
    meta.className = "task-meta";
    const badge = document.createElement("span");
    badge.className = "priority priority-" + prio;
    badge.textContent = PRIORITY_LABELS[prio];
    meta.append(badge);
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

  const button = (cls, text) => el("button", { type: "button", className: cls, text, "aria-label": `${text}: ${task.title}` });
  const actions = el("div", { className: "task-actions" }, [
    button("edit", "Edit"),
    ...(showRepeat ? [button("stop-repeat", "Stop repeating")] : []),
    button("delete", "Delete"),
  ]);

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

// What's typed in the open edit form, so a refresh triggered by something else (ticking another
// task, changing a filter) re-renders the form without throwing the unsaved changes away.
function editDraft() {
  const f = list.querySelector(".task.editing form");
  if (!f) return null;
  const values = {};
  for (const name of DRAFT_FIELDS) values[name] = f.elements[name].value;
  const focus = document.activeElement?.closest(".task-edit") ? document.activeElement.name : null;
  return { id: Number(f.closest(".task").dataset.id), values, focus };
}

// Put the draft back only into the same task's form (not one opened for a different task).
function restoreDraft(draft) {
  const f = draft && list.querySelector(`.task.editing[data-id="${draft.id}"] form`);
  if (!f) return;
  for (const name of DRAFT_FIELDS) f.elements[name].value = draft.values[name];
  if (draft.focus) f.elements[draft.focus]?.focus();
}
const DRAFT_FIELDS = ["title", "due", "priority", "repeat", "tags"];

async function refresh() {
  const tasks = await TaskDB.all();
  renderTagOptions(tasks);
  if (editingId !== null && !tasks.some((t) => t.id === editingId)) editingId = null; // deleted elsewhere
  // The task being edited stays visible even if a filter would hide it, so the edit isn't lost.
  const visible = tasks.filter((t) => t.id === editingId || matchesFilters(t)).sort(compareTasks);
  const draft = editDraft();
  list.replaceChildren(...visible.map(renderTask));
  restoreDraft(draft);
  empty.hidden = visible.length > 0;
  empty.textContent = tasks.length ? "No tasks match these filters." : "No tasks yet. Add one above.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  if (dueInput.value && !VALID_DATE.test(dueInput.value)) {
    status.textContent = "Pick a due date between 1900 and 9999.";
    return;
  }
  const typed = { title: titleInput.value, due: dueInput.value, tags: tagsInput.value, repeat: repeatInput.value, priority: priorityInput.value };
  const task = {
    title,
    tags: parseTags(tagsInput.value),
    priority: priorityInput.value || "medium",
    ...seriesFields(dueInput.value, repeatInput.value || null),
  };
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
    if (priorityInput.value === "medium") priorityInput.value = typed.priority;
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

priorityFilter.addEventListener("change", () => {
  filters.priority = priorityFilter.value;
  refresh().catch(showError);
});

function startEdit(id) {
  // Don't silently drop unsaved changes in another task's editor; ask to save or cancel first.
  if (editingId !== null && editingId !== id && editDirty) {
    status.textContent = "Save or cancel your current edit first.";
    list.querySelector(`.task.editing input[name="title"]`)?.focus();
    return;
  }
  editingId = id;
  editDirty = false;
  status.textContent = "";
  refresh()
    .then(() => list.querySelector(`.task[data-id="${id}"] input[name="title"]`)?.focus())
    .catch(showError);
}

function cancelEdit() {
  const id = editingId;
  editingId = null;
  editDirty = false;
  status.textContent = "";
  refresh().then(() => focusEditButton(id)).catch(showError);
}

// After Save/Cancel the form is replaced, so put keyboard focus back on that task's Edit button.
function focusEditButton(id) {
  list.querySelector(`.task[data-id="${id}"] .edit`)?.focus();
}

// Save an inline edit. Validation keeps the form open with a message instead of saving bad data.
list.addEventListener("submit", async (e) => {
  if (!e.target.classList.contains("task-edit")) return;
  e.preventDefault();
  const f = e.target.elements;
  const id = Number(e.target.closest(".task").dataset.id);
  const title = f.title.value.trim();
  if (!title) {
    status.textContent = "A task needs a title.";
    f.title.focus();
    return;
  }
  if (f.due.value && !VALID_DATE.test(f.due.value)) {
    status.textContent = "Pick a due date between 1900 and 9999.";
    f.due.focus();
    return;
  }
  const due = f.due.value, repeat = f.repeat.value || null;
  try {
    // Series fields (due date default, monthly anchor) are derived from the stored task inside
    // update's own transaction, so they can't be based on a stale read.
    await TaskDB.update(id, { title, tags: parseTags(f.tags.value), priority: f.priority.value },
      (stored) => seriesFields(due, repeat, stored));
    // Only close the editor if it's still this task's (another edit may have opened meanwhile).
    if (editingId === id) {
      editingId = null;
      editDirty = false;
      status.textContent = "";
      await refresh();
      focusEditButton(id);
    } else {
      await refresh();
    }
  } catch (err) {
    showError(err); // keep the form open so nothing typed is lost
  }
});

// Esc cancels the edit, except when it's closing a native dropdown or date picker inside the form.
list.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !e.target.closest(".task-edit")) return;
  if (e.target.tagName === "SELECT" || e.target.type === "date") return;
  cancelEdit();
});

// Track unsaved changes so opening another task's editor doesn't silently discard them.
list.addEventListener("input", (e) => {
  if (e.target.closest(".task-edit")) editDirty = true;
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
      priority: priorityOf(task),
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
  const cls = e.target.classList;
  if (cls.contains("edit")) return startEdit(Number(e.target.closest(".task").dataset.id));
  if (cls.contains("cancel-edit")) return cancelEdit();
  const isDelete = cls.contains("delete");
  const isStop = cls.contains("stop-repeat");
  if (!isDelete && !isStop) return;
  const id = Number(e.target.closest(".task").dataset.id);
  if (id === editingId) editingId = null;
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
