// Calendar tab — simple month-grid calendar.
// Follows the same architecture as bugs.js and team.js:
//   - module-scoped state only
//   - no imports, no API calls
//   - exports initCalendar() and refreshCalendar()

const $ = id => document.getElementById(id);

// ---- Module state (never shared outside this file) ----

const today = new Date();

let state = {
  year: today.getFullYear(),
  month: today.getMonth(), // 0-based: 0 = January
  selectedDay: null,       // day number (1–31) currently selected, or null
  liveEvents: [],          // fetched from /api/availability; merged into render
  taskEvents: [],          // fetched from /api/assignments; roadmap items with dates
  myTasks: [],             // raw task objects from /api/assignments (for the tasks card)
  me: null,                // user object passed in from app.js boot (role + id)
  teamTotal: null,         // active team member count fetched from /api/team/users (Admin only)
};

// ---- Public: accept the current user from app.js ----

/**
 * Called once from app.js after initCalendar() so the calendar module
 * knows the signed-in user's role and id without making a second auth call.
 * @param {object|null} user  The /api/auth/me user object
 */
export function setCalendarUser(user) {
  state.me = user || null;
}

// ---- Constants ----

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- Event data ----
// In-memory dummy dataset. Each entry has:
//   date: 'YYYY-MM-DD'
//   type: 'available' | 'leave' | 'meeting' | 'sprint'
//   label: short description (shown in title tooltip)
//
// To connect Google Calendar later, replace EVENTS with a fetched array
// and call render() after the fetch resolves. Nothing else needs to change.
const EVENTS = [

  // August 5
  {
    date: "2026-08-05",
    type: "meeting",
    title: "Sprint Planning",
    employee: "Anika Sharma",
    start: "09:00",
    end: "11:00"
  },
  {
    date: "2026-08-05",
    type: "sprint",
    title: "Sprint 22 Starts"
  },

  // August 6
  {
    date: "2026-08-06",
    type: "available",
    employee: "Rahul Verma"
  },

  // August 7
  {
    date: "2026-08-07",
    type: "meeting",
    title: "Design Review",
    employee: "Priya Nair",
    start: "2:00 PM",
    end: "3:30 PM"
  },

  // August 8
  {
    date: "2026-08-08",
    type: "leave",
    employee: "Jordan Lee",
    reason: "Annual Leave"
  },

  // August 11
  {
    date: "2026-08-11",
    type: "sprint",
    title: "Mid Sprint Checkpoint"
  },

  // August 12
  {
    date: "2026-08-12",
    type: "meeting",
    title: "Stakeholder Sync",
    employee: "Marcus Brown",
    start: "09:30",
    end: "11:00"
  },

  // August 13
  {
    date: "2026-08-13",
    type: "available",
    employee: "Emily Wilson"
  },

  // August 14
  {
    date: "2026-08-14",
    type: "leave",
    employee: "Sophia Davis",
    reason: "Medical Leave"
  },

  // August 15
  {
    date: "2026-08-15",
    type: "leave",
    employee: "Aarav Patel",
    reason: "Public Holiday"
  },

  // August 18
  {
    date: "2026-08-18",
    type: "meeting",
    title: "Architecture Review",
    employee: "Neha Gupta",
    start: "11:00",
    end: "12:00"
  },

  // August 19
  {
    date: "2026-08-19",
    type: "sprint",
    title: "Sprint Demo Preparation"
  },

  // August 20
  {
    date: "2026-08-20",
    type: "meeting",
    title: "Client Demo",
    employee: "David Miller",
    start: "3:00 PM",
    end: "4:30 PM"
  },

  // August 21
  {
    date: "2026-08-21",
    type: "available",
    employee: "Tanvi Joshi"
  },

  // August 22
  {
    date: "2026-08-22",
    type: "leave",
    employee: "Rohan Singh",
    reason: "Vacation"
  },

  // August 25
  {
    date: "2026-08-25",
    type: "meeting",
    title: "QA Review",
    employee: "Meera Kapoor",
    start: "10:00",
    end: "11:30"
  },

  // August 26
  {
    date: "2026-08-26",
    type: "leave",
    employee: "Karan Mehta",
    reason: "Personal Leave"
  },

  // August 27
  {
    date: "2026-08-27",
    type: "meeting",
    title: "Sprint Retrospective",
    employee: "Anika Sharma",
    start: "4:00 PM",
    end: "5:00 PM"
  },
  {
    date: "2026-08-27",
    type: "available",
    employee: "Rahul Verma"
  },

  // August 29
  {
    date: "2026-08-29",
    type: "sprint",
    title: "Sprint Wrap-up"
  }

];
// Colour tokens for each event type — single source of truth.
// Keys match the `type` field in EVENTS.
const EVENT_STYLE = {
  available: { dot: '#10b981', label: 'Available' },  // emerald
  leave:     { dot: '#f59e0b', label: 'Leave' },       // amber
  meeting:   { dot: '#6366f1', label: 'Meeting' },     // indigo
  sprint:    { dot: '#0ea5e9', label: 'Sprint' },      // sky
  task:      { dot: '#8b5cf6', label: 'Task' },        // violet — assigned roadmap items
};

/**
 * Returns the events for a given calendar date, merging three sources:
 *   1. EVENTS      — static demo/seed data (always shown)
 *   2. liveEvents  — availability records fetched from /api/availability
 *   3. taskEvents  — roadmap task start/end dates from /api/assignments
 * date string format: 'YYYY-MM-DD'
 */
function getEventsForDay(year, month, day) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const staticEvts = EVENTS.filter(e => e.date === key);
    const liveEvts   = (state.liveEvents || []).filter(e => e.date === key);
    const taskEvts   = (state.taskEvents  || []).filter(e => e.date === key);
    return [...staticEvts, ...liveEvts, ...taskEvts];
}

// ---- Public API ----

/**
 * Called once on boot by app.js.
 * Attaches a single delegated click listener on the panel so that
 * Prev / Next buttons work even after innerHTML is replaced.
 */
export function initCalendar() {
  const panel = $('tab-calendar');
  if (!panel) return;

  panel.addEventListener('click', e => {
    if (e.target.closest('#cal-prev')) {
      state.month -= 1;
      if (state.month < 0) { state.month = 11; state.year -= 1; }
      state.selectedDay = null;
      render();
    } else if (e.target.closest('#cal-next')) {
      state.month += 1;
      if (state.month > 11) { state.month = 0; state.year += 1; }
      state.selectedDay = null;
      render();
    } else if (e.target.closest('#cal-detail-close')) {
      state.selectedDay = null;
      render();
    } else if (e.target.closest('#cal-add-btn')) {
      openAddEventModal();
    } else {
      // Day cell click — data-cal-day is on every current-month cell div
      const dayCell = e.target.closest('[data-cal-day]');
      if (dayCell) {
        const d = parseInt(dayCell.dataset.calDay, 10);
        state.selectedDay = (state.selectedDay === d) ? null : d; // toggle
        render();
      }
    }
  });

  // Create the Add Event modal shell once (no-op on subsequent calls)
  initAddEventModal();
}

/**
 * Called by activateTab('calendar') in app.js each time the tab is clicked.
 * Fetches live availability AND assigned tasks from the API, merges them with
 * the static EVENTS dataset, then re-renders the current month.
 * Both fetches are silent-catch — a network error never breaks the calendar.
 */
export async function refreshCalendar() {
    const now = new Date();
    state.year  = now.getFullYear();
    state.month = now.getMonth();

    // 1. Availability records (all employees for Admin; own for Employee)
    try {
        const resp = await fetch('/api/availability').then(r => r.json());
        state.liveEvents = (resp.records || []).map(r => ({
            date:     r.date,
            type:     r.status,                 // 'available' | 'leave'
            userId:   r.userId,                 // kept for team-count fallback
            employee: r.employeeName || '',
            reason:   r.status === 'leave'
                        ? (r.leaveStart && r.leaveEnd
                            ? `On Leave (${r.leaveStart}–${r.leaveEnd})`
                            : 'On Leave')
                        : undefined,
        }));
    } catch {
        state.liveEvents = [];
    }


    // 2. Assigned roadmap tasks (the caller's own tasks; employees only see theirs)
    try {
        const resp = await fetch('/api/assignments').then(r => r.json());
        state.myTasks = resp.tasks || [];
        const taskEvts = [];
        for (const t of state.myTasks) {
            if (t.startDate && /^\d{4}-\d{2}-\d{2}$/.test(t.startDate)) {
                taskEvts.push({
                    date:   t.startDate,
                    type:   'task',
                    title:  t.name,
                    label:  t.name,
                    status: t.status,
                    taskId: t.id,
                });
            }
            // Also mark the deadline if it's a different date from start
            if (t.endDate && /^\d{4}-\d{2}-\d{2}$/.test(t.endDate) && t.endDate !== t.startDate) {
                taskEvts.push({
                    date:       t.endDate,
                    type:       'task',
                    title:      t.name + ' (deadline)',
                    label:      t.name,
                    status:     t.status,
                    taskId:     t.id,
                    isDeadline: true,
                });
            }
        }
        state.taskEvents = taskEvts;
    } catch {
        state.myTasks = [];
        state.taskEvents = [];
    }

    // 3. Team roster count (Admin/Super Admin only — 403 for Employees, silently ignored).
    // Counts only active (non-disabled) users so suspended accounts don't inflate the number.
    try {
        const resp = await fetch('/api/team/users').then(r => r.ok ? r.json() : null);
        if (resp?.users) {
            state.teamTotal = resp.users.filter(u => !u.disabled).length;
        }
    } catch {
        // Non-fatal: leaves state.teamTotal at its previous value (or null on first load)
    }

    render();
}

