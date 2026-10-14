/* =========================================================
   Mint — daily task tracker
   Plain JavaScript: no framework, no build step.

   Structure of this file:
     1. Constants and DOM references
     2. Motion helpers (GSAP is optional — the app works without it)
     3. State and localStorage
     4. Rendering (list, priority panel, progress, empty states)
     5. Task actions (add, complete, prioritise, delete, filter)
     6. Event wiring
     7. Startup
   ========================================================= */

/* ---------------------------------------------------------
   1. Constants and DOM references
   --------------------------------------------------------- */

const STORAGE_KEY = "mint.tasks.v1";
const FILTERS = ["all", "active", "completed"];

const dom = {
  shell: document.getElementById("shell"),
  splash: document.getElementById("splash"),
  splashLeaf: document.querySelector(".splash-leaf"),
  splashWord: document.querySelector(".splash-word"),
  splashBarFill: document.querySelector(".splash-bar-fill"),
  list: document.getElementById("taskList"),
  empty: document.getElementById("emptyState"),
  emptyTitle: document.getElementById("emptyTitle"),
  emptyText: document.getElementById("emptyText"),
  form: document.getElementById("taskForm"),
  input: document.getElementById("taskInput"),
  hint: document.getElementById("composerHint"),
  filters: Array.from(document.querySelectorAll(".filter")),
  counts: {
    all: document.querySelector('[data-count="all"]'),
    active: document.querySelector('[data-count="active"]'),
    completed: document.querySelector('[data-count="completed"]'),
  },
  clearCompleted: document.getElementById("clearCompleted"),
  progressCount: document.getElementById("progressCount"),
  progressNote: document.getElementById("progressNote"),
  progressTrack: document.querySelector(".progress-track"),
  progressFill: document.getElementById("progressFill"),
  priorityList: document.getElementById("priorityList"),
  priorityEmpty: document.getElementById("topEmpty"),
  waves: document.querySelector(".waves"),
  fab: document.getElementById("fab"),
  composer: document.querySelector(".composer"),
  railLinks: Array.from(document.querySelectorAll(".rail-link")),
  topPanel: document.querySelector(".top-panel"),
};

/* ---------------------------------------------------------
   2. Motion helpers
   --------------------------------------------------------- */

// GSAP is loaded from a CDN. If it fails, or if the visitor prefers
// reduced motion, every helper below quietly does nothing and the UI
// still updates instantly.
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let prefersReducedMotion = motionQuery.matches;

function gsapReady() {
  return typeof window.gsap !== "undefined";
}

// The single question every animation asks before running.
function canAnimate() {
  return gsapReady() && !prefersReducedMotion;
}

// Turn <i data-lucide="..."> placeholders into icons.
// Safe to call repeatedly and safe when the CDN is unavailable.
function renderIcons() {
  if (!window.lucide || typeof window.lucide.createIcons !== "function") {
    document.documentElement.classList.add("no-lucide");
    return;
  }
  window.lucide.createIcons();
  // Drop the marker from generated <svg>s so later calls skip them.
  document.querySelectorAll("svg[data-lucide]").forEach(function (svg) {
    svg.removeAttribute("data-lucide");
  });
}

// Fade rows in gently. Used for the first paint and when filters change.
function staggerRows(nodes) {
  if (!canAnimate() || !nodes || nodes.length === 0) return;
  window.gsap.from(nodes, {
    opacity: 0,
    y: 10,
    duration: 0.34,
    stagger: 0.045,
    ease: "power2.out",
    clearProps: "opacity,transform",
  });
}

// Short entrance for one freshly added row.
function animateRowIn(node) {
  if (!canAnimate() || !node) return;
  window.gsap.from(node, {
    opacity: 0,
    y: 12,
    duration: 0.36,
    ease: "power2.out",
    clearProps: "opacity,transform",
  });
}

