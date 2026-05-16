import './styles.css';

type Priority = 'low' | 'normal' | 'high';
type Pane = 'capture' | 'reminders' | 'learning';
type ReminderFilter = 'open' | 'today' | 'upcoming' | 'done';

type Reminder = {
  id: string;
  title: string;
  detail: string;
  dueAt: string;
  priority: Priority;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  notifiedAt?: string;
};

type LearningNote = {
  id: string;
  title: string;
  body: string;
  category: string;
  source: string;
  nextReviewAt: string;
  reviewCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

type PersistedData = {
  reminders: Reminder[];
  notes: LearningNote[];
};

type AppState = PersistedData & {
  activePane: Pane;
  reminderFilter: ReminderFilter;
  query: string;
  notice: string;
  editingReminderId: string | null;
  editingNoteId: string | null;
};

const STORAGE_KEY = 'recall-desk-data-v1';
const REVIEW_STEPS = [1, 3, 7, 14, 30, 60];

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root was not found.');
}

const app = appRoot;
const persistedData = loadData();

const state: AppState = {
  ...persistedData,
  activePane: 'capture',
  reminderFilter: 'open',
  query: '',
  notice: '',
  editingReminderId: null,
  editingNoteId: null
};

function loadData(): PersistedData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { reminders: [], notes: [] };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedData>;
    return {
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch {
    return { reminders: [], notes: [] };
  }
}

function saveData(): void {
  const data: PersistedData = {
    reminders: state.reminders,
    notes: state.notes
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function makeId(): string {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character] ?? character;
  });
}

function plain(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toInputDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function toInputTime(date: Date): string {
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0')
  ].join(':');
}

