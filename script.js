/* ================================================================
   HABIT TRACKER — script.js
   Vanilla JS, no external AI/API, rule-based NL parsing
   ================================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   CONSTANTS & HELPERS
──────────────────────────────────────────────────────────────── */

const STORAGE_KEY   = 'habitTracker_habits';
const HISTORY_KEY   = 'habitTracker_history'; // { "YYYY-MM-DD": { habitId: bool } }
const DAYS_SHOWN    = 7;   // how many days to display in weekly chart

/** Returns today's date as "YYYY-MM-DD" */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Returns a Date shifted by `n` days from today */
function offsetDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Generate a short unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ────────────────────────────────────────────────────────────────
   STORAGE
──────────────────────────────────────────────────────────────── */

/** Load habits array from localStorage */
function loadHabits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

/** Save habits array to localStorage */
function saveHabits(habits) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

/** Load history map from localStorage */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
  } catch { return {}; }
}

/** Save history map to localStorage */
function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

/** Mark a habit as done/undone for today */
function setHabitStatus(habitId, done) {
  const history = loadHistory();
  const today   = todayKey();
  if (!history[today]) history[today] = {};
  history[today][habitId] = done;
  saveHistory(history);
}

/** Return true/false for a habit on a given date key */
function getHabitStatus(habitId, dateKey) {
  const history = loadHistory();
  return !!(history[dateKey] && history[dateKey][habitId]);
}

/** Calculate current consecutive-day streak for a habit */
function calcStreak(habitId) {
  let streak = 0;
  for (let i = 0; i >= -365; i--) {
    const key = offsetDate(i);
    if (getHabitStatus(habitId, key)) {
      streak++;
    } else {
      // Forgive today not being marked yet — stop on prior missed day
      if (i < 0) break;
    }
  }
  return streak;
}

/** Return array of 7 booleans (oldest→newest) for the weekly chart */
function weeklyData(habitId) {
  const data = [];
  for (let i = -(DAYS_SHOWN - 1); i <= 0; i++) {
    data.push(getHabitStatus(habitId, offsetDate(i)));
  }
  return data;
}

/* ────────────────────────────────────────────────────────────────
   FUZZY MATCHING — simple character-overlap similarity (Dice coeff)
──────────────────────────────────────────────────────────────── */

/**
 * Returns bigrams of a string (e.g. "minum" → ["mi","in","nu","um"])
 */
function bigrams(str) {
  const s = str.toLowerCase().replace(/\s+/g, ' ').trim();
  const result = [];
  for (let i = 0; i < s.length - 1; i++) result.push(s.slice(i, i+2));
  return result;
}

/**
 * Sørensen-Dice coefficient between two strings.
 * Returns 0.0 – 1.0. 1.0 = identical.
 */
function diceCoeff(a, b) {
  const ba = bigrams(a), bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const setA = new Map();
  ba.forEach(g => setA.set(g, (setA.get(g) || 0) + 1));
  let intersect = 0;
  bb.forEach(g => {
    const n = setA.get(g);
    if (n) { intersect++; setA.set(g, n - 1); }
  });
  return (2 * intersect) / (ba.length + bb.length);
}

/** Threshold below which we ask the user to confirm the match */
const MATCH_THRESHOLD = 0.30;

/* ────────────────────────────────────────────────────────────────
   RULE-BASED NL PARSER
   Structured as four explicit reasoning steps:
   1. Context   — load current state
   2. Parsing   — detect intent + extract habit reference
   3. Validation — confirm ambiguous matches
   4. Response  — produce motivational feedback
──────────────────────────────────────────────────────────────── */

/**
 * Keywords that signal "add a new habit" intent (multi-language).
 */
const ADD_KEYWORDS = [
  'tambah', 'buat', 'bikin', 'create', 'add', 'new habit', 'habit baru',
  'mulai habit', 'mau habit', 'pengen habit', 'ingin habit', 'cobain habit'
];

/**
 * Keywords that signal "mark as done" intent.
 */