// A small pop on the checkbox plus a nudge of the label text.
function animateCompletion(node, isDone) {
  if (!canAnimate() || !node) return;
  const box = node.querySelector(".checkbox-box");
  const text = node.querySelector(".task-text");
  if (box) {
    window.gsap.fromTo(
      box,
      { scale: 0.72 },
      { scale: 1, duration: 0.36, ease: "back.out(2.2)", clearProps: "transform" }
    );
  }
  if (isDone && text) {
    window.gsap.fromTo(
      text,
      { x: 5, opacity: 0.55 },
      { x: 0, opacity: 1, duration: 0.3, ease: "power2.out", clearProps: "transform,opacity" }
    );
  }
}

// Collapse a row away. State is already saved before this runs, so an
// interrupted animation can never lose data — the safety timeout removes
// the row even if the tween never completes.
function exitRow(node, onDone) {
  const done = function () {
    if (onDone) onDone();
  };
  if (!node) return done();
  if (!canAnimate()) {
    node.remove();
    return done();
  }
  node.style.overflow = "hidden";
  let finished = false;
  const finish = function () {
    if (finished) return;
    finished = true;
    node.remove();
    done();
  };
  window.gsap
    .timeline({ onComplete: finish })
    .to(node, { opacity: 0, x: 18, duration: 0.18, ease: "power1.in" })
    .to(
      node,
      {
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderBottomColor: "transparent",
        duration: 0.22,
        ease: "power2.inOut",
      },
      "-=0.04"
    );
  window.setTimeout(finish, 800);
}

// Remove several rows together (used by "Clear completed").
function exitRows(nodes, onDone) {
  if (!nodes || nodes.length === 0) {
    if (onDone) onDone();
    return;
  }
  let remaining = nodes.length;
  nodes.forEach(function (node) {
    exitRow(node, function () {
      remaining -= 1;
      if (remaining === 0 && onDone) onDone();
    });
  });
}

// Restrained progress-bar movement.
function animateProgress(percent) {
  const width = percent + "%";
  if (canAnimate()) {
    window.gsap.to(dom.progressFill, {
      width: width,
      duration: 0.5,
      ease: "power2.out",
      overwrite: true,
    });
  } else {
    dom.progressFill.style.width = width;
  }
}

// Draw the three mint strokes in, then let them drift very slightly.
function animateWaves() {
  const paths = dom.waves ? Array.from(dom.waves.querySelectorAll("path")) : [];
  if (paths.length === 0) return;

  if (!canAnimate()) {
    paths.forEach(function (path) {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
    });
    return;
  }

  paths.forEach(function (path) {
    const length = typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
    if (!length) return;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
  });

  window.gsap.to(paths, {
    strokeDashoffset: 0,
    duration: 0.9,
    stagger: 0.1,
    ease: "power2.inOut",
    delay: 0.2,
  });

  // The only looping animation in the app: barely-there vertical drift.
  window.gsap.to(dom.waves, {
    y: -2,
    duration: 2.6,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
    delay: 1.2,
  });
}

function stopAmbientAnimations() {
  if (!gsapReady() || !dom.waves) return;
  window.gsap.killTweensOf(dom.waves);
  window.gsap.set(dom.waves, { clearProps: "all" });
  dom.waves.querySelectorAll("path").forEach(function (path) {
    path.style.strokeDasharray = "none";
    path.style.strokeDashoffset = "0";
  });
}

// Hover and press feedback, wired once through event delegation so no
// duplicate handlers can pile up when rows are re-rendered.
const FEEDBACK_SELECTOR =
  ".icon-btn, .btn-add, .filter, .btn-ghost, .rail-link, .fab, .top-jump, .top-remove";
let pressedElement = null;

function handlePointerOver(event) {
  const element = event.target.closest(FEEDBACK_SELECTOR);
  // Ignore moves between children of the same control.
  if (!element || element.contains(event.relatedTarget)) return;
  if (!canAnimate()) return;
  window.gsap.to(element, { scale: 1.04, duration: 0.18, ease: "power2.out" });
}