// ---- Rendering ----

function render() {
  const panel = $('tab-calendar');
  if (!panel) return;

  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();
  const isThisMonth = state.year === todayY && state.month === todayM;

  // Day of week the month starts on (0 = Sun)
  const firstDay = new Date(state.year, state.month, 1).getDay();
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();

  // Days in previous month (for leading ghost cells)
  const daysInPrev = new Date(state.year, state.month, 0).getDate();

  // Total cells needed (always complete rows of 7)
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  // ── Today's Status — derived from EVENTS + liveEvents ──
  // For Employees, personalise the stats to only their own data.
  const isEmployee = state.me?.role === 'Employee';
  const todayEvents = getEventsForDay(todayY, todayM, todayD);

  // Employee: personal today status derived from their own liveEvents only.
  let statAvailable, statLeave, statMeetings, TEAM_TOTAL;
  if (isEmployee) {
    const todayStr = `${todayY}-${String(todayM + 1).padStart(2,'0')}-${String(todayD).padStart(2,'0')}`;
    const myRec = state.liveEvents.find(e => e.date === todayStr);
    statAvailable = myRec?.type === 'available' ? 1 : 0;
    statLeave     = myRec?.type === 'leave'     ? 1 : 0;
    statMeetings  = todayEvents.filter(e => e.type === 'meeting').length;
    TEAM_TOTAL    = state.myTasks.length; // repurpose as task count for employee
  } else {
    statAvailable = todayEvents.filter(e => e.type === 'available').length;
    statLeave     = todayEvents.filter(e => e.type === 'leave').length;
    statMeetings  = todayEvents.filter(e => e.type === 'meeting').length;
    // Dynamic team count: prefer the value fetched from /api/team/users.
    // Fall back to the number of distinct userIds seen in liveEvents (which
    // contains every employee's availability records for Admin) when the
    // roster fetch hasn't completed yet or returned an error.
    const fallbackCount = new Set(state.liveEvents.map(e => e.userId).filter(Boolean)).size;
    TEAM_TOTAL = state.teamTotal ?? (fallbackCount || null);
  }

  // ── Monthly Insights — scoped to the displayed month ──
  // Filter EVENTS to only the current state.year + state.month.
  const monthKey = `${state.year}-${String(state.month + 1).padStart(2, '0')}`;
  const monthEvts = EVENTS.filter(e => e.date.startsWith(monthKey));

  const insightMeetings = monthEvts.filter(e => e.type === 'meeting').length;
  const insightSprints = monthEvts.filter(e => e.type === 'sprint').length;
  const insightLeave = monthEvts.filter(e => e.type === 'leave').length;
  // Availability %: available events as share of (available + leave), capped to 100.
  const insightAvailRaw = monthEvts.filter(e => e.type === 'available').length;
  const insightAvailDen = insightAvailRaw + insightLeave;
  const insightAvail = insightAvailDen === 0 ? 100
    : Math.round((insightAvailRaw / insightAvailDen) * 100);

  // Meeting Distribution: count meetings per ISO weekday 0=Sun…6=Sat.
  // We want Mon(1)…Sun(0) ordered as Mon,Tue,Wed,Thu,Fri,Sat,Sun.
  const mtgByDow = [0, 0, 0, 0, 0, 0, 0]; // index 0=Sun
  monthEvts.filter(e => e.type === 'meeting').forEach(e => {
    const dow = new Date(e.date).getDay();
    mtgByDow[dow]++;
  });
  // Reorder Mon–Sun: [Mon,Tue,Wed,Thu,Fri,Sat,Sun]
  const mtgOrdered = [1, 2, 3, 4, 5, 6, 0].map(d => mtgByDow[d]);
  const mtgDowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const mtgMax = Math.max(...mtgOrdered, 1); // avoid divide-by-zero

  panel.innerHTML = `
    <div class="space-y-5">

      <!-- ── Page header ── -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="text-xl font-semibold tracking-tight flex items-center gap-2">
            <span style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:inline-grid;place-items:center;">
              <i data-lucide="calendar-days" class="w-3.5 h-3.5" style="color:white"></i>
            </span>
            Calendar
          </h2>
          <p class="text-sm text-ink-500 mt-0.5">Monthly overview for the engineering team.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${!isThisMonth ? `
            <button id="cal-today"
                    style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;
                           border-radius:9px;background:var(--ink-900);color:white;
                           font-size:12px;font-weight:600;border:none;cursor:pointer;
                           transition:opacity .15s,transform .1s;"
                    onmouseover="this.style.opacity='.85';this.style.transform='translateY(-1px)'"
                    onmouseout="this.style.opacity='1';this.style.transform='none'">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>Back to Today
            </button>` : ''}
          <button id="cal-add-btn"
                  style="width:38px;height:38px;border-radius:50%;border:none;
                         background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;
                         display:grid;place-items:center;cursor:pointer;flex-shrink:0;
                         box-shadow:0 4px 12px rgba(99,102,241,.35);
                         transition:transform .15s,box-shadow .15s;"
                  onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 8px 20px rgba(99,102,241,.45)'"
                  onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 12px rgba(99,102,241,.35)'"
                  title="Add Event" aria-label="Add Event">
            <i data-lucide="plus" style="width:18px;height:18px;"></i>
          </button>
        </div>
      </div>

      <!-- ── Today's Status ── -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
        ${
      (isEmployee ? [
      {
        icon: 'clipboard-list',
        color: '#6366f1',
        bg: 'rgba(99,102,241,.1)',
        value: TEAM_TOTAL,
        label: 'My Tasks',
        sub: 'Assigned to me',
      },
      {
        icon: 'user-check',
        color: '#10b981',
        bg: 'rgba(16,185,129,.1)',
        value: statAvailable ? '✓' : '—',
        label: 'Available Today',
        sub: statAvailable ? 'Marked available' : 'Not set yet',
      },
      {
        icon: 'umbrella',
        color: '#f59e0b',
        bg: 'rgba(245,158,11,.1)',
        value: statLeave ? '✓' : '—',
        label: 'On Leave',
        sub: statLeave ? 'Leave recorded' : 'Not on leave',
      },
      {
        icon: 'video',
        color: '#8b5cf6',
        bg: 'rgba(139,92,246,.1)',
        value: statMeetings,
        label: 'Meetings',
        sub: 'Scheduled today',
      },
    ] : [
      {
        icon: 'users',
        color: '#6366f1',
        bg: 'rgba(99,102,241,.1)',
        value: TEAM_TOTAL,
        label: 'Total Team',
        sub: 'Active members',
      },
      {
        icon: 'user-check',
        color: '#10b981',
        bg: 'rgba(16,185,129,.1)',
        value: statAvailable,
        label: 'Available',
        sub: 'Ready today',
      },
      {
        icon: 'umbrella',
        color: '#f59e0b',
        bg: 'rgba(245,158,11,.1)',
        value: statLeave,
        label: 'On Leave',
        sub: 'Out of office',
      },
      {
        icon: 'video',
        color: '#8b5cf6',
        bg: 'rgba(139,92,246,.1)',
        value: statMeetings,
        label: 'Meetings',
        sub: 'Scheduled today',
      },
    ]).map(s => `
          <div style="background:var(--surface);border:1px solid var(--surface-border);
                      border-radius:16px;padding:18px 20px;box-shadow:var(--card-shadow);
                      transition:transform .15s,box-shadow .15s;"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px -6px rgba(16,24,40,.12)'"
               onmouseout="this.style.transform='none';this.style.boxShadow='var(--card-shadow)'">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
              <span style="width:32px;height:32px;border-radius:9px;background:${s.bg};
                           display:grid;place-items:center;flex-shrink:0;">
                <i data-lucide="${s.icon}" style="width:15px;height:15px;color:${s.color};"></i>
              </span>
              <span style="font-size:11px;font-weight:700;letter-spacing:.05em;
                           text-transform:uppercase;color:var(--ink-500);">${s.label}</span>
            </div>
            <div style="font-size:30px;font-weight:750;color:var(--ink-900);
                        letter-spacing:-.02em;line-height:1;">${s.value}</div>
            <div style="font-size:11px;color:var(--ink-400);margin-top:4px;">${s.sub}</div>
          </div>`
    ).join('')}
      </div>


      <!-- ── Monthly Insights ── -->
      <div style="background:var(--surface);border:1px solid var(--surface-border);
                  border-radius:20px;padding:20px 24px;box-shadow:var(--card-shadow);">

        <!-- Section header -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <span style="width:30px;height:30px;border-radius:9px;
                       background:linear-gradient(135deg,#6366f1,#8b5cf6);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="bar-chart-2" style="width:14px;height:14px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--ink-900);">Monthly Insights</div>
            <div style="font-size:11px;color:var(--ink-500);">${MONTH_NAMES[state.month]} ${state.year}</div>
          </div>
        </div>

        <!-- Four stat cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px;">
          ${[
      { icon: 'video', color: '#6366f1', bg: 'rgba(99,102,241,.1)', value: insightMeetings, label: 'Total Meetings', sub: 'This month' },
      { icon: 'zap', color: '#0ea5e9', bg: 'rgba(14,165,233,.1)', value: insightSprints, label: 'Sprint Events', sub: 'This month' },
      { icon: 'umbrella', color: '#f59e0b', bg: 'rgba(245,158,11,.1)', value: insightLeave, label: 'Leave Days', sub: 'Recorded' },
      { icon: 'user-check', color: '#10b981', bg: 'rgba(16,185,129,.1)', value: insightAvail + '%', label: 'Availability', sub: 'Team avg' },
    ].map(s => `
            <div style="background:var(--surface-muted);border:1px solid var(--surface-border);
                        border-radius:16px;padding:16px;box-shadow:0 1px 3px rgba(16,24,40,.05);
                        transition:transform .15s,box-shadow .15s;"
                 onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px -6px rgba(16,24,40,.12)'"
                 onmouseout="this.style.transform='none';this.style.boxShadow='0 1px 3px rgba(16,24,40,.05)'">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="width:28px;height:28px;border-radius:8px;background:${s.bg};
                             display:grid;place-items:center;flex-shrink:0;">
                  <i data-lucide="${s.icon}" style="width:13px;height:13px;color:${s.color};"></i>
                </span>
                <span style="font-size:10px;font-weight:700;letter-spacing:.05em;
                             text-transform:uppercase;color:var(--ink-500);">${s.label}</span>
              </div>
              <div style="font-size:26px;font-weight:750;color:var(--ink-900);
                          letter-spacing:-.02em;line-height:1;">${s.value}</div>
              <div style="font-size:10.5px;color:var(--ink-400);margin-top:3px;">${s.sub}</div>
            </div>`
    ).join('')}
        </div>

        <!-- Meeting Distribution chart -->
        <div style="border-top:1px solid var(--surface-border);padding-top:18px;">
          <div style="font-size:12px;font-weight:600;color:var(--ink-700);margin-bottom:12px;
                      display:flex;align-items:center;gap:6px;">
            <i data-lucide="trending-up" style="width:13px;height:13px;color:#6366f1;"></i>
            Meeting Distribution
            <span style="font-size:10px;color:var(--ink-400);font-weight:400;margin-left:2px;">by weekday</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${mtgOrdered.map((count, i) => {
      const pct = Math.round((count / mtgMax) * 100);
      const label = mtgDowLabels[i];
      const isWknd = i >= 5;
      const barColor = isWknd
        ? 'linear-gradient(90deg,#94a3b8,#cbd5e1)'
        : 'linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa)';
      const animId = 'bar-' + i + '-' + state.month + '-' + state.year;
      return `
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="width:30px;font-size:10.5px;font-weight:600;
                               color:${isWknd ? 'var(--ink-400)' : 'var(--ink-600,var(--ink-700))'};
                               text-align:right;flex-shrink:0;">${label}</span>
                  <div style="flex:1;height:10px;border-radius:999px;
                              background:var(--surface-border);overflow:hidden;">
                    <div id="${animId}"
                         style="height:100%;width:0;border-radius:999px;
                                background:${barColor};
                                transition:width .55s cubic-bezier(.4,0,.2,1) ${i * 55}ms;"></div>
                  </div>
                  <span style="width:18px;font-size:10.5px;color:var(--ink-400);
                               text-align:right;flex-shrink:0;">${count}</span>
                </div>`;
    }).join('')}
          </div>
        </div>

        <!-- Inline keyframe injection (once per render) -->
        <style>.cal-bar-animate{}</style>

      </div>

      <!-- ── Calendar card ── -->
      <div style="background:var(--surface);border:1px solid var(--surface-border);
                  border-radius:20px;overflow:hidden;box-shadow:var(--card-shadow);
                  width:100%;">

        <!-- Month navigation header -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:20px 28px;
                    background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a78bfa 100%);
                    position:relative;overflow:hidden;">

          <!-- decorative rings -->
          <div style="position:absolute;right:-40px;top:-40px;width:160px;height:160px;
                      border-radius:50%;background:rgba(255,255,255,.07);pointer-events:none;"></div>
          <div style="position:absolute;right:30px;bottom:-60px;width:120px;height:120px;
                      border-radius:50%;background:rgba(255,255,255,.05);pointer-events:none;"></div>

          <!-- Prev button -->
          <button id="cal-prev"
                  style="width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
                         background:rgba(255,255,255,.12);color:white;display:grid;place-items:center;
                         cursor:pointer;transition:background .15s,transform .1s;flex-shrink:0;"
                  onmouseover="this.style.background='rgba(255,255,255,.22)';this.style.transform='translateX(-1px)'"
                  onmouseout="this.style.background='rgba(255,255,255,.12)';this.style.transform='none'"
                  aria-label="Previous month" title="Previous month">
            <i data-lucide="chevron-left" class="w-4 h-4"></i>
          </button>

          <!-- Month / year label -->
          <div style="text-align:center;z-index:1;">
            <div style="font-size:24px;font-weight:700;color:white;letter-spacing:-.02em;line-height:1.1;">
              ${MONTH_NAMES[state.month]}
            </div>
            <div style="font-size:14px;color:rgba(255,255,255,.7);font-weight:500;margin-top:2px;">
              ${state.year}
              ${isThisMonth
      ? `<span style="display:inline-block;margin-left:8px;font-size:10px;font-weight:700;
                               letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;
                               border-radius:999px;background:rgba(255,255,255,.2);color:white;">
                     Current
                   </span>`
      : ''}
            </div>
          </div>

          <!-- Next button -->
          <button id="cal-next"
                  style="width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
                         background:rgba(255,255,255,.12);color:white;display:grid;place-items:center;
                         cursor:pointer;transition:background .15s,transform .1s;flex-shrink:0;"
                  onmouseover="this.style.background='rgba(255,255,255,.22)';this.style.transform='translateX(1px)'"
                  onmouseout="this.style.background='rgba(255,255,255,.12)';this.style.transform='none'"
                  aria-label="Next month" title="Next month">
            <i data-lucide="chevron-right" class="w-4 h-4"></i>
          </button>
        </div>

        <!-- Day-of-week header row -->
        <div style="display:grid;grid-template-columns:repeat(7,1fr);
                    border-bottom:1px solid var(--surface-border);">
          ${DAY_NAMES.map((d, i) => {
        const isWknd = i === 0 || i === 6;
        return `<div style="padding:12px 4px 10px;text-align:center;
                                font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
                                color:${isWknd ? 'var(--ink-400)' : 'var(--ink-500)'};
                                background:${isWknd ? 'var(--surface-muted)' : 'transparent'};">
                      ${d}
                    </div>`;
      }).join('')}
        </div>

        <!-- Date grid -->
        <div style="display:grid;grid-template-columns:repeat(7,1fr);">
          ${buildCells(firstDay, daysInMonth, daysInPrev, totalCells, isThisMonth, todayD)}
        </div>

        <!-- Footer strip -->
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;
                    padding:12px 24px;
                    border-top:1px solid var(--surface-border);
                    background:var(--surface-muted);">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-500);">
            <span style="width:20px;height:20px;border-radius:6px;
                         background:linear-gradient(135deg,#6366f1,#8b5cf6);
                         display:inline-block;flex-shrink:0;"></span>
            Today
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-500);">
            <span style="width:20px;height:20px;border-radius:6px;background:var(--surface-border);
                         display:inline-block;flex-shrink:0;"></span>
            Weekend
          </div>
          <!-- Event type legend -->
          ${Object.entries(EVENT_STYLE).map(([, s]) =>
        `<div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-500);">
               <span style="width:8px;height:8px;border-radius:50%;background:${s.dot};display:inline-block;flex-shrink:0;"></span>
               ${s.label}
             </div>`
      ).join('')}
          <div style="margin-left:auto;font-size:12px;color:var(--ink-400);">
            ${daysInMonth} days · Week starts Sunday
          </div>
        </div>
      </div>

      <!-- ── Day details panel ── -->
      <div id="cal-detail"></div>

      <!-- ── This Week availability ── -->
      <div id="cal-week"></div>

      <!-- ── Employee-only panels ── -->
      <div id="cal-employee-avail"></div>
      <div id="cal-employee-tasks"></div>

    </div>
  `;

  // Wire the "Back to Today" button (rendered only when not on current month)
  $('cal-today')?.addEventListener('click', () => {
    const n = new Date();
    state.year = n.getFullYear();
    state.month = n.getMonth();
    state.selectedDay = null;
    render();
  });

  window.lucide?.createIcons();
  renderDetailPanel();
  renderWeekCard();

  // Employee-only panels
  if (state.me?.role === 'Employee') {
    renderEmployeeAvailabilityPanel();
    renderEmployeeTasksCard();
  } else {
    // Clear the panels for non-employee roles so they don't persist on role switch
    const av = $('cal-employee-avail'); if (av) av.innerHTML = '';
    const tk = $('cal-employee-tasks'); if (tk) tk.innerHTML = '';
  }

  // Animate Meeting Distribution bars (CSS transition needs width to go 0 → target)
  requestAnimationFrame(() => {
    mtgOrdered.forEach((count, i) => {
      const pct = Math.round((count / mtgMax) * 100);
      const bar = document.getElementById('bar-' + i + '-' + state.month + '-' + state.year);
      if (bar) bar.style.width = pct + '%';
    });
  });
}