const DONE_KEYWORDS = [
  'udah', 'sudah', 'selesai', 'done', 'finished', 'completed', 'checked',
  'beres', 'kelar', 'habis', 'oke', 'ok', 'berhasil', 'sukses',
  'tadi', 'barusan', 'abis', 'alhamdulillah'
];

/**
 * Keywords that signal "not done / missed" intent.
 */
const MISS_KEYWORDS = [
  'belum', 'lupa', 'skip', 'missed', 'gagal', 'nggak', 'tidak', 'gak',
  'ga ', 'ga,', 'ga.', 'belum sempat', 'blm', 'blom', 'ga sempet',
  'nggak sempet'
];

/** Tokenise: lowercase + strip punctuation except spaces */
function normalise(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
}

/** Detect if text contains any keyword from a list */
function containsAny(text, keywords) {
  const t = normalise(text);
  return keywords.some(kw => t.includes(kw));
}

/**
 * stripIntentWords — remove obvious intent/filler words from text
 * so what remains is more likely the habit name.
 */
const FILLER_PATTERNS = [
  /\b(udah|sudah|selesai|done|finished|completed|beres|kelar|tadi|barusan|abis)\b/gi,
  /\b(belum|lupa|skip|missed|gagal|blm|blom)\b/gi,
  /\b(tambah|buat|bikin|create|add|mulai|cobain)\b/gi,
  /\b(habit\s*(baru)?|new\s*habit)\b/gi,
  /\b(aku|gue|gw|saya|hari\s*ini|today|tadi|mau|pengen|ingin)\b/gi,
  /\bmenit\b.*$/gi,   // strip "X menit" suffixes
  /\d+\s*(menit|jam|kali|x|times|minutes|hours)/gi,
];

function stripFillers(text) {
  let t = normalise(text);
  FILLER_PATTERNS.forEach(re => { t = t.replace(re, ' '); });
  return t.replace(/\s+/g, ' ').trim();
}

/* ── STEP 4 helpers: motivational response templates ───────────── */

const TEMPLATES_DONE = {
  long:   [ // streak >= 7
    '🔥 {name} — {streak} days straight! You\'re on fire, keep it up!',
    '🏆 {streak}-day streak on "{name}"! Incredible consistency!',
    '⚡ {streak} days in a row for "{name}"! Nothing can stop you!',
  ],
  mid:    [ // streak 3-6
    '✅ Nice! "{name}" done — {streak} days running!',
    '💪 "{name}" checked off! {streak}-day streak, you\'re building momentum!',
    '🌟 Great job on "{name}"! {streak} days and counting!',
  ],
  start:  [ // streak 1-2
    '✅ "{name}" done for today! Great start!',
    '🌱 First step on "{name}" today — every journey starts here!',
    '👏 "{name}" completed! One day at a time!',
  ],
};

const TEMPLATES_MISS = [
  '😌 No worries — "{name}" is waiting for you. Tomorrow is a new chance!',
  '🌧️ Missed "{name}" today, but you\'re still here. That counts for something.',
  '💙 Life happens. "{name}" will be there tomorrow — reset and go again!',
];

const TEMPLATES_ADD = [
  '🌱 New habit "{name}" added! Consistency is your superpower.',
  '🎯 "{name}" is on your list! Small steps lead to big changes.',
  '✨ "{name}" created! You\'re investing in yourself.',
];

/**
 * Pick a motivational message for the given action + streak.
 */
function pickMessage(action, habitName, streak) {
  let pool;
  if (action === 'done') {
    if (streak >= 7)     pool = TEMPLATES_DONE.long;
    else if (streak >= 3) pool = TEMPLATES_DONE.mid;
    else                  pool = TEMPLATES_DONE.start;
  } else if (action === 'miss') {
    pool = TEMPLATES_MISS;
  } else {
    pool = TEMPLATES_ADD;
  }
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace('{name}', habitName).replace('{streak}', streak);
}

/* ────────────────────────────────────────────────────────────────
   PARSE ENTRY POINT
   Called when the user submits text. Runs the 4-step pipeline.
   Returns an action object or null (when dialog is shown instead).
──────────────────────────────────────────────────────────────── */