function handlePointerOut(event) {
  const element = event.target.closest(FEEDBACK_SELECTOR);
  if (!element || element.contains(event.relatedTarget)) return;
  if (!canAnimate()) return;
  window.gsap.to(element, { scale: 1, duration: 0.2, ease: "power2.out" });
}

function handlePointerDown(event) {
  const element = event.target.closest(FEEDBACK_SELECTOR);
  if (!element || !canAnimate()) return;
  pressedElement = element;
  window.gsap.to(element, { scale: 0.955, duration: 0.1, ease: "power1.out" });
}

function handlePointerUp() {
  if (!pressedElement) return;
  if (canAnimate()) {
    window.gsap.to(pressedElement, { scale: 1, duration: 0.2, ease: "power2.out" });
  }
  pressedElement = null;
}

/* ---------------------------------------------------------
   3. State and localStorage
   --------------------------------------------------------- */

// The single source of truth for the whole app.
let tasks = [];
let activeFilter = "all";

// Stable, unique ids — never array indexes (indexes change when items move).
function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return "task-" + window.crypto.randomUUID();
  }
  return "task-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

// A tasteful starting point for a brand new visitor.
function createSampleTasks() {
  const samples = [
    { text: "Review the quarterly design brief", priority: true, completed: false },
    { text: "Send the onboarding notes to Priya", priority: false, completed: false },
    { text: "Sketch three options for the hero", priority: true, completed: false },
    { text: "Book the studio for Thursday", priority: false, completed: false },
    { text: "Clear the inbox to zero", priority: false, completed: true },
  ];
  return samples.map(function (sample) {
    return {
      id: makeId(),
      text: sample.text,
      completed: sample.completed,
      priority: sample.priority,
      createdAt: Date.now(),
    };
  });
}

// Accept anything from storage, but only trust a well-shaped task.
function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeId(),
    text: text.slice(0, 140),
    completed: raw.completed === true,
    priority: raw.priority === true,
    createdAt: typeof raw.createdAt === "number" && isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now(),
  };
}

// Read tasks. Any failure (missing, invalid, malformed, blocked storage)
// falls back to a usable in-memory list instead of crashing.
function loadTasks() {
  let stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Mint: localStorage is unavailable, tasks will not persist.", error);
    return createSampleTasks();
  }

  // Seed examples only on the very first visit. Once anything (even an
  // empty list) has been stored, that is what the visitor gets.
  if (stored === null) return createSampleTasks();

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Stored value is not an array.");
    return parsed.map(normalizeTask).filter(Boolean);
  } catch (error) {
    console.warn("Mint: saved tasks were unreadable, starting with an empty list.", error);
    return [];
  }
}

function saveTasks() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.warn("Mint: could not save tasks.", error);
  }
}

function findTask(id) {
  return tasks.find(function (task) {
    return task.id === id;
  });
}

function countCompleted() {
  return tasks.filter(function (task) {
    return task.completed;
  }).length;
}

// Which tasks the current filter allows through.
function getVisibleTasks() {
  if (activeFilter === "active") {
    return tasks.filter(function (task) {
      return !task.completed;
    });
  }
  if (activeFilter === "completed") {
    return tasks.filter(function (task) {
      return task.completed;
    });
  }
  return tasks;
}

/* ---------------------------------------------------------
   4. Rendering
   --------------------------------------------------------- */