// ---- Grid builder ----

function buildCells(firstDay, daysInMonth, daysInPrev, totalCells, isThisMonth, todayD) {
  const cells = [];

  for (let i = 0; i < totalCells; i++) {
    if (i < firstDay) {
      // ── Leading overflow from previous month ──
      const d = daysInPrev - firstDay + i + 1;
      const wknd = i % 7 === 0 || i % 7 === 6;
      cells.push(cell(d, { overflow: true, weekend: wknd }));

    } else {
      const d = i - firstDay + 1;

      if (d > daysInMonth) {
        // ── Trailing overflow into next month ──
        const d2 = d - daysInMonth;
        const wknd = i % 7 === 0 || i % 7 === 6;
        cells.push(cell(d2, { overflow: true, weekend: wknd }));

      } else {
        // ── Current month day ──
        const isToday = isThisMonth && d === todayD;
        const wknd = i % 7 === 0 || i % 7 === 6;
        const events = getEventsForDay(state.year, state.month, d);
        const isSelected = state.selectedDay === d;
        cells.push(cell(d, { isToday, weekend: wknd, events, isSelected }));
      }
    }
  }

  return cells.join('');
}

function cell(d, { overflow = false, isToday = false, weekend = false, events = [], isSelected = false } = {}) {
  const borderRight = 'border-right:1px solid var(--surface-border);';
  const borderBottom = 'border-bottom:1px solid var(--surface-border);';

  // ── Today cell ──
  if (isToday) {
    const ring = isSelected
      ? 'box-shadow:0 0 0 3px var(--surface),0 0 0 5px #6366f1;'
      : 'box-shadow:0 4px 12px rgba(99,102,241,.45);';
    const cellBg = isSelected ? 'background:rgba(99,102,241,.06);' : 'background:transparent;';
    return `
      <div data-cal-day="${d}" style="${cellBg}${borderRight}${borderBottom}
                  padding:6px 4px 5px;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;
                  min-height:64px;gap:4px;cursor:pointer;">
        <span style="width:38px;height:38px;border-radius:10px;
                     background:linear-gradient(135deg,#6366f1,#8b5cf6);
                     color:white;font-size:14px;font-weight:700;
                     display:flex;align-items:center;justify-content:center;
                     ${ring}"
              title="Today">${d}</span>
        ${eventDots(events)}
      </div>`;
  }

  // ── Overflow cell (prev/next month) — not selectable ──
  if (overflow) {
    return `
      <div style="background:transparent;${borderRight}${borderBottom}
                  padding:6px 4px 5px;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;
                  min-height:64px;gap:4px;">
        <span style="width:38px;height:38px;border-radius:10px;
                     color:var(--ink-400);font-size:14px;
                     display:flex;align-items:center;justify-content:center;
                     cursor:default;">${d}</span>
      </div>`;
  }

  // ── Normal current-month day ──
  const textColor = weekend ? 'color:var(--ink-500);' : 'color:var(--ink-700);';
  const weekendBg = weekend ? 'var(--surface-muted)' : 'transparent';
  const cellBg = isSelected ? 'background:rgba(99,102,241,.07);' : `background:${weekendBg};`;
  const numRing = isSelected ? 'box-shadow:0 0 0 2px #6366f1;' : '';
  const hoverOut = isSelected
    ? `this.style.background='rgba(99,102,241,.12)'`
    : `this.style.background='${weekendBg}'`;

  return `
    <div data-cal-day="${d}" style="${cellBg}${borderRight}${borderBottom}
                padding:6px 4px 5px;display:flex;flex-direction:column;
                align-items:center;justify-content:center;
                min-height:64px;gap:4px;cursor:pointer;">
      <span style="width:38px;height:38px;border-radius:10px;
                   ${textColor}font-size:14px;font-weight:${weekend ? '400' : '500'};
                   display:flex;align-items:center;justify-content:center;
                   transition:background .12s,color .12s;${numRing}"
            onmouseover="this.style.background='var(--surface-border)';this.style.color='var(--ink-900)'"
            onmouseout="${hoverOut};this.style.color='${weekend ? 'var(--ink-500)' : 'var(--ink-700)'}'">
        ${d}
      </span>
      ${eventDots(events)}
    </div>`;
}