/**
 * STEP 1 — CONTEXT
 * Load the current habit list and today's completion status.
 */
function contextStep() {
  const habits  = loadHabits();
  const today   = todayKey();
  const history = loadHistory();
  const todayStatus = (history[today] || {});
  return { habits, today, todayStatus };
}

/**
 * STEP 2 — PARSING
 * Detect intent (add / done / miss) and extract a habit reference.
 * @returns {{ intent: 'add'|'done'|'miss', query: string, candidates: object[] }}
 */
function parsingStep(rawText, habits) {
  const isAdd  = containsAny(rawText, ADD_KEYWORDS);
  const isMiss = !isAdd && containsAny(rawText, MISS_KEYWORDS);
  const intent = isAdd ? 'add' : (isMiss ? 'miss' : 'done');

  // Strip filler words to get the core habit-name query
  const query = stripFillers(rawText);

  // Score all existing habits against the query
  const scored = habits.map(h => ({
    habit: h,
    score: diceCoeff(query, h.name),
  })).sort((a, b) => b.score - a.score);

  // Keep candidates above 15% similarity (soft floor for dialog choices)
  const candidates = scored.filter(s => s.score >= 0.15).slice(0, 3);

  return { intent, query, candidates };
}

/**
 * STEP 3 — VALIDATION
 * If the best match is below the confidence threshold, show a dialog.
 * Returns the resolved habit (or null if we need the dialog to decide).
 */
function validationStep(intent, query, candidates, habits) {
  if (intent === 'add') return { resolved: null, needsDialog: false }; // adding = no matching needed

  const best = candidates[0];

  if (!best || best.score < MATCH_THRESHOLD) {
    // No confident match — ask user
    return { resolved: null, needsDialog: true };
  }

  return { resolved: best.habit, needsDialog: false };
}

/* ────────────────────────────────────────────────────────────────
   MAIN SUBMIT HANDLER
──────────────────────────────────────────────────────────────── */

let pendingDialog = null; // holds { query, intent, resolve } while dialog is open

function handleNLSubmit() {
  const input   = document.getElementById('nlInput');
  const rawText = input.value.trim();
  if (!rawText) return;

  // ── STEP 1: Context ────────────────────────────────────────────
  const { habits } = contextStep();

  // ── STEP 2: Parsing ────────────────────────────────────────────
  const { intent, query, candidates } = parsingStep(rawText, habits);

  // ── STEP 3: Validation ─────────────────────────────────────────
  const { resolved, needsDialog } = validationStep(intent, query, candidates, habits);

  if (intent === 'add') {
    // Adding a new habit — habit name is the stripped query (or full text if query is short)
    const nameRaw    = query.length >= 2 ? query : rawText;
    const habitName  = capitalise(nameRaw);
    executeAction({ intent: 'add', habitName, fromNL: true });
    input.value = '';
    return;
  }

  if (needsDialog) {
    showConfirmDialog(query, intent, candidates, habits);
    input.value = '';
    return;
  }

  // ── STEP 4 happens inside executeAction ────────────────────────
  executeAction({ intent, habitName: resolved.name, habitId: resolved.id });
  input.value = '';
}

/* ────────────────────────────────────────────────────────────────
   EXECUTE ACTION
   Carries out the resolved intent and triggers the Response step.
──────────────────────────────────────────────────────────────── */

function executeAction({ intent, habitName, habitId, fromNL }) {
  let habit;

  if (intent === 'add') {
    const { habit: h, isNew } = createHabit(habitName);
    habit = h;
    if (!isNew) {
      showFeedback(`"${habitName}" already exists in your list.`, true);
      return;
    }
  } else {
    const habits = loadHabits();
    habit = habits.find(h => h.id === habitId) || habits.find(h => h.name === habitName);
    if (!habit) {
      showFeedback(`Habit "${habitName}" not found. Try again.`, true);
      return;
    }
    const done = (intent === 'done');
    setHabitStatus(habit.id, done);
    // Reflect checkbox state in the DOM quickly
    const cb = document.querySelector(`[data-habit-id="${habit.id}"] .habit-checkbox`);
    if (cb) cb.checked = done;
  }

  // ── STEP 4: Response ───────────────────────────────────────────
  // Generate motivational message based on action + current streak
  const streak  = (intent === 'add') ? 0 : calcStreak(habit.id);
  const message = pickMessage(intent, habit.name, streak);
  showFeedback(message, false);

  // Re-render the full UI to reflect changes
  renderAll();
}

