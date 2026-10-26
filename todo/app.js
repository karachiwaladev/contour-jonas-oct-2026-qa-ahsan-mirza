// UI for the todo app: create, mark done, and delete tasks stored in TaskDB.
const form = document.getElementById("new-task");
const input = document.getElementById("task-title");
const list = document.getElementById("task-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");

function showError(err) {
  status.textContent = "Something went wrong: " + (err && err.message ? err.message : err);
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task" + (task.done ? " done" : "");
  li.dataset.id = task.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.id = "task-" + task.id;
  checkbox.setAttribute("aria-label", "Mark done: " + task.title);

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = task.title; // textContent, never innerHTML, so titles can't inject markup

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "Delete";
  del.setAttribute("aria-label", "Delete: " + task.title);

  li.append(checkbox, label, del);
  return li;
}

async function refresh() {
  const tasks = await TaskDB.all();
  // Open tasks first, then done; oldest first within each group.
  tasks.sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
  list.replaceChildren(...tasks.map(renderTask));
  empty.hidden = tasks.length > 0;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  try {
    await TaskDB.add(title);
    input.value = "";
    status.textContent = "";
    await refresh();
  } catch (err) {
    showError(err);
  }
  input.focus();
});

list.addEventListener("change", async (e) => {
  if (e.target.type !== "checkbox") return;
  const id = Number(e.target.closest(".task").dataset.id);
  try {
    const task = await TaskDB.get(id);
    if (!task) return refresh();
    task.done = e.target.checked;
    await TaskDB.put(task);
    await refresh();
  } catch (err) {
    showError(err);
  }
});

list.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete")) return;
  const id = Number(e.target.closest(".task").dataset.id);
  try {
    await TaskDB.remove(id);
    await refresh();
  } catch (err) {
    showError(err);
  }
});

refresh().catch(showError);