/**
 * Renders a row of coloured dots for the given events array.
 * Max 4 dots shown — if more, the last dot becomes a '+N' count.
 * Uses title attributes for accessibility / tooltip context.
 */
function eventDots(events) {
  if (!events.length) return '';

  const MAX_DOTS = 4;
  const visible = events.slice(0, MAX_DOTS);
  const overflow = events.length - MAX_DOTS;

  const dots = visible.map((ev, idx) => {
    const style = EVENT_STYLE[ev.type] || { dot: '#94a3b8', label: ev.type };
    // If this is the last visible slot AND there are hidden events, show count
    if (idx === MAX_DOTS - 1 && overflow > 0) {
      return `<span style="width:7px;height:7px;border-radius:50%;
                           background:var(--ink-400);
                           display:inline-flex;align-items:center;justify-content:center;
                           font-size:8px;color:white;font-weight:700;"
                    title="+${overflow + 1} more">+</span>`;
    }
    return `<span style="width:7px;height:7px;border-radius:50%;
                         background:${style.dot};display:inline-block;flex-shrink:0;"
                  title="${ev.title || ev.employee || ev.reason}"></span>`;
  }).join('');

  return `<div style="display:flex;align-items:center;justify-content:center;
                      gap:2px;min-height:9px;">${dots}</div>`;
}

// ---- Day details panel ----

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Mock meeting durations keyed by label — replace with real data later.
const MEETING_DURATION = {
  'Sprint Planning': '2h',
  'Design review': '1h',
  'Stakeholder sync': '1h 30m',
  'Retrospective': '1h',
  'All-hands': '1h',
  'Roadmap review': '1h',
  'Tech debt session': '2h',
};
const MEETING_TIMES = ['09:00', '10:30', '13:00', '14:30', '15:00', '16:00'];