/* ────────────────────────────────────────────────────────────────
   CONFIRMATION DIALOG (Validation step — ambiguous matches)
──────────────────────────────────────────────────────────────── */

function showConfirmDialog(query, intent, candidates, habits) {
  const overlay    = document.getElementById('confirmDialog');
  const bodyEl     = document.getElementById('dialogBody');
  const optionsEl  = document.getElementById('dialogOptions');
  const createBtn  = document.getElementById('dialogCreateNew');
  const cancelBtn  = document.getElementById('dialogCancel');

  bodyEl.textContent = `I couldn't confidently match "${query}" to any habit. Did you mean one of these?`;
  optionsEl.innerHTML = '';

  if (candidates.length === 0) {
    bodyEl.textContent = `No habits matched "${query}". Create it as a new habit?`;
    createBtn.style.display = '';
  } else {
    candidates.forEach(({ habit }) => {
      const btn = document.createElement('button');
      btn.className = 'dialog-option-btn';
      btn.textContent = habit.name;
      btn.addEventListener('click', () => {
        closeDialog(overlay);
        executeAction({ intent, habitName: habit.name, habitId: habit.id });
      });
      optionsEl.appendChild(btn);
    });
    createBtn.style.display = '';
  }

  // "Create as new" button — use stripped query as the new habit name
  createBtn.onclick = () => {
    closeDialog(overlay);
    const habitName = capitalise(query.length >= 2 ? query : 'New Habit');
    executeAction({ intent: 'add', habitName });
  };

  cancelBtn.onclick = () => closeDialog(overlay);

  // Close on backdrop click
  overlay.onclick = (e) => { if (e.target === overlay) closeDialog(overlay); };

  openDialog(overlay);
  overlay.querySelector('.dialog-option-btn, .dialog-new-btn')?.focus();
}

function openDialog(overlayEl) {
  overlayEl.hidden = false;
  overlayEl.classList.add('is-open');
}

function closeDialog(overlayEl) {
  overlayEl.hidden = true;
  overlayEl.classList.remove('is-open');
}

/* ────────────────────────────────────────────────────────────────
   FEEDBACK AREA
──────────────────────────────────────────────────────────────── */

let feedbackTimer = null;

function showFeedback(message, isError) {
  const area = document.getElementById('feedbackArea');
  area.textContent = message;
  area.className   = 'feedback-area' + (isError ? ' error' : '');
  area.hidden      = false;
  // Force re-trigger animation
  area.style.animation = 'none';
  area.offsetHeight; // reflow
  area.style.animation = '';

  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { area.hidden = true; }, 6000);
}

/* ────────────────────────────────────────────────────────────────
   HABIT CRUD
──────────────────────────────────────────────────────────────── */

/**
 * createHabit — returns { habit, isNew } so callers can differentiate.
 * Does NOT render or show feedback; caller is responsible for both.
 */
function createHabit(name) {
  const habits = loadHabits();
  // Prevent exact duplicate names (case-insensitive)
  const existing = habits.find(h => h.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return { habit: existing, isNew: false };
  }
  const habit = { id: uid(), name, createdAt: Date.now() };
  habits.push(habit);
  saveHabits(habits);
  return { habit, isNew: true };
}

function deleteHabit(habitId) {
  let habits = loadHabits();
  habits = habits.filter(h => h.id !== habitId);
  saveHabits(habits);
  // Also clean up history for this habit (optional — keep history clean)
  const history = loadHistory();
  Object.keys(history).forEach(day => { delete history[day][habitId]; });
  saveHistory(history);
  renderAll();
}