function taskSelector(id) {
  const escaped =
    window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(id)
      : id.replace(/["\\]/g, "\\$&");
  return '[data-id="' + escaped + '"]';
}

function checkboxLabel(task) {
  return task.completed
    ? 'Mark "' + task.text + '" as active'
    : 'Mark "' + task.text + '" as complete';
}

function priorityLabel(task) {
  return task.priority
    ? 'Remove priority from "' + task.text + '"'
    : 'Mark "' + task.text + '" as a top task';
}

// Small "Completed · Top task" line under each task name.
function createTaskMeta(task) {
  const meta = document.createElement("span");
  meta.className = "task-meta";

  const parts = [task.completed ? "Completed" : "In progress"];
  if (task.priority) parts.push("Top task");

  parts.forEach(function (part, index) {
    if (index > 0) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      meta.appendChild(dot);
    }
    meta.appendChild(document.createTextNode(part));
  });
  return meta;
}

// Build one task row. textContent is used for user input, so nothing is
// ever interpolated into HTML.
function createTaskNode(task) {
  const row = document.createElement("li");
  row.className = "task" + (task.completed ? " is-done" : "");
  row.dataset.id = task.id;

  // Checkbox: a real input, visually replaced by a square box.
  const checkbox = document.createElement("label");
  checkbox.className = "checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "task-check";
  input.checked = task.completed;
  input.setAttribute("aria-label", checkboxLabel(task));

  const box = document.createElement("span");
  box.className = "checkbox-box";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = '<i data-lucide="check"></i>';

  checkbox.append(input, box);

  const body = document.createElement("div");
  body.className = "task-body";

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;

  body.append(text, createTaskMeta(task));

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const priorityButton = document.createElement("button");
  priorityButton.type = "button";
  priorityButton.className = "icon-btn" + (task.priority ? " is-priority" : "");
  priorityButton.dataset.action = "priority";
  priorityButton.setAttribute("aria-pressed", String(task.priority));
  priorityButton.setAttribute("aria-label", priorityLabel(task));
  priorityButton.title = task.priority ? "Remove from top tasks" : "Add to top tasks";
  priorityButton.innerHTML = '<i data-lucide="star"></i>';

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "icon-btn";
  deleteButton.dataset.action = "delete";
  deleteButton.setAttribute("aria-label", 'Delete "' + task.text + '"');
  deleteButton.title = "Delete task";
  deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';

  actions.append(priorityButton, deleteButton);
  row.append(checkbox, body, actions);
  return row;
}

// One entry in the "Top tasks" panel, built from the same task objects.
function createPriorityNode(task) {
  const item = document.createElement("li");
  item.className = "top-item" + (task.completed ? " is-done" : "");

  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "top-jump";
  jump.dataset.action = "jump";
  jump.dataset.id = task.id;
  jump.setAttribute("aria-label", 'Go to task: ' + task.text);

  const text = document.createElement("span");
  text.className = "top-text";
  text.textContent = task.text;

  const note = document.createElement("span");
  note.className = "top-note";
  note.textContent = task.completed ? "Completed" : "Open";

  jump.append(text, note);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "top-remove";
  remove.dataset.action = "unpin";
  remove.dataset.id = task.id;
  remove.setAttribute("aria-label", 'Remove priority from "' + task.text + '"');
  remove.title = "Remove priority";
  remove.innerHTML = '<i data-lucide="x"></i>';

  item.append(jump, remove);
  return item;
}

// Rebuild the task list for the active filter.
function renderList(options) {
  const settings = options || {};
  const visible = getVisibleTasks();

  dom.list.textContent = "";
  visible.forEach(function (task) {
    dom.list.appendChild(createTaskNode(task));
  });
  renderIcons();

  if (settings.animate) staggerRows(Array.from(dom.list.children));
  updateEmptyStates();
}

// Rebuild the priority panel.
function renderPriorities(options) {
  const settings = options || {};
  const priorityTasks = tasks.filter(function (task) {
    return task.priority;
  });

  dom.priorityList.textContent = "";
  priorityTasks.forEach(function (task) {
    dom.priorityList.appendChild(createPriorityNode(task));
  });
  renderIcons();

  dom.priorityEmpty.hidden = priorityTasks.length > 0;

  if (settings.animate && priorityTasks.length > 0) {
    if (canAnimate()) {
      window.gsap.from(dom.priorityList.children, {
        opacity: 0,
        x: 10,
        duration: 0.32,
        stagger: 0.05,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    }
  }
}

function renderProgress() {
  const total = tasks.length;
  const done = countCompleted();
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  dom.progressCount.textContent = done + " of " + total + " done";

  let note = "Nothing scheduled yet";
  if (total > 0 && percent === 100) note = "All clear — nice work";
  else if (total > 0 && done === 0) note = "Ready when you are";
  else if (total > 0) note = percent + "% of today's plan complete";

  dom.progressNote.textContent = note;
  dom.progressTrack.setAttribute("aria-valuenow", String(percent));
  animateProgress(percent);
}

function renderFilterCounts() {
  const activeCount = tasks.length - countCompleted();
  dom.counts.all.textContent = String(tasks.length);
  dom.counts.active.textContent = String(activeCount);
  dom.counts.completed.textContent = String(countCompleted());
}

// Helpful messages instead of a blank space.
function updateEmptyStates() {
  const hasVisibleTasks = getVisibleTasks().length > 0;
  dom.empty.hidden = hasVisibleTasks;

  if (hasVisibleTasks) return;

  if (tasks.length === 0) {
    dom.emptyTitle.textContent = "Your list is clear";
    dom.emptyText.textContent =
      "Add your first task above and take it one step at a time.";
  } else if (activeFilter === "active") {
    dom.emptyTitle.textContent = "All caught up";
    dom.emptyText.textContent = "Every task is done. Enjoy the quiet.";
  } else if (activeFilter === "completed") {
    dom.emptyTitle.textContent = "Nothing completed yet";
    dom.emptyText.textContent = "Finish a task and it will appear here.";
  } else {
    dom.emptyTitle.textContent = "No tasks to show";
    dom.emptyText.textContent = "Try a different filter.";
  }
}

// Everything that depends on the task list: counts, progress, panel, empties.
function refreshDerived(options) {
  const settings = options || {};
  renderFilterCounts();
  renderProgress();
  renderPriorities({ animate: settings.animatePriorities === true });
  updateEmptyStates();

  // "Clear completed" only appears when it is actually useful.
  dom.clearCompleted.hidden = countCompleted() === 0;
}

/* ---------------------------------------------------------
   5. Task actions
   --------------------------------------------------------- */

let hintTimer = null;

function showHint(message, isError) {
  dom.hint.textContent = message;
  dom.hint.classList.toggle("is-error", isError === true);
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(function () {
    dom.hint.textContent = "";
    dom.hint.classList.remove("is-error");
  }, 2600);
}

function rejectEmptyTask() {
  showHint("Give your task a short name first.", true);
  dom.form.classList.add("is-invalid");
  if (canAnimate()) {
    window.gsap.fromTo(
      dom.form,
      { x: -5 },
      { x: 5, duration: 0.07, repeat: 5, yoyo: true, ease: "power1.inOut", clearProps: "transform" }
    );
  }
  window.setTimeout(function () {
    dom.form.classList.remove("is-invalid");
  }, 1200);
  dom.input.focus();
}

function addTask(rawText) {
  const text = (rawText || "").trim();
  if (!text) {
    rejectEmptyTask();
    return false;
  }

  const task = {
    id: makeId(),
    text: text.slice(0, 140),
    completed: false,
    priority: false,
    createdAt: Date.now(),
  };
  tasks.push(task);
  saveTasks();

  // A brand new task is never "completed", so make sure it can be seen.
  if (activeFilter === "completed") setFilter("all", { animate: false });

  const node = createTaskNode(task);
  dom.list.appendChild(node);
  renderIcons();
  animateRowIn(node);
  dom.input.value = "";
  dom.input.focus();

  refreshDerived();
  return true;
}

// Complete or restore a task. The row is patched in place so a running
// animation is not thrown away by a full re-render.
function toggleCompletion(id) {
  const task = findTask(id);
  if (!task) return;

  task.completed = !task.completed;
  saveTasks();

  const node = dom.list.querySelector(taskSelector(id));
  if (!node) {
    renderList();
    refreshDerived();
    return;
  }

  node.classList.toggle("is-done", task.completed);

  const input = node.querySelector(".task-check");
  if (input) {
    input.checked = task.completed;
    input.setAttribute("aria-label", checkboxLabel(task));
  }

  const meta = node.querySelector(".task-meta");
  if (meta) meta.replaceWith(createTaskMeta(task));

  animateCompletion(node, task.completed);

  // If the new state hides the row under the current filter, take it away.
  const stillVisible = getVisibleTasks().some(function (item) {
    return item.id === id;
  });
  if (!stillVisible) exitRow(node, updateEmptyStates);

  refreshDerived();
}

function togglePriority(id) {
  const task = findTask(id);
  if (!task) return;

  task.priority = !task.priority;
  saveTasks();

  const node = dom.list.querySelector(taskSelector(id));
  if (node) {
    const button = node.querySelector('[data-action="priority"]');
    if (button) {
      button.classList.toggle("is-priority", task.priority);
      button.setAttribute("aria-pressed", String(task.priority));
      button.setAttribute("aria-label", priorityLabel(task));
      button.title = task.priority ? "Remove from top tasks" : "Add to top tasks";
    }
    const meta = node.querySelector(".task-meta");
    if (meta) meta.replaceWith(createTaskMeta(task));
  } else {
    renderList();
  }

  refreshDerived({ animatePriorities: true });
}

function deleteTask(id) {
  const node = dom.list.querySelector(taskSelector(id));

  // State first, animation after: an interrupted exit can never lose data.
  tasks = tasks.filter(function (task) {
    return task.id !== id;
  });
  saveTasks();
  refreshDerived();

  exitRow(node, updateEmptyStates);
}

function clearCompleted() {
  const rows = Array.from(dom.list.querySelectorAll(".task.is-done"));
  tasks = tasks.filter(function (task) {
    return !task.completed;
  });
  saveTasks();
  refreshDerived();
  exitRows(rows, updateEmptyStates);
}

function setFilter(filter, options) {
  const settings = options || {};
  if (FILTERS.indexOf(filter) === -1) return;

  activeFilter = filter;
  dom.filters.forEach(function (button) {
    const isActive = button.dataset.filter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  renderList({ animate: settings.animate !== false });
  refreshDerived();
}

// From the Top tasks panel: reveal the task and make it obvious which one it is.
let highlightTimer = null;

function jumpToTask(id) {
  const task = findTask(id);
  if (!task) return;

  // The task may be hidden by the current filter — open the filter that shows it.
  if (activeFilter === "completed" && !task.completed) setFilter("all", { animate: false });
  if (activeFilter === "active" && task.completed) setFilter("all", { animate: false });

  const node = dom.list.querySelector(taskSelector(id));
  if (!node) return;

  node.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });

  window.clearTimeout(highlightTimer);
  node.classList.add("is-target");
  highlightTimer = window.setTimeout(function () {
    node.classList.remove("is-target");
  }, 1400);

  const checkbox = node.querySelector(".task-check");
  if (checkbox) checkbox.focus({ preventScroll: true });
}

/* ---------------------------------------------------------
   6. Event wiring (all delegated — handlers are never duplicated)
   --------------------------------------------------------- */

function wireEvents() {
  // Add a task (button click or Enter, both handled by the form).
  dom.form.addEventListener("submit", function (event) {
    event.preventDefault();
    addTask(dom.input.value);
  });

  // Escape clears the input.
  dom.input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      dom.input.value = "";
      dom.hint.textContent = "";
    }
  });

  // Checkboxes in the main list.
  dom.list.addEventListener("change", function (event) {
    const checkbox = event.target.closest(".task-check");
    if (!checkbox) return;
    const row = checkbox.closest(".task");
    if (row) toggleCompletion(row.dataset.id);
  });

  // Star and delete buttons in the main list.
  dom.list.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".task");
    if (!row) return;
    if (button.dataset.action === "priority") togglePriority(row.dataset.id);
    if (button.dataset.action === "delete") deleteTask(row.dataset.id);
  });

  // Jump to / unpin from the Top tasks panel.
  dom.priorityList.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "jump") jumpToTask(button.dataset.id);
    if (button.dataset.action === "unpin") togglePriority(button.dataset.id);
  });

  dom.filters.forEach(function (button) {
    button.addEventListener("click", function () {
      setFilter(button.dataset.filter, { animate: true });
    });
  });

  dom.clearCompleted.addEventListener("click", clearCompleted);

  // Floating button: bring the composer into view and focus it.
  dom.fab.addEventListener("click", function () {
    dom.input.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "center",
    });
    dom.input.focus({ preventScroll: true });
  });

  // When the workspace stacks above the priority panel the fixed button would
  // hover over the task rows, so there it only appears once the composer it
  // points at has scrolled out of view.
  const stackedQuery = window.matchMedia("(max-width: 940px)");
  function syncFab() {
    if (!stackedQuery.matches) {
      dom.fab.classList.remove("is-stowed");
      return;
    }
    const box = dom.composer.getBoundingClientRect();
    const composerOnScreen = box.bottom > 0 && box.top < window.innerHeight;
    dom.fab.classList.toggle("is-stowed", composerOnScreen);
  }
  if (typeof window.IntersectionObserver === "function") {
    new window.IntersectionObserver(syncFab, { threshold: 0 }).observe(dom.composer);
  } else {
    window.addEventListener("scroll", syncFab, { passive: true });
  }
  if (typeof stackedQuery.addEventListener === "function") {
    stackedQuery.addEventListener("change", syncFab);
  }
  syncFab();

  // Rail shortcuts.
  dom.railLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      dom.railLinks.forEach(function (other) {
        const isActive = other === link;
        other.classList.toggle("is-active", isActive);
        if (isActive) other.setAttribute("aria-current", "page");
        else other.removeAttribute("aria-current");
      });

      const target = link.dataset.nav;
      if (target === "today") {
        setFilter("all", { animate: true });
        dom.input.focus();
      } else if (target === "done") {
        setFilter("completed", { animate: true });
      } else if (target === "priority") {
        dom.topPanel.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    });
  });

  // Hover/press feedback, registered once on the document.
  document.addEventListener("pointerover", handlePointerOver);
  document.addEventListener("pointerout", handlePointerOut);
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);

  // Follow live changes to the reduced-motion preference.
  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", function (event) {
      prefersReducedMotion = event.matches;
      if (prefersReducedMotion) stopAmbientAnimations();
    });
  }
}