// Rich mock data keyed by meeting label.
// Replace this map with real Google Calendar event objects later.
const MEETING_DETAILS = {
  'Sprint Planning': { time: '09:00', duration: '2h', attendees: ['Priya', 'Marcus', 'Sofia', 'Rahul'] },
  'Design review': { time: '10:30', duration: '1h', attendees: ['Anika', 'Jordan', 'Emma'] },
  'Stakeholder sync': { time: '13:00', duration: '1h 30m', attendees: ['Marcus', 'Priya', 'Rahul'] },
  'Retrospective': { time: '14:30', duration: '1h', attendees: ['Anika', 'Sofia', 'Emma', 'Jordan'] },
  'All-hands': { time: '11:00', duration: '1h', attendees: ['Full team'] },
  'Roadmap review': { time: '15:00', duration: '1h', attendees: ['Marcus', 'Priya'] },
  'Tech debt session': { time: '13:00', duration: '2h', attendees: ['Emma', 'Jordan', 'Rahul', 'Sofia'] },
};

/**
 * Renders the selected-day details card into #cal-detail.
 * Called at the end of render() so it always reflects current state.
 * Replace getEventsForDay() with a fetch/cache call here when real data arrives.
 */
function renderDetailPanel() {
  const el = $('cal-detail');
  if (!el) return;

  if (!state.selectedDay) {
    el.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--surface-border);
                  border-radius:20px;padding:20px 24px;box-shadow:var(--card-shadow);
                  display:flex;align-items:center;gap:12px;color:var(--ink-400);">
        <i data-lucide="mouse-pointer-2" style="width:18px;height:18px;flex-shrink:0;"></i>
        <span style="font-size:13px;">Click any day on the calendar to view its details.</span>
      </div>`;
    window.lucide?.createIcons();
    return;
  }

  const d = state.selectedDay;
  const dateObj = new Date(state.year, state.month, d);
  const heading = `${DOW_FULL[dateObj.getDay()]}, ${MONTH_NAMES[state.month]} ${d}, ${state.year}`;

  const events = getEventsForDay(state.year, state.month, d);
  const available = events.filter(e => e.type === 'available');
  const leave = events.filter(e => e.type === 'leave');
  const meetings = events.filter(e => e.type === 'meeting');
  const sprints = events.filter(e => e.type === 'sprint');

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--surface-border);
                border-radius:20px;overflow:hidden;box-shadow:var(--card-shadow);">

      <!-- Detail header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 24px;border-bottom:1px solid var(--surface-border);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="width:36px;height:36px;border-radius:10px;
                       background:linear-gradient(135deg,#6366f1,#8b5cf6);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="calendar" style="width:16px;height:16px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--ink-900);">${heading}</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px;">
              ${events.length === 0
      ? 'No events scheduled'
      : `${events.length} event${events.length !== 1 ? 's' : ''} scheduled`}
            </div>
          </div>
        </div>
        <button id="cal-detail-close"
                style="width:30px;height:30px;border-radius:8px;
                       border:1px solid var(--surface-border);
                       background:var(--surface-muted);display:grid;place-items:center;
                       cursor:pointer;color:var(--ink-500);transition:background .12s;"
                onmouseover="this.style.background='var(--surface-border)'"
                onmouseout="this.style.background='var(--surface-muted)'"
                title="Close details">
          <i data-lucide="x" style="width:14px;height:14px;"></i>
        </button>
      </div>

      <!-- Four section grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">
        ${detailSection({
        icon: 'user-check',
        color: '#10b981',
        bg: 'rgba(16,185,129,.05)',
        title: 'Available',
        items: available.map(e => ({
          primary: e.employee,
          secondary: 'Available today',
        })),
        empty: 'No members available',
      })}
        ${detailSection({
        icon: 'umbrella',
        color: '#f59e0b',
        bg: 'rgba(245,158,11,.05)',
        title: 'On Leave',
        items: leave.map(e => ({
          primary: e.employee,
          secondary: e.reason || 'Out of office',
        })),
        empty: 'No leave recorded',
      })}
        ${detailSection({
        icon: 'video',
        color: '#6366f1',
        bg: 'rgba(99,102,241,.05)',
        title: 'Meetings',
        items: meetings.map((e, i) => ({
          primary: e.title,
          secondary: `${e.start} - ${e.end}`,
        })),
        empty: 'No meetings scheduled',
      })}
        ${detailSection({
        icon: 'zap',
        color: '#0ea5e9',
        bg: 'rgba(14,165,233,.05)',
        title: 'Sprint',
        items: sprints.map(e => ({
          primary: e.title,
          secondary: 'Sprint milestone',
        })),
        empty: 'No sprint events',
      })}
      </div>

    </div>
  `;

  window.lucide?.createIcons();
}

/**
 * Renders one section (column) of the details panel.
 * @param {object} opts
 * @param {string}   opts.icon    Lucide icon name
 * @param {string}   opts.color   Accent hex colour
 * @param {string}   opts.bg      Section background (very light tint)
 * @param {string}   opts.title   Section heading
 * @param {Array}    opts.items   Array of { primary, secondary } rows
 * @param {string}   opts.empty   Placeholder text when items is empty
 */