function renameHabit(habitId, newName) {
  const habits = loadHabits();
  const habit  = habits.find(h => h.id === habitId);
  if (habit) { habit.name = newName; saveHabits(habits); renderAll(); }
}

/* ────────────────────────────────────────────────────────────────
   EDIT MODAL
──────────────────────────────────────────────────────────────── */

let editingHabitId = null;

function openEditModal(habitId) {
  const habits = loadHabits();
  const habit  = habits.find(h => h.id === habitId);
  if (!habit) return;
  editingHabitId = habitId;
  const input = document.getElementById('editHabitInput');
  input.value = habit.name;
  openDialog(document.getElementById('editModal'));
  input.focus();
  input.select();
}

function closeEditModal() {
  closeDialog(document.getElementById('editModal'));
  editingHabitId = null;
}

/* ────────────────────────────────────────────────────────────────
   CHART INSTANCES — keep references so we can destroy/recreate
──────────────────────────────────────────────────────────────── */

const chartInstances = {}; // { habitId: Chart }

function destroyChart(habitId) {
  if (chartInstances[habitId]) {
    chartInstances[habitId].destroy();
    delete chartInstances[habitId];
  }
}

/**
 * Render a 7-day mini bar chart inside `canvasEl` for a given habit.
 */
function renderMiniChart(canvasEl, habitId) {
  destroyChart(habitId); // ensure no duplicate

  const data   = weeklyData(habitId); // [bool×7], oldest→newest
  const labels = [];
  for (let i = -(DAYS_SHOWN - 1); i <= 0; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    labels.push(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]);
  }

  chartInstances[habitId] = new Chart(canvasEl, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: data.map(v => v ? 1 : 0),
        backgroundColor: data.map(v =>
          v ? 'rgba(14,149,148,0.8)' : 'rgba(14,149,148,0.12)'
        ),
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 1 },
      },
      animation: false,
    },
  });
}

/* ────────────────────────────────────────────────────────────────
   RENDER
──────────────────────────────────────────────────────────────── */