function fromDateTimeInputs(dateValue: string, timeValue: string): string {
  const fallback = addDays(new Date(), 1);
  fallback.setHours(9, 0, 0, 0);

  if (!dateValue) {
    return fallback.toISOString();
  }

  const time = timeValue || '09:00';
  const local = new Date(`${dateValue}T${time}:00`);
  return Number.isNaN(local.getTime()) ? fallback.toISOString() : local.toISOString();
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'No date';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'No date';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isToday(value: string): boolean {
  return startOfDay(new Date(value)).getTime() === startOfDay(new Date()).getTime();
}

function isOverdue(value: string): boolean {
  return new Date(value).getTime() < Date.now();
}

function isDueForReview(note: LearningNote): boolean {
  return new Date(note.nextReviewAt).getTime() <= Date.now();
}

function matchesQuery(text: string): boolean {
  const query = state.query.toLowerCase();
  return !query || text.toLowerCase().includes(query);
}

function setNotice(message: string): void {
  state.notice = message;
  render();
  window.setTimeout(() => {
    if (state.notice === message) {
      state.notice = '';
      render();
    }
  }, 3200);
}

function sortedReminders(): Reminder[] {
  return [...state.reminders].sort((first, second) => {
    if (first.completed !== second.completed) {
      return first.completed ? 1 : -1;
    }
    return new Date(first.dueAt).getTime() - new Date(second.dueAt).getTime();
  });
}

function filteredReminders(): Reminder[] {
  return sortedReminders().filter((reminder) => {
    const searchable = `${reminder.title} ${reminder.detail} ${reminder.priority}`;
    const filterMatch =
      state.reminderFilter === 'done'
        ? reminder.completed
        : state.reminderFilter === 'today'
          ? !reminder.completed && isToday(reminder.dueAt)
          : state.reminderFilter === 'upcoming'
            ? !reminder.completed && !isToday(reminder.dueAt) && !isOverdue(reminder.dueAt)
            : !reminder.completed;

    return filterMatch && matchesQuery(searchable);
  });
}

function sortedNotes(): LearningNote[] {
  return [...state.notes].sort((first, second) => {
    if (first.pinned !== second.pinned) {
      return first.pinned ? -1 : 1;
    }
    if (isDueForReview(first) !== isDueForReview(second)) {
      return isDueForReview(first) ? -1 : 1;
    }
    return new Date(first.nextReviewAt).getTime() - new Date(second.nextReviewAt).getTime();
  });
}

function filteredNotes(): LearningNote[] {
  return sortedNotes().filter((note) =>
    matchesQuery(`${note.title} ${note.body} ${note.category} ${note.source}`)
  );
}

function getStats() {
  const openReminders = state.reminders.filter((reminder) => !reminder.completed);
  const dueToday = openReminders.filter((reminder) => isToday(reminder.dueAt)).length;
  const overdue = openReminders.filter((reminder) => isOverdue(reminder.dueAt)).length;
  const reviewDue = state.notes.filter(isDueForReview).length;

  return {
    openReminders: openReminders.length,
    completedReminders: state.reminders.length - openReminders.length,
    dueToday,
    overdue,
    reviewDue,
    notes: state.notes.length
  };
}

function render(): void {
  const stats = getStats();

  app.innerHTML = `
    <div class="app-frame">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">R</div>
          <div>
            <h1>Recall Desk</h1>
            <p>${escapeHtml(new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()))}</p>
          </div>
        </div>
        <nav class="nav" aria-label="Main views">
          ${renderNavButton('capture', 'Capture')}
          ${renderNavButton('reminders', 'Reminders')}
          ${renderNavButton('learning', 'Learning')}
        </nav>
        <dl class="metric-grid">
          <div>
            <dt>Open</dt>
            <dd>${stats.openReminders}</dd>
          </div>
          <div>
            <dt>Today</dt>
            <dd>${stats.dueToday}</dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>${stats.reviewDue}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>${stats.notes}</dd>
          </div>
        </dl>
        ${stats.overdue > 0 ? `<p class="sidebar-alert">${stats.overdue} overdue</p>` : ''}
      </aside>
      <main class="workspace">
        <header class="topbar">
          <label class="search-field">
            <span>Search</span>
            <input id="global-search" value="${escapeHtml(state.query)}" placeholder="reminders, ideas, sources" autocomplete="off" />
          </label>
          <div class="topbar-actions">
            <button class="ghost-button" type="button" data-action="enable-notifications">Notify</button>
            <button class="ghost-button" type="button" data-action="export-data">Export</button>
            <label class="ghost-button import-button">
              Import
              <input id="import-data" type="file" accept="application/json" />
            </label>
          </div>
        </header>
        ${state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ''}
        ${renderPane()}
      </main>
    </div>
  `;

  bindEvents();
}

function renderNavButton(pane: Pane, label: string): string {
  const active = state.activePane === pane ? ' nav-button--active' : '';
  return `<button class="nav-button${active}" type="button" data-pane="${pane}">${label}</button>`;
}

function renderPane(): string {
  if (state.activePane === 'reminders') {
    return renderRemindersPane();
  }
  if (state.activePane === 'learning') {
    return renderLearningPane();
  }
  return renderCapturePane();
}

function renderCapturePane(): string {
  return `
    <section class="content-grid content-grid--capture">
      ${renderReminderForm()}
      ${renderLearningForm()}
    </section>
    <section class="lower-grid">
      <div class="panel">
        <div class="section-heading">
          <span>Due Soon</span>
          <button class="inline-button" type="button" data-pane="reminders">Open list</button>
        </div>
        <div class="compact-list">
          ${renderCompactReminders()}
        </div>
      </div>
      <div class="panel">
        <div class="section-heading">
          <span>Review Queue</span>
          <button class="inline-button" type="button" data-pane="learning">Open notes</button>
        </div>
        <div class="compact-list">
          ${renderReviewQueue()}
        </div>
      </div>
    </section>
  `;
}

function renderReminderForm(): string {
  const editing = state.reminders.find((reminder) => reminder.id === state.editingReminderId) ?? null;
  const dueDate = editing ? new Date(editing.dueAt) : addDays(new Date(), 1);
  if (!editing) {
    dueDate.setHours(9, 0, 0, 0);
  }

  return `
    <form class="panel form-panel" id="reminder-form">
      <div class="section-heading">
        <span>${editing ? 'Edit Reminder' : 'New Reminder'}</span>
        ${editing ? '<button class="inline-button" type="button" data-action="cancel-reminder-edit">Cancel</button>' : ''}
      </div>
      <label>
        <span>Title</span>
        <input name="title" maxlength="80" required value="${escapeHtml(editing?.title ?? '')}" placeholder="Pay bill, call someone, review chapter" />
      </label>
      <label>
        <span>Details</span>
        <textarea name="detail" rows="4" maxlength="360" placeholder="Add context">${escapeHtml(editing?.detail ?? '')}</textarea>
      </label>
      <div class="field-row">
        <label>
          <span>Date</span>
          <input name="date" type="date" required value="${toInputDate(dueDate)}" />
        </label>
        <label>
          <span>Time</span>
          <input name="time" type="time" value="${toInputTime(dueDate)}" />
        </label>
      </div>
      <label>
        <span>Priority</span>
        <select name="priority">
          ${renderPriorityOption('normal', editing?.priority ?? 'normal', 'Normal')}
          ${renderPriorityOption('high', editing?.priority ?? 'normal', 'High')}
          ${renderPriorityOption('low', editing?.priority ?? 'normal', 'Low')}
        </select>
      </label>
      <button class="primary-button" type="submit">${editing ? 'Update reminder' : 'Save reminder'}</button>
    </form>
  `;
}

function renderPriorityOption(priority: Priority, selected: Priority, label: string): string {
  return `<option value="${priority}"${priority === selected ? ' selected' : ''}>${label}</option>`;
}

function renderLearningForm(): string {
  const editing = state.notes.find((note) => note.id === state.editingNoteId) ?? null;
  const reviewDate = editing ? new Date(editing.nextReviewAt) : addDays(new Date(), 1);

  return `
    <form class="panel form-panel" id="learning-form">
      <div class="section-heading">
        <span>${editing ? 'Edit Learning' : 'New Learning'}</span>
        ${editing ? '<button class="inline-button" type="button" data-action="cancel-note-edit">Cancel</button>' : ''}
      </div>
      <label>
        <span>Topic</span>
        <input name="title" maxlength="90" required value="${escapeHtml(editing?.title ?? '')}" placeholder="A concept, fact, or idea" />
      </label>
      <label>
        <span>What I learned</span>
        <textarea name="body" rows="5" maxlength="900" required placeholder="Write the idea in your own words">${escapeHtml(editing?.body ?? '')}</textarea>
      </label>
      <div class="field-row">
        <label>
          <span>Category</span>
          <input name="category" maxlength="40" value="${escapeHtml(editing?.category ?? '')}" placeholder="Work, class, book" />
        </label>
        <label>
          <span>Review</span>
          <input name="reviewDate" type="date" value="${toInputDate(reviewDate)}" />
        </label>
      </div>
      <label>
        <span>Source</span>
        <input name="source" maxlength="140" value="${escapeHtml(editing?.source ?? '')}" placeholder="Link, book, person, video" />
      </label>
      <button class="primary-button" type="submit">${editing ? 'Update learning' : 'Save learning'}</button>
    </form>
  `;
}

function renderCompactReminders(): string {
  const items = sortedReminders()
    .filter((reminder) => !reminder.completed)
    .slice(0, 5);

  if (items.length === 0) {
    return '<p class="empty-state">No active reminders.</p>';
  }

  return items
    .map(
      (reminder) => `
        <article class="compact-item">
          <div>
            <strong>${escapeHtml(reminder.title)}</strong>
            <span>${formatDateTime(reminder.dueAt)}</span>
          </div>
          <button class="small-button" type="button" data-action="complete-reminder" data-id="${reminder.id}">Done</button>
        </article>
      `
    )
    .join('');
}

function renderReviewQueue(): string {
  const items = sortedNotes().filter(isDueForReview).slice(0, 5);

  if (items.length === 0) {
    return '<p class="empty-state">No notes due for review.</p>';
  }

  return items
    .map(
      (note) => `
        <article class="compact-item">
          <div>
            <strong>${escapeHtml(note.title)}</strong>
            <span>${escapeHtml(note.category || 'Unsorted')}</span>
          </div>
          <button class="small-button" type="button" data-action="review-note" data-id="${note.id}">Review</button>
        </article>
      `
    )
    .join('');
}

function renderRemindersPane(): string {
  const reminders = filteredReminders();

  return `
    <section class="panel list-panel">
      <div class="section-heading section-heading--wide">
        <span>Reminders</span>
        <div class="segmented" role="group" aria-label="Reminder filter">
          ${renderFilterButton('open', 'Open')}
          ${renderFilterButton('today', 'Today')}
          ${renderFilterButton('upcoming', 'Upcoming')}
          ${renderFilterButton('done', 'Done')}
        </div>
      </div>
      <div class="item-list">
        ${reminders.length ? reminders.map(renderReminderCard).join('') : '<p class="empty-state">No reminders match this view.</p>'}
      </div>
    </section>
  `;
}

function renderFilterButton(filter: ReminderFilter, label: string): string {
  const active = state.reminderFilter === filter ? ' segment-button--active' : '';
  return `<button class="segment-button${active}" type="button" data-filter="${filter}">${label}</button>`;
}

function renderReminderCard(reminder: Reminder): string {
  const statusClass = reminder.completed ? ' item-card--done' : isOverdue(reminder.dueAt) ? ' item-card--overdue' : '';
  return `
    <article class="item-card${statusClass}">
      <div class="item-card__main">
        <div class="item-card__meta">
          <span class="priority priority--${reminder.priority}">${reminder.priority}</span>
          <span>${formatDateTime(reminder.dueAt)}</span>
        </div>
        <h2>${escapeHtml(reminder.title)}</h2>
        ${reminder.detail ? `<p>${escapeHtml(reminder.detail)}</p>` : ''}
      </div>
      <div class="item-card__actions">
        <button class="small-button" type="button" data-action="toggle-reminder" data-id="${reminder.id}">${reminder.completed ? 'Reopen' : 'Done'}</button>
        <button class="small-button" type="button" data-action="edit-reminder" data-id="${reminder.id}">Edit</button>
        <button class="small-button small-button--danger" type="button" data-action="delete-reminder" data-id="${reminder.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderLearningPane(): string {
  const notes = filteredNotes();

  return `
    <section class="panel list-panel">
      <div class="section-heading section-heading--wide">
        <span>Learning Notes</span>
        <button class="inline-button" type="button" data-pane="capture">New note</button>
      </div>
      <div class="item-list item-list--notes">
        ${notes.length ? notes.map(renderNoteCard).join('') : '<p class="empty-state">No learning notes match this search.</p>'}
      </div>
    </section>
  `;
}

function renderNoteCard(note: LearningNote): string {
  const reviewClass = isDueForReview(note) ? ' item-card--review' : '';
  return `
    <article class="item-card note-card${reviewClass}">
      <div class="item-card__main">
        <div class="item-card__meta">
          <span>${note.pinned ? 'Pinned' : escapeHtml(note.category || 'Unsorted')}</span>
          <span>Review ${formatDateOnly(note.nextReviewAt)}</span>
        </div>
        <h2>${escapeHtml(note.title)}</h2>
        <p>${escapeHtml(note.body)}</p>
        ${note.source ? `<div class="source-line">${escapeHtml(note.source)}</div>` : ''}
      </div>
      <div class="item-card__actions">
        <button class="small-button" type="button" data-action="review-note" data-id="${note.id}">Reviewed</button>
        <button class="small-button" type="button" data-action="pin-note" data-id="${note.id}">${note.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="small-button" type="button" data-action="edit-note" data-id="${note.id}">Edit</button>
        <button class="small-button small-button--danger" type="button" data-action="delete-note" data-id="${note.id}">Delete</button>
      </div>
    </article>
  `;
}

function bindEvents(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach((button) => {
    button.addEventListener('click', () => {
      const pane = button.dataset.pane as Pane;
      state.activePane = pane;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.reminderFilter = button.dataset.filter as ReminderFilter;
      render();
    });
  });

  app.querySelector<HTMLFormElement>('#reminder-form')?.addEventListener('submit', handleReminderSubmit);
  app.querySelector<HTMLFormElement>('#learning-form')?.addEventListener('submit', handleLearningSubmit);

  app.querySelector<HTMLInputElement>('#global-search')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    state.query = input.value;
    render();
    const search = app.querySelector<HTMLInputElement>('#global-search');
    search?.focus();
    search?.setSelectionRange(state.query.length, state.query.length);
  });

  app.querySelector<HTMLInputElement>('#import-data')?.addEventListener('change', handleImport);

  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      handleAction(button.dataset.action ?? '', button.dataset.id ?? '');
    });
  });
}

function handleReminderSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const now = new Date().toISOString();
  const title = plain(data.get('title'));

  if (!title) {
    setNotice('Reminder title is required.');
    return;
  }

  const dueAt = fromDateTimeInputs(plain(data.get('date')), plain(data.get('time')));
  const priority = plain(data.get('priority')) as Priority;
  const existing = state.reminders.find((reminder) => reminder.id === state.editingReminderId);

  if (existing) {
    existing.title = title;
    existing.detail = plain(data.get('detail'));
    existing.dueAt = dueAt;
    existing.priority = priority;
    existing.updatedAt = now;
    existing.notifiedAt = undefined;
    state.editingReminderId = null;
    setNotice('Reminder updated.');
  } else {
    state.reminders.push({
      id: makeId(),
      title,
      detail: plain(data.get('detail')),
      dueAt,
      priority,
      completed: false,
      createdAt: now,
      updatedAt: now
    });
    setNotice('Reminder saved.');
  }

  saveData();
  render();
}

function handleLearningSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const now = new Date().toISOString();
  const title = plain(data.get('title'));
  const body = plain(data.get('body'));

  if (!title || !body) {
    setNotice('Topic and learning text are required.');
    return;
  }

  const reviewDate = plain(data.get('reviewDate'));
  const nextReviewAt = reviewDate ? new Date(`${reviewDate}T09:00:00`).toISOString() : addDays(new Date(), 1).toISOString();
  const existing = state.notes.find((note) => note.id === state.editingNoteId);

  if (existing) {
    existing.title = title;
    existing.body = body;
    existing.category = plain(data.get('category'));
    existing.source = plain(data.get('source'));
    existing.nextReviewAt = nextReviewAt;
    existing.updatedAt = now;
    state.editingNoteId = null;
    setNotice('Learning note updated.');
  } else {
    state.notes.push({
      id: makeId(),
      title,
      body,
      category: plain(data.get('category')),
      source: plain(data.get('source')),
      nextReviewAt,
      reviewCount: 0,
      pinned: false,
      createdAt: now,
      updatedAt: now
    });
    setNotice('Learning note saved.');
  }

  saveData();
  render();
}

function handleAction(action: string, id: string): void {
  if (action === 'enable-notifications') {
    enableNotifications();
    return;
  }

  if (action === 'export-data') {
    exportData();
    return;
  }

  if (action === 'cancel-reminder-edit') {
    state.editingReminderId = null;
    render();
    return;
  }

  if (action === 'cancel-note-edit') {
    state.editingNoteId = null;
    render();
    return;
  }

  const reminder = state.reminders.find((item) => item.id === id);
  const note = state.notes.find((item) => item.id === id);

  switch (action) {
    case 'complete-reminder':
    case 'toggle-reminder':
      if (reminder) {
        reminder.completed = !reminder.completed;
        reminder.updatedAt = new Date().toISOString();
        saveData();
        setNotice(reminder.completed ? 'Reminder completed.' : 'Reminder reopened.');
      }
      break;
    case 'edit-reminder':
      if (reminder) {
        state.editingReminderId = reminder.id;
        state.activePane = 'capture';
        render();
      }
      break;
    case 'delete-reminder':
      state.reminders = state.reminders.filter((item) => item.id !== id);
      saveData();
      setNotice('Reminder deleted.');
      break;
    case 'review-note':
      if (note) {
        const step = REVIEW_STEPS[Math.min(note.reviewCount, REVIEW_STEPS.length - 1)];
        note.reviewCount += 1;
        note.nextReviewAt = addDays(new Date(), step).toISOString();
        note.updatedAt = new Date().toISOString();
        saveData();
        setNotice(`Next review set for ${formatDateOnly(note.nextReviewAt)}.`);
      }
      break;
    case 'pin-note':
      if (note) {
        note.pinned = !note.pinned;
        note.updatedAt = new Date().toISOString();
        saveData();
        setNotice(note.pinned ? 'Note pinned.' : 'Note unpinned.');
      }
      break;
    case 'edit-note':
      if (note) {
        state.editingNoteId = note.id;
        state.activePane = 'capture';
        render();
      }
      break;
    case 'delete-note':
      state.notes = state.notes.filter((item) => item.id !== id);
      saveData();
      setNotice('Learning note deleted.');
      break;
    default:
      break;
  }
}

async function enableNotifications(): Promise<void> {
  if (!('Notification' in window)) {
    setNotice('This browser does not support notifications.');
    return;
  }

  if (Notification.permission === 'granted') {
    setNotice('Notifications are already enabled.');
    return;
  }

  const permission = await Notification.requestPermission();
  setNotice(permission === 'granted' ? 'Notifications enabled.' : 'Notifications were not enabled.');
}

function exportData(): void {
  const blob = new Blob([JSON.stringify({ reminders: state.reminders, notes: state.notes }, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `recall-desk-${toInputDate(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setNotice('Data exported.');
}

function handleImport(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const parsed = JSON.parse(String(reader.result ?? '{}')) as Partial<PersistedData>;
      state.reminders = Array.isArray(parsed.reminders) ? parsed.reminders : state.reminders;
      state.notes = Array.isArray(parsed.notes) ? parsed.notes : state.notes;
      saveData();
      setNotice('Data imported.');
    } catch {
      setNotice('Import file could not be read.');
    }
  });
  reader.readAsText(file);
}

function checkDueReminders(): void {
  const due = state.reminders.filter(
    (reminder) => !reminder.completed && !reminder.notifiedAt && new Date(reminder.dueAt).getTime() <= Date.now()
  );

  if (due.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  due.forEach((reminder) => {
    reminder.notifiedAt = now;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Reminder: ${reminder.title}`, {
        body: reminder.detail || `Due ${formatDateTime(reminder.dueAt)}`
      });
    }
  });

  saveData();
  setNotice(`${due.length} reminder${due.length === 1 ? '' : 's'} due now.`);
}

render();
checkDueReminders();
window.setInterval(checkDueReminders, 30000);