function detailSection({ icon, color, bg, title, items, empty }) {
  const rows = items.length
    ? items.map(it => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;
                    border-bottom:1px solid var(--surface-border);">
          <span style="width:6px;height:6px;border-radius:50%;background:${color};
                       flex-shrink:0;margin-top:5px;"></span>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:500;color:var(--ink-900);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${it.primary}
            </div>
            <div style="font-size:11px;color:var(--ink-500);margin-top:1px;">${it.secondary}</div>
          </div>
        </div>`).join('')
    : `<div style="font-size:12px;color:var(--ink-400);padding:14px 0;text-align:center;">
         ${empty}
       </div>`;

  return `
    <div style="padding:18px 20px;border-right:1px solid var(--surface-border);background:${bg};">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="width:26px;height:26px;border-radius:7px;background:${color};
                     display:grid;place-items:center;flex-shrink:0;">
          <i data-lucide="${icon}" style="width:13px;height:13px;color:white;"></i>
        </span>
        <span style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
                     color:${color};">${title}</span>
      </div>
      <div>${rows}</div>
    </div>`;
}

// ---- This Week availability card ----

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Returns an array of 7 Date objects covering the Mon–Sun week
 * that contains the anchor date.
 * Anchor: the selected day (if any), otherwise real today.
 */
function getWeekDays() {
  let anchor;
  if (state.selectedDay) {
    anchor = new Date(state.year, state.month, state.selectedDay);
  } else {
    anchor = new Date();
  }

  // Shift back to Monday (Sun = 0 treated as previous week's Mon + 6)
  const dow = anchor.getDay();
  const diff = (dow === 0) ? -6 : 1 - dow;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/**
 * Renders the "This Week" availability card into #cal-week.
 * Called by render() so it refreshes on every state change.
 */
function renderWeekCard() {
  const el = $('cal-week');
  if (!el) return;

  const weekDays = getWeekDays();
  const realToday = new Date();

  const fmtDate = d => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const weekLabel = `${fmtDate(weekDays[0])} – ${fmtDate(weekDays[6])}, ${weekDays[6].getFullYear()}`;

  const columns = weekDays.map(date => {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const events = getEventsForDay(y, m, d);

    const isToday = date.toDateString() === realToday.toDateString();
    const isSelected = state.selectedDay === d
      && state.year === y
      && state.month === m;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    return { date, d, events, isToday, isSelected, isWeekend };
  });

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--surface-border);
                border-radius:20px;overflow:hidden;box-shadow:var(--card-shadow);">

      <!-- Card header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 24px;border-bottom:1px solid var(--surface-border);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="width:34px;height:34px;border-radius:10px;
                       background:linear-gradient(135deg,#0ea5e9,#6366f1);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="calendar-range" style="width:16px;height:16px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--ink-900);">This Week</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px;">${weekLabel}</div>
          </div>
        </div>
        ${state.selectedDay
      ? `<span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
                          color:#6366f1;background:rgba(99,102,241,.1);padding:4px 10px;
                          border-radius:999px;">Week of selected day</span>`
      : `<span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
                          color:var(--ink-400);background:var(--surface-muted);padding:4px 10px;
                          border-radius:999px;">Current week</span>`}
      </div>

      <!-- 7-column day grid -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);">
        ${columns.map(col => weekDayColumn(col)).join('')}
      </div>

    </div>
  `;

  window.lucide?.createIcons();
}

/**
 * Renders a single day column inside the week card.
 */
function weekDayColumn({ date, d, events, isToday, isSelected, isWeekend }) {
  const headBg = isToday
    ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);'
    : isSelected
      ? 'background:rgba(99,102,241,.08);'
      : isWeekend
        ? 'background:var(--surface-muted);'
        : 'background:transparent;';

  const dayNumColor = isToday
    ? 'color:white;font-weight:700;'
    : isSelected
      ? 'color:#6366f1;font-weight:700;'
      : isWeekend
        ? 'color:var(--ink-400);'
        : 'color:var(--ink-700);';

  const dowColor = isToday
    ? 'color:rgba(255,255,255,.75);'
    : 'color:var(--ink-400);';

  const borderRight = 'border-right:1px solid var(--surface-border);';
  const borderBottom = 'border-bottom:1px solid var(--surface-border);';

  // Up to 3 event pills; +N overflow indicator if more
  const MAX_ROWS = 3;
  const visible = events.slice(0, MAX_ROWS);
  const overflow = events.length - MAX_ROWS;

  const pills = visible.map(ev => {
    const s = EVENT_STYLE[ev.type] || { dot: '#94a3b8', label: ev.type };
    const name =
      ev.employee ||
      ev.title ||
      ev.reason ||
      "";
    return `
      <div style="display:flex;align-items:center;gap:5px;padding:3px 5px;
                  border-radius:6px;background:${s.dot}18;margin-bottom:3px;"
           title="${ev.title || ev.employee || ev.reason}">
        <span style="width:5px;height:5px;border-radius:50%;background:${s.dot};
                     flex-shrink:0;"></span>
        <span style="font-size:10px;font-weight:500;color:var(--ink-700);
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                     max-width:72px;">${name}</span>
      </div>`;
  }).join('');

  const overflowRow = overflow > 0
    ? `<div style="font-size:10px;color:var(--ink-400);padding:1px 4px;">+${overflow} more</div>`
    : '';

  const emptyRow = events.length === 0
    ? `<div style="font-size:10px;color:var(--ink-400);text-align:center;padding:6px 4px;">Free</div>`
    : '';

  return `
    <div style="${headBg}${borderRight}">
      <!-- Column header -->
      <div style="padding:10px 6px 8px;text-align:center;${borderBottom}">
        <div style="font-size:9.5px;font-weight:700;letter-spacing:.07em;
                    text-transform:uppercase;${dowColor}">
          ${DOW_SHORT[date.getDay()]}
        </div>
        <div style="font-size:16px;line-height:1.25;margin-top:3px;${dayNumColor}">
          ${d}
        </div>
      </div>
      <!-- Event pills -->
      <div style="padding:7px 6px;min-height:56px;">
        ${pills}${overflowRow}${emptyRow}
      </div>
    </div>`;
}

// ---- Add Event modal ----

/**
 * Injects the modal HTML into document.body exactly once.
 * Idempotent — safe to call multiple times.
 */
function initAddEventModal() {
  if (document.getElementById('cal-modal')) return;

  // Global styles for the modal animation (injected once)
  const style = document.createElement('style');
  style.id = 'cal-modal-styles';
  style.textContent = `
    @keyframes calOverlayIn { from{opacity:0} to{opacity:1} }
    @keyframes calCardIn    { from{opacity:0;transform:scale(.95) translateY(-10px)} to{opacity:1;transform:none} }
    #cal-modal { display:none; }
    #cal-modal.cal-open { display:grid; }
    #cal-f-title::placeholder,#cal-f-desc::placeholder { color:#94a3b8; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'cal-modal';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    zIndex: '9999', placeItems: 'center',
    background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(6px)',
    animation: 'calOverlayIn .18s ease both',
  });

  overlay.innerHTML = `
    <div id="cal-modal-card"
         style="background:var(--surface,white);border:1px solid var(--surface-border,#e2e8f0);
                border-radius:20px;box-shadow:0 24px 64px -12px rgba(16,24,40,.28);
                width:min(520px,94vw);overflow:hidden;
                animation:calCardIn .22s cubic-bezier(.4,0,.2,1) both;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:20px 24px;border-bottom:1px solid var(--surface-border,#e2e8f0);
                  background:linear-gradient(135deg,rgba(99,102,241,.06),rgba(139,92,246,.04));">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="width:36px;height:36px;border-radius:10px;
                       background:linear-gradient(135deg,#6366f1,#8b5cf6);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="calendar-plus" style="width:16px;height:16px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--ink-900,#0f172a);">Add Event</div>
            <div style="font-size:12px;color:var(--ink-500,#64748b);margin-top:1px;">Schedule a new calendar event</div>
          </div>
        </div>
        <button id="cal-modal-x" type="button"
                style="width:32px;height:32px;border-radius:9px;
                       border:1px solid var(--surface-border,#e2e8f0);
                       background:var(--surface-muted,#f8fafc);display:grid;place-items:center;
                       cursor:pointer;color:var(--ink-500,#64748b);transition:background .12s;"
                onmouseover="this.style.background='var(--surface-border,#e2e8f0)'"
                onmouseout="this.style.background='var(--surface-muted,#f8fafc)'">
          <i data-lucide="x" style="width:15px;height:15px;"></i>
        </button>
      </div>

      <!-- Form -->
      <form id="cal-modal-form"
            style="padding:22px 24px;display:flex;flex-direction:column;gap:16px;"
            autocomplete="off" novalidate>

        <!-- Title -->
        <div>
          <label style="display:block;font-size:12px;font-weight:600;
                        color:var(--ink-700,#334155);margin-bottom:6px;">
            Event Title <span style="color:#ef4444;">*</span>
          </label>
          <input id="cal-f-title" type="text" placeholder="e.g. Sprint Planning"
                 style="width:100%;padding:9px 12px;
                        border:1px solid var(--surface-border,#e2e8f0);
                        border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                        background:var(--surface,white);outline:none;box-sizing:border-box;
                        transition:border-color .15s,box-shadow .15s;"
                 onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                 onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'">
        </div>

        <!-- Type + Date -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;
                          color:var(--ink-700,#334155);margin-bottom:6px;">
              Event Type <span style="color:#ef4444;">*</span>
            </label>
            <select id="cal-f-type"
                    style="width:100%;padding:9px 12px;
                           border:1px solid var(--surface-border,#e2e8f0);
                           border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                           background:var(--surface,white);outline:none;
                           cursor:pointer;box-sizing:border-box;
                           transition:border-color .15s,box-shadow .15s;"
                    onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                    onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'">
              <option value="meeting">Meeting</option>
              <option value="sprint">Sprint</option>
              <option value="leave">Leave</option>
              <option value="available">Available</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;
                          color:var(--ink-700,#334155);margin-bottom:6px;">
              Date <span style="color:#ef4444;">*</span>
            </label>
            <input id="cal-f-date" type="date"
                   style="width:100%;padding:9px 12px;
                          border:1px solid var(--surface-border,#e2e8f0);
                          border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                          background:var(--surface,white);outline:none;box-sizing:border-box;
                          transition:border-color .15s,box-shadow .15s;"
                   onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                   onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'">
          </div>
        </div>

        <!-- Start + End Time -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;
                          color:var(--ink-700,#334155);margin-bottom:6px;">Start Time</label>
            <input id="cal-f-start" type="time"
                   style="width:100%;padding:9px 12px;
                          border:1px solid var(--surface-border,#e2e8f0);
                          border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                          background:var(--surface,white);outline:none;box-sizing:border-box;
                          transition:border-color .15s,box-shadow .15s;"
                   onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                   onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'">
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;
                          color:var(--ink-700,#334155);margin-bottom:6px;">End Time</label>
            <input id="cal-f-end" type="time"
                   style="width:100%;padding:9px 12px;
                          border:1px solid var(--surface-border,#e2e8f0);
                          border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                          background:var(--surface,white);outline:none;box-sizing:border-box;
                          transition:border-color .15s,box-shadow .15s;"
                   onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                   onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'">
          </div>
        </div>

        <!-- Description -->
        <div>
          <label style="display:block;font-size:12px;font-weight:600;
                        color:var(--ink-700,#334155);margin-bottom:6px;">
            Description
            <span style="font-weight:400;color:var(--ink-400,#94a3b8);">(optional)</span>
          </label>
          <textarea id="cal-f-desc" rows="3"
                    placeholder="Add any notes or agenda..."
                    style="width:100%;padding:9px 12px;
                           border:1px solid var(--surface-border,#e2e8f0);
                           border-radius:10px;font-size:13px;color:var(--ink-900,#0f172a);
                           background:var(--surface,white);outline:none;
                           resize:vertical;font-family:inherit;box-sizing:border-box;
                           transition:border-color .15s,box-shadow .15s;"
                    onfocus="this.style.borderColor='#6366f1';this.style.boxShadow='0 0 0 3px rgba(99,102,241,.15)'"
                    onblur="this.style.borderColor='var(--surface-border,#e2e8f0)';this.style.boxShadow='none'"></textarea>
        </div>

        <!-- Inline error -->
        <div id="cal-modal-err"
             style="display:none;padding:10px 14px;border-radius:10px;
                    background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);
                    font-size:12px;color:#ef4444;"></div>

      </form>

      <!-- Footer -->
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;
                  padding:16px 24px;border-top:1px solid var(--surface-border,#e2e8f0);
                  background:var(--surface-muted,#f8fafc);">
        <button id="cal-modal-cancel" type="button"
                style="padding:9px 20px;border-radius:10px;
                       border:1px solid var(--surface-border,#e2e8f0);
                       background:var(--surface,white);font-size:13px;font-weight:500;
                       color:var(--ink-700,#334155);cursor:pointer;transition:background .12s;"
                onmouseover="this.style.background='var(--surface-border,#e2e8f0)'"
                onmouseout="this.style.background='var(--surface,white)'">
          Cancel
        </button>
        <button id="cal-modal-save" type="button"
                style="padding:9px 22px;border-radius:10px;border:none;
                       background:linear-gradient(135deg,#6366f1,#8b5cf6);
                       color:white;font-size:13px;font-weight:600;cursor:pointer;
                       display:inline-flex;align-items:center;gap:6px;
                       box-shadow:0 4px 12px rgba(99,102,241,.35);
                       transition:opacity .15s,transform .1s;"
                onmouseover="this.style.opacity='.9';this.style.transform='translateY(-1px)'"
                onmouseout="this.style.opacity='1';this.style.transform='none'">
          <i data-lucide="check" style="width:14px;height:14px;"></i>
          Save Event
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  // --- Wire close actions ---
  const closeModal = () => overlay.classList.remove('cal-open');

  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('cal-modal-x').addEventListener('click', closeModal);
  document.getElementById('cal-modal-cancel').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('cal-open')) closeModal();
  });

  // --- Wire save ---
  document.getElementById('cal-modal-save').addEventListener('click', () => saveNewEvent(closeModal));
}

/**
 * Opens the Add Event modal and pre-fills the date field.
 */
function openAddEventModal() {
  initAddEventModal(); // idempotent

  // Reset form
  const fields = ['cal-f-title', 'cal-f-desc'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const type = document.getElementById('cal-f-type');
  if (type) type.value = 'meeting';
  const start = document.getElementById('cal-f-start');
  if (start) start.value = '';
  const end = document.getElementById('cal-f-end');
  if (end) end.value = '';
  const err = document.getElementById('cal-modal-err');
  if (err) err.style.display = 'none';

  // Pre-fill date: selected day first, then today
  const dateInput = document.getElementById('cal-f-date');
  if (dateInput) {
    if (state.selectedDay) {
      dateInput.value = `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(state.selectedDay).padStart(2, '0')}`;
    } else {
      const now = new Date();
      dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
  }

  const overlay = document.getElementById('cal-modal');
  overlay.classList.add('cal-open');
  window.lucide?.createIcons();
  setTimeout(() => document.getElementById('cal-f-title')?.focus(), 80);
}

/**
 * Validates the form, pushes a new entry into EVENTS, and refreshes the UI.
 * @param {Function} closeModal  Callback to close the modal overlay.
 */
function saveNewEvent(closeModal) {
  const title = document.getElementById('cal-f-title')?.value.trim();
  const type = document.getElementById('cal-f-type')?.value || 'meeting';
  const date = document.getElementById('cal-f-date')?.value;
  const start = document.getElementById('cal-f-start')?.value;
  const end = document.getElementById('cal-f-end')?.value;

  const errEl = document.getElementById('cal-modal-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if (errEl) errEl.style.display = 'none';

  if (!title) { showErr('Please enter an event title.'); document.getElementById('cal-f-title')?.focus(); return; }
  if (!date) { showErr('Please select a date.'); document.getElementById('cal-f-date')?.focus(); return; }

  // Build and push the new event
  const newEvent = { date, type, label: title };
  if (start) newEvent.startTime = start;
  if (end) newEvent.endTime = end;
  EVENTS.push(newEvent);

  // Register meeting details so the detail panel shows time/duration correctly
  if (type === 'meeting') {
    MEETING_DETAILS[title] = {
      time: start || '09:00',
      duration: (start && end) ? calcDuration(start, end) : '1h',
      attendees: [],
    };
  }

  // ── Persist availability events to the API so they survive a page reload.
  // The POST is fire-and-forget; a failure never blocks the UI flow.
  if (type === 'available' || type === 'leave') {
    fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ date, status: type }),
    }).then(async r => {
      if (!r.ok) return;
      const data = await r.json().catch(() => ({}));
      if (data.record) {
        // Merge into liveEvents so the dot appears without a full refresh.
        state.liveEvents = state.liveEvents.filter(e => e.date !== date);
        state.liveEvents.push({
          date:     data.record.date,
          type:     data.record.status,
          employee: data.record.employeeName || '',
          reason:   data.record.status === 'leave' ? 'On Leave' : undefined,
        });
      }
    }).catch(() => {}); // non-fatal
  }
  // ───────────────────────────────────────────────────────────────────────

  closeModal();

  // Navigate to the event's month + select the day so all panels update
  const evtDate = new Date(date + 'T00:00:00');
  state.year = evtDate.getFullYear();
  state.month = evtDate.getMonth();
  state.selectedDay = evtDate.getDate();
  render();
}

/** Returns a human-readable duration string from two HH:MM strings. */
function calcDuration(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '1h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// ---- Employee Availability Panel ----

/**
 * Writes the "My Availability" card into #cal-employee-avail.
 * Called by render() after innerHTML is set.
 * Lets the employee pick any date and mark it Available or On Leave,
 * saving immediately to /api/availability and updating the dots on the
 * calendar without a full page reload.
 */
function renderEmployeeAvailabilityPanel() {
  const el = $('cal-employee-avail');
  if (!el) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRec = state.liveEvents.find(e => e.date === todayStr);
  const currentStatus = todayRec?.type || null;

  const statusBadge = currentStatus === 'available'
    ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
         letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:999px;
         background:rgba(16,185,129,.12);color:#059669;">
         <span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
         Available
       </span>`
    : currentStatus === 'leave'
    ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
         letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:999px;
         background:rgba(245,158,11,.12);color:#d97706;">
         <span style="width:6px;height:6px;border-radius:50%;background:#f59e0b;"></span>
         On Leave
       </span>`
    : `<span style="font-size:11px;color:var(--ink-400);">Not set for today</span>`;

  // Build sorted recent records HTML
  const recentRows = state.liveEvents
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
    .map(rec => {
      const badge = rec.type === 'available'
        ? `<span style="font-size:11px;font-weight:700;color:#059669;background:rgba(16,185,129,.1);
             padding:2px 8px;border-radius:999px;">✅ Available</span>`
        : `<span style="font-size:11px;font-weight:700;color:#d97706;background:rgba(245,158,11,.1);
             padding:2px 8px;border-radius:999px;">🟡 On Leave</span>`;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;
                    border-bottom:1px solid var(--surface-border);">
          <span style="min-width:90px;font-size:12px;font-weight:600;color:var(--ink-700);">${rec.date}</span>
          ${badge}
          <button data-cal-del-date="${rec.date}"
                  style="margin-left:auto;padding:2px 8px;border-radius:6px;
                         border:1px solid rgba(239,68,68,.3);background:transparent;
                         font-size:11px;color:#dc2626;cursor:pointer;
                         transition:background .12s;"
                  onmouseover="this.style.background='rgba(239,68,68,.08)'"
                  onmouseout="this.style.background='transparent'">
            Remove
          </button>
        </div>`;
    }).join('');

  const recordsHtml = recentRows || `<span style="font-size:12px;color:var(--ink-400);">No records yet — mark a date above to start.</span>`;

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--surface-border);
                border-radius:20px;overflow:hidden;box-shadow:var(--card-shadow);">

      <!-- Card header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 24px;border-bottom:1px solid var(--surface-border);
                  background:linear-gradient(135deg,rgba(16,185,129,.06),rgba(245,158,11,.04));">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="width:34px;height:34px;border-radius:10px;
                       background:linear-gradient(135deg,#10b981,#059669);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="user-check" style="width:16px;height:16px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--ink-900);">My Availability</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px;">Set your status for any date — persists after refresh</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--ink-500);font-weight:500;">Today:</span>
          ${statusBadge}
        </div>
      </div>

      <!-- Controls -->
      <div style="padding:20px 24px;display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:11px;font-weight:600;color:var(--ink-600);letter-spacing:.04em;
                        text-transform:uppercase;">Date</label>
          <input id="cal-avail-date" type="date" value="${todayStr}"
                 style="padding:8px 12px;border:1px solid var(--surface-border);border-radius:10px;
                        font-size:13px;color:var(--ink-900);background:var(--surface);
                        outline:none;transition:border-color .15s,box-shadow .15s;min-width:160px;"
                 onfocus="this.style.borderColor='#10b981';this.style.boxShadow='0 0 0 3px rgba(16,185,129,.15)'"
                 onblur="this.style.borderColor='var(--surface-border)';this.style.boxShadow='none'" />
        </div>

        <button id="cal-avail-btn-available"
                style="display:inline-flex;align-items:center;gap:7px;
                       padding:9px 18px;border-radius:10px;border:none;
                       background:linear-gradient(135deg,#10b981,#059669);
                       color:white;font-size:13px;font-weight:600;cursor:pointer;
                       box-shadow:0 4px 12px rgba(16,185,129,.3);
                       transition:opacity .15s,transform .1s;"
                onmouseover="this.style.opacity='.88';this.style.transform='translateY(-1px)'"
                onmouseout="this.style.opacity='1';this.style.transform='none'">
          <i data-lucide="check-circle" style="width:15px;height:15px;"></i>
          Mark Available
        </button>

        <button id="cal-avail-btn-leave"
                style="display:inline-flex;align-items:center;gap:7px;
                       padding:9px 18px;border-radius:10px;border:none;
                       background:linear-gradient(135deg,#f59e0b,#d97706);
                       color:white;font-size:13px;font-weight:600;cursor:pointer;
                       box-shadow:0 4px 12px rgba(245,158,11,.3);
                       transition:opacity .15s,transform .1s;"
                onmouseover="this.style.opacity='.88';this.style.transform='translateY(-1px)'"
                onmouseout="this.style.opacity='1';this.style.transform='none'">
          <i data-lucide="umbrella" style="width:15px;height:15px;"></i>
          Mark On Leave
        </button>

        <div id="cal-avail-msg" style="font-size:12px;color:var(--ink-500);align-self:center;"></div>
      </div>

      <!-- Recent records list -->
      <div style="border-top:1px solid var(--surface-border);padding:14px 24px;
                  background:var(--surface-muted);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
                    color:var(--ink-500);margin-bottom:10px;">My Availability Records</div>
        <div id="cal-avail-records">${recordsHtml}</div>
      </div>

    </div>
  `;

  window.lucide?.createIcons();

  // Wire save buttons
  const setStatus = async (status) => {
    const dateVal = $('cal-avail-date')?.value;
    const msgEl   = $('cal-avail-msg');
    if (!dateVal) { if (msgEl) { msgEl.textContent = 'Please pick a date first.'; msgEl.style.color = '#ef4444'; } return; }
    if (msgEl) { msgEl.textContent = 'Saving…'; msgEl.style.color = 'var(--ink-500)'; }
    try {
      const r = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ date: dateVal, status }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (msgEl) { msgEl.textContent = data.error || 'Save failed.'; msgEl.style.color = '#ef4444'; }
        return;
      }
      if (data.record) {
        state.liveEvents = state.liveEvents.filter(e => e.date !== dateVal);
        state.liveEvents.push({
          date:     data.record.date,
          type:     data.record.status,
          employee: data.record.employeeName || (state.me?.name || ''),
          reason:   data.record.status === 'leave' ? 'On Leave' : undefined,
        });
      }
      if (msgEl) { msgEl.textContent = '✓ Saved'; msgEl.style.color = '#10b981'; }
      setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 2500);
      render(); // re-render so dots + badge update
    } catch {
      if (msgEl) { msgEl.textContent = 'Network error.'; msgEl.style.color = '#ef4444'; }
    }
  };

  $('cal-avail-btn-available')?.addEventListener('click', () => setStatus('available'));
  $('cal-avail-btn-leave')?.addEventListener('click',     () => setStatus('leave'));

  // Wire remove buttons in records list
  $('cal-avail-records')?.querySelectorAll('[data-cal-del-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const date = btn.dataset.calDelDate;
      try {
        const r = await fetch(`/api/availability/${encodeURIComponent(date)}`, {
          method: 'DELETE', credentials: 'same-origin',
        });
        if (!r.ok) return;
        state.liveEvents = state.liveEvents.filter(e => e.date !== date);
        render();
      } catch {}
    });
  });
}