function capitalise(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderAll() {
  renderHeader();
  renderSummary();
  renderHabitList();
}

function renderHeader() {
  const el = document.getElementById('headerDate');
  const d  = new Date();
  el.textContent = d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

function renderSummary() {
  const habits = loadHabits();
  const today  = todayKey();

  const done = habits.filter(h => getHabitStatus(h.id, today));
  const pct  = habits.length ? Math.round((done.length / habits.length) * 100) : 0;

  let longest = 0;
  habits.forEach(h => { const s = calcStreak(h.id); if (s > longest) longest = s; });

  document.getElementById('overallPct').textContent    = `${pct}%`;
  document.getElementById('totalHabits').textContent   = habits.length;
  document.getElementById('longestStreak').textContent = `${longest} 🔥`;
}

function renderHabitList() {
  const habits    = loadHabits();
  const today     = todayKey();
  const listEl    = document.getElementById('habitList');
  const emptyEl   = document.getElementById('emptyState');

  // Destroy all existing chart instances before re-render
  Object.keys(chartInstances).forEach(id => destroyChart(id));

  listEl.innerHTML = '';

  if (habits.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  habits.forEach(habit => {
    const isDone  = getHabitStatus(habit.id, today);
    const streak  = calcStreak(habit.id);

    const card = document.createElement('div');
    card.className = `habit-card${isDone ? ' done' : ' missed'}`;
    card.setAttribute('data-habit-id', habit.id);

    card.innerHTML = `
      <div class="habit-card-top">
        <label class="habit-check-label" for="cb-${habit.id}">
          <input
            type="checkbox"
            class="habit-checkbox"
            id="cb-${habit.id}"
            data-id="${habit.id}"
            ${isDone ? 'checked' : ''}
            aria-label="Mark ${habit.name} as done"
          />
          <span class="habit-name">${escapeHtml(habit.name)}</span>
        </label>
        <div class="habit-actions">
          <button
            class="habit-action-btn edit"
            data-id="${habit.id}"
            aria-label="Rename ${habit.name}"
            title="Rename"
          >✏️</button>
          <button
            class="habit-action-btn delete"
            data-id="${habit.id}"
            aria-label="Delete ${habit.name}"
            title="Delete"
          >🗑️</button>
        </div>
      </div>
      <div class="habit-meta">
        <span class="streak-badge">
          <span class="streak-fire">🔥</span>
          ${streak} day${streak !== 1 ? 's' : ''}
        </span>
        <span class="habit-status-tag ${isDone ? 'done' : 'pending'}">
          ${isDone ? '✓ Done' : '○ Pending'}
        </span>
      </div>
      <div class="habit-chart-wrap">
        <canvas id="chart-${habit.id}" aria-label="7-day completion chart for ${escapeHtml(habit.name)}" role="img"></canvas>
      </div>
    `;

    listEl.appendChild(card);

    // Render mini chart
    const canvas = document.getElementById(`chart-${habit.id}`);
    renderMiniChart(canvas, habit.id);
  });

  // Attach checkbox listeners
  listEl.querySelectorAll('.habit-checkbox').forEach(cb => {
    cb.addEventListener('change', e => {
      const id = e.target.getAttribute('data-id');
      setHabitStatus(id, e.target.checked);
      const streak  = calcStreak(id);
      const habits  = loadHabits();
      const habit   = habits.find(h => h.id === id);
      const action  = e.target.checked ? 'done' : 'miss';
      const message = pickMessage(action, habit ? habit.name : id, streak);
      showFeedback(message, false);
      renderAll();
    });
  });

  // Attach edit listeners
  listEl.querySelectorAll('.habit-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', e => {
      openEditModal(e.currentTarget.getAttribute('data-id'));
    });
  });

  // Attach delete listeners
  listEl.querySelectorAll('.habit-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      const id   = e.currentTarget.getAttribute('data-id');
      const name = loadHabits().find(h => h.id === id)?.name || 'this habit';
      if (confirm(`Delete "${name}"? This cannot be undone.`)) {
        deleteHabit(id);
        showFeedback(`"${name}" removed from your habits.`, false);
      }
    });
  });
}

/** Basic HTML escaping to prevent XSS from user-entered names */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ────────────────────────────────────────────────────────────────
   ADD HABIT BUTTON (manual fallback)
──────────────────────────────────────────────────────────────── */

function handleAddHabit() {
  const input = document.getElementById('addHabitInput');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  const { habit, isNew } = createHabit(capitalise(name));
  if (!isNew) {
    showFeedback(`"${habit.name}" already exists in your list.`, true);
    return;
  }
  showFeedback(pickMessage('add', habit.name, 0), false);
  input.value = '';
  renderAll();
}

/* ────────────────────────────────────────────────────────────────
   KEYBOARD / EVENT WIRING
──────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  // NL input — submit on Enter or button click
  document.getElementById('nlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleNLSubmit(); }
  });
  document.getElementById('nlSubmit').addEventListener('click', handleNLSubmit);

  // Manual add habit — submit on Enter or button click
  document.getElementById('addHabitInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddHabit(); }
  });
  document.getElementById('addHabitBtn').addEventListener('click', handleAddHabit);

  // Edit modal — save
  document.getElementById('editSaveBtn').addEventListener('click', () => {
    const name = document.getElementById('editHabitInput').value.trim();
    if (!name) return;
    renameHabit(editingHabitId, capitalise(name));
    showFeedback(`Habit renamed to "${capitalise(name)}".`, false);
    closeEditModal();
  });

  // Edit modal — cancel
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);

  // Edit modal — Enter key
  document.getElementById('editHabitInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('editSaveBtn').click(); }
    if (e.key === 'Escape') closeEditModal();
  });

  // Edit modal — backdrop click
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editModal')) closeEditModal();
  });

  // Escape key closes any open dialog
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDialog(document.getElementById('editModal'));
      closeDialog(document.getElementById('confirmDialog'));
    }
  });

  // Initial render
  renderAll();
});