/* ---------------------------------------------------------
   7. Startup
   --------------------------------------------------------- */

function removeSplash() {
  if (!dom.splash) return;
  dom.splash.remove();
}

function playEntrance() {
  if (!dom.splash || !canAnimate()) {
    removeSplash();
    return;
  }

  const timeline = window.gsap.timeline({
    defaults: { ease: "power2.out" },
    onComplete: removeSplash,
  });

  timeline
    .fromTo(dom.splash, { opacity: 0 }, { opacity: 1, duration: 0.18 })
    .fromTo(
      dom.splashLeaf,
      { opacity: 0, scale: 0.84 },
      { opacity: 1, scale: 1, duration: 0.34, ease: "power2.out" }
    )
    .fromTo(dom.splashWord, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28 }, "-=0.1")
    .to(dom.splashBarFill, { width: "100%", duration: 0.72, ease: "power1.inOut" }, "-=0.02")
    .to(dom.splash, { opacity: 0, duration: 0.24, ease: "power1.in" })
    .from(
      dom.shell,
      { opacity: 0, y: 14, duration: 0.34, clearProps: "opacity,transform" },
      "-=0.08"
    );

  staggerRows(Array.from(dom.list.children));
}

function init() {
  tasks = loadTasks();
  saveTasks(); // ensures first-visit examples are stored, so they never return

  renderList({ animate: false });
  refreshDerived({ animatePriorities: false });
  renderIcons();
  wireEvents();

  playEntrance();
  animateWaves();
}

// Small debug helper, documented in the README.
window.Mint = {
  getTasks: function () {
    return tasks.slice();
  },
  reset: function () {
    tasks = [];
    saveTasks(); // store an empty list so the examples do not come back
    setFilter("all", { animate: false });
    refreshDerived();
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