// ---- Employee Tasks Card ----

/**
 * Writes the "My Assigned Tasks" card into #cal-employee-tasks.
 * Shown below the availability panel for Employee role only.
 * Data comes from state.myTasks (populated by refreshCalendar → /api/assignments).
 */
function renderEmployeeTasksCard() {
  const el = $('cal-employee-tasks');
  if (!el) return;

  const tasks = state.myTasks || [];

  if (!tasks.length) {
    el.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--surface-border);
                  border-radius:20px;padding:20px 24px;box-shadow:var(--card-shadow);
                  display:flex;align-items:center;gap:12px;color:var(--ink-400);">
        <i data-lucide="clipboard" style="width:18px;height:18px;flex-shrink:0;"></i>
        <span style="font-size:13px;">No tasks assigned yet. Ask your Admin to assign tasks from the Team page.</span>
      </div>`;
    window.lucide?.createIcons();
    return;
  }

  const STATUS_COLOR = {
    'Production':  '#10b981',
    'Testing':     '#0ea5e9',
    'Development': '#6366f1',
    'Blocked':     '#ef4444',
    'Waiting':     '#f59e0b',
    'Not Started': '#94a3b8',
  };

  const taskRows = tasks.map(t => {
    const sc = STATUS_COLOR[t.status] || '#94a3b8';
    const hasStart  = t.startDate && /^\d{4}-\d{2}-\d{2}$/.test(t.startDate);
    const hasEnd    = t.endDate   && /^\d{4}-\d{2}-\d{2}$/.test(t.endDate);
    const dateRange = hasStart && hasEnd
      ? `${t.startDate} → ${t.endDate}`
      : hasStart ? `Starts ${t.startDate}`
      : hasEnd   ? `Deadline ${t.endDate}`
      : 'No dates set';
    const desc = t.description
      ? `<div style="font-size:11px;color:var(--ink-500);margin-top:2px;
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
           ${t.description.slice(0, 100)}${t.description.length > 100 ? '…' : ''}
         </div>`
      : '';
    return `
      <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;
                  border-bottom:1px solid var(--surface-border);">
        <span style="width:10px;height:10px;border-radius:50%;background:${sc};
                     flex-shrink:0;margin-top:4px;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--ink-900);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${t.name}
          </div>
          ${desc}
          <div style="display:flex;align-items:center;gap:10px;margin-top:5px;flex-wrap:wrap;">
            <span style="font-size:10px;font-weight:700;color:${sc};
                         text-transform:uppercase;letter-spacing:.05em;">${t.status || '—'}</span>
            ${t.quarter ? `<span style="font-size:10px;color:var(--ink-400);">${t.quarter}</span>` : ''}
            <span style="font-size:10px;color:var(--ink-400);display:flex;align-items:center;gap:4px;">
              <i data-lucide="calendar" style="width:10px;height:10px;"></i>
              ${dateRange}
            </span>
          </div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--surface-border);
                border-radius:20px;overflow:hidden;box-shadow:var(--card-shadow);">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 24px;border-bottom:1px solid var(--surface-border);
                  background:linear-gradient(135deg,rgba(99,102,241,.06),rgba(139,92,246,.04));">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="width:34px;height:34px;border-radius:10px;
                       background:linear-gradient(135deg,#6366f1,#8b5cf6);
                       display:grid;place-items:center;flex-shrink:0;">
            <i data-lucide="clipboard-list" style="width:16px;height:16px;color:white;"></i>
          </span>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--ink-900);">My Assigned Tasks</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px;">
              ${tasks.length} task${tasks.length !== 1 ? 's' : ''} assigned to you
            </div>
          </div>
        </div>
        <span style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
                     color:#6366f1;background:rgba(99,102,241,.1);padding:4px 10px;
                     border-radius:999px;">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      </div>

      <!-- Task list -->
      <div style="padding:4px 24px 8px;">
        ${taskRows}
      </div>

    </div>
  `;

  window.lucide?.createIcons();
}

