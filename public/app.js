// TicketBox Frontend Application Logic

let currentUser = null;
let authToken = localStorage.getItem('tb_token') || null;
let allUsers = [];
let currentView = 'events';
let selectedEventType = '';

let currentShow = null;
let currentSeatsMap = [];
let selectedSeatIds = [];
let activeHoldToken = localStorage.getItem('tb_hold_token') || null;
let holdExpiresAt = localStorage.getItem('tb_hold_expires') || null;
let holdCountdownInterval = null;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  await fetchUsers();
  await checkAuth();
  await loadEvents();
  setupIntervals();
});

// Setup Periodic Refreshers (Polls seats & outbox every 5s for real-time responsiveness)
function setupIntervals() {
  setInterval(async () => {
    if (currentView === 'seatmap' && currentShow) {
      await fetchSeats(currentShow.id, true);
    }
  }, 4000);
}

// Check Current User Auth
async function checkAuth() {
  if (authToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
      } else {
        localStorage.removeItem('tb_token');
        authToken = null;
      }
    } catch (err) {
      console.error('Auth check error:', err);
    }
  }

  // Fallback to first customer user if not logged in
  if (!currentUser && allUsers.length > 0) {
    await loginUser(allUsers.find(u => u.role === 'customer') || allUsers[0]);
  } else {
    updateUserUI();
  }
}

// Fetch Demo Users for Quick Switcher
async function fetchUsers() {
  try {
    const res = await fetch('/api/auth/users');
    const data = await res.json();
    allUsers = data.users || [];
  } catch (err) {
    console.error('Fetch users error:', err);
  }
}

// Login as User
async function loginUser(userObj) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userObj.email, password: 'password123' })
    });
    const data = await res.json();
    if (res.ok) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('tb_token', authToken);
      updateUserUI();
      showToast(`Switched account to ${currentUser.name} (${currentUser.role.toUpperCase()})`, 'success');
      
      // Refresh active view
      if (currentView === 'bookings') loadMyBookings();
      if (currentView === 'waitlist') loadMyWaitlist();
      if (currentView === 'organiser') loadOrganiserDashboard();
      if (currentView === 'admin') loadAdminVenues();
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

// Update Role UI & Navigation
function updateUserUI() {
  if (!currentUser) return;

  const display = document.getElementById('current-user-display');
  if (display) {
    display.textContent = `${currentUser.name} (${currentUser.role})`;
  }

  // Update Users Switcher List
  const listContainer = document.getElementById('users-list-container');
  if (listContainer) {
    listContainer.innerHTML = allUsers.map(u => `
      <button onclick="loginUserById(${u.id})" class="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center justify-between text-xs transition-colors ${currentUser.id === u.id ? 'bg-indigo-950/60 border border-indigo-700/50 text-indigo-300 font-bold' : 'text-slate-300'}">
        <div class="truncate">
          <div class="font-medium">${u.name}</div>
          <div class="text-[10px] text-slate-500">${u.email}</div>
        </div>
        <span class="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${u.role === 'admin' ? 'bg-rose-950 text-rose-400' : u.role === 'organiser' ? 'bg-purple-950 text-purple-400' : 'bg-slate-800 text-slate-400'}">${u.role}</span>
      </button>
    `).join('');
  }

  // Show/Hide Role Navigation Tabs
  document.querySelectorAll('.role-organiser').forEach(el => {
    if (currentUser.role === 'organiser' || currentUser.role === 'admin') el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  document.querySelectorAll('.role-admin').forEach(el => {
    if (currentUser.role === 'admin') el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

function loginUserById(userId) {
  const target = allUsers.find(u => u.id === userId);
  if (target) {
    toggleRoleDropdown();
    loginUser(target);
  }
}

function toggleRoleDropdown() {
  const dd = document.getElementById('role-dropdown');
  if (dd) dd.classList.toggle('hidden');
}

// Navigation Controller
function navigateTo(viewName) {
  currentView = viewName;
  document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

  const targetSec = document.getElementById(`view-${viewName}`);
  const targetNav = document.getElementById(`nav-${viewName}`);

  if (targetSec) targetSec.classList.remove('hidden');
  if (targetNav) targetNav.classList.add('active');

  if (viewName === 'events') loadEvents();
  if (viewName === 'bookings') loadMyBookings();
  if (viewName === 'waitlist') loadMyWaitlist();
  if (viewName === 'organiser') loadOrganiserDashboard();
  if (viewName === 'admin') loadAdminVenues();
}

// Filter Events by Type
function setEventTypeFilter(type) {
  selectedEventType = type;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  if (type === '') document.getElementById('filter-all').classList.add('active');
  if (type === 'Movie') document.getElementById('filter-movie').classList.add('active');
  if (type === 'Concert') document.getElementById('filter-concert').classList.add('active');
  loadEvents();
}

function filterEvents() {
  loadEvents();
}

// Load Events Catalog
async function loadEvents() {
  const search = document.getElementById('event-search')?.value || '';
  const grid = document.getElementById('events-grid');
  if (!grid) return;

  grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><p>Loading events...</p></div>`;

  try {
    let url = `/api/events?type=${selectedEventType}&search=${encodeURIComponent(search)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.events || data.events.length === 0) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500">No events found matching your criteria.</div>`;
      return;
    }

    grid.innerHTML = data.events.map(ev => `
      <div class="group bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/50 rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300 flex flex-col">
        <div class="relative h-48 overflow-hidden">
          <img src="${ev.poster_url || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800'}" alt="${ev.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent"></div>
          <span class="absolute top-3 left-3 text-[10px] uppercase font-bold tracking-widest px-2.5 py-1 rounded-lg backdrop-blur-md ${ev.type === 'Movie' ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/50' : 'bg-purple-950/80 text-purple-300 border border-purple-700/50'}">
            ${ev.type}
          </span>
        </div>
        
        <div class="p-6 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <h3 class="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors line-clamp-1">${ev.title}</h3>
            <p class="text-xs text-slate-400 mt-1 line-clamp-2">${ev.description}</p>
          </div>

          <div class="space-y-2 text-xs text-slate-300 pt-3 border-t border-slate-800/60">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-location-dot text-indigo-400 text-xs"></i>
              <span class="truncate">${ev.venue_name} (${ev.venue_location})</span>
            </div>
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-calendar-day text-purple-400 text-xs"></i>
              <span>${ev.next_show_time ? new Date(ev.next_show_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Shows Available'}</span>
            </div>
          </div>

          <button onclick="openSeatMapForEvent(${ev.id})" class="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-gradient-to-r hover:from-indigo-600 hover:to-purple-600 text-white font-bold text-xs tracking-wider uppercase transition-all shadow-md">
            View Seats & Reserve <i class="fa-solid fa-chevron-right ml-1"></i>
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-rose-400">Failed to load events: ${err.message}</div>`;
  }
}

// Open Seat Map for Specific Event
async function openSeatMapForEvent(eventId) {
  try {
    const res = await fetch(`/api/events/${eventId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.shows.length === 0) {
      showToast('No active shows scheduled for this event yet.', 'warning');
      return;
    }

    // Default to first show
    currentShow = data.shows[0];
    const event = data.event;

    // Render Seat Map Header
    const header = document.getElementById('seatmap-header');
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-3 mb-1">
          <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">${event.type}</span>
          <span class="text-xs text-slate-400"><i class="fa-solid fa-location-dot mr-1"></i> ${event.venue_name}</span>
        </div>
        <h1 class="text-2xl font-extrabold text-white">${event.title}</h1>
        <p class="text-xs text-slate-400 mt-1"><i class="fa-solid fa-clock mr-1"></i> Show Time: ${new Date(currentShow.show_time).toLocaleString()}</p>
      </div>

      <div class="flex items-center gap-4">
        <div class="text-right">
          <div class="text-[11px] text-slate-400 uppercase font-semibold">Pricing</div>
          <div class="text-xs font-bold text-amber-400">Premium: $${currentShow.premium_price.toFixed(2)}</div>
          <div class="text-xs font-bold text-slate-300">Standard: $${currentShow.standard_price.toFixed(2)}</div>
        </div>
      </div>
    `;

    selectedSeatIds = [];
    navigateTo('seatmap');
    await fetchSeats(currentShow.id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Fetch Seats & Render Visual Matrix Grid
async function fetchSeats(showId, silent = false) {
  try {
    const res = await fetch(`/api/seats/show/${showId}`);
    const data = await res.json();

    currentSeatsMap = data.seats || [];
    renderSeatsGrid(data.show, data.seats);
    updateWaitlistUI(data.categorySummary);

    if (activeHoldToken && holdExpiresAt) {
      startHoldCountdown();
    }
  } catch (err) {
    if (!silent) console.error('Fetch seats error:', err);
  }
}

// Render Seats in Proper Row and Column Layout
function renderSeatsGrid(show, seats) {
  const container = document.getElementById('seat-grid-container');
  if (!container) return;

  // Group seats using their seat labels
  // Example: A1, A2, A3 -> Row A
  const rowsMap = {};

  seats.forEach(seat => {
    const match = seat.seat_label.match(/^([A-Za-z]+)(\d+)$/);

    if (!match) return;

    const rowLabel = match[1];
    const seatNumber = parseInt(match[2]);

    if (!rowsMap[rowLabel]) {
      rowsMap[rowLabel] = [];
    }

    rowsMap[rowLabel].push({
      ...seat,
      seatNumber
    });
  });

  // Sort rows alphabetically: A, B, C...
  const rowLabels = Object.keys(rowsMap).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  let html = `<div class="seat-map-grid">`;

  rowLabels.forEach(rowLabel => {
    // Sort seats numerically: A1, A2, A3...
    const rowSeats = rowsMap[rowLabel].sort(
      (a, b) => a.seatNumber - b.seatNumber
    );

    html += `
      <div class="seat-row">
        <span class="row-label">${rowLabel}</span>
    `;

    rowSeats.forEach(seat => {
      let stateClass =
        seat.category === 'Premium'
          ? 'available-premium'
          : 'available-standard';

      const isSelected = selectedSeatIds.includes(seat.id);

      const isHeldByMe =
        currentUser &&
        seat.held_by_user_id === currentUser.id &&
        seat.status === 'held';

      const isHeldByOther =
        seat.held_by_user_id &&
        (!currentUser ||
          seat.held_by_user_id !== currentUser.id) &&
        seat.status === 'held';

      const isBooked = seat.status === 'booked';

      if (isBooked) {
        stateClass = 'booked';
      } else if (isHeldByOther) {
        stateClass = 'held-other';
      } else if (isHeldByMe) {
        stateClass = 'held-self';
      } else if (isSelected) {
        stateClass = 'selected-self';
      }

      const isDisabled = isBooked || isHeldByOther;

      html += `
        <button
          onclick="toggleSeatSelection(${seat.id})"
          ${isDisabled ? 'disabled' : ''}
          class="seat-btn ${stateClass}"
          title="Seat ${seat.seat_label} (${seat.category}) - $${seat.price.toFixed(2)}"
        >
          <span>${seat.seat_label}</span>
          ${
            seat.category === 'Premium' && !isBooked
              ? '<i class="fa-solid fa-crown text-[7px] -mt-0.5 opacity-80"></i>'
              : ''
          }
        </button>
      `;
    });

    html += `
        <span class="row-label">${rowLabel}</span>
      </div>
    `;
  });

  html += `</div>`;

  container.innerHTML = html;

  updateReservationSummary();
}

// Toggle Seat Selection
function toggleSeatSelection(seatId) {
  if (activeHoldToken) {
    showToast('You currently have active held seats. Please checkout or release hold first.', 'info');
    return;
  }

  const index = selectedSeatIds.indexOf(seatId);
  if (index >= 0) {
    selectedSeatIds.splice(index, 1);
  } else {
    selectedSeatIds.push(seatId);
  }

  renderSeatsGrid(currentShow, currentSeatsMap);
}

// Update Reservation Summary Panel
function updateReservationSummary() {
  const container = document.getElementById('selected-seats-summary');
  const totalPriceEl = document.getElementById('summary-total-price');
  const btnHold = document.getElementById('btn-hold-seats');
  const btnConfirm = document.getElementById('btn-confirm-checkout');
  const btnRelease = document.getElementById('btn-release-hold');

  const selectedSeats = currentSeatsMap.filter(s => selectedSeatIds.includes(s.id));
  const heldByMeSeats = currentSeatsMap.filter(s => s.held_by_user_id === currentUser.id && s.status === 'held');

  if (activeHoldToken && heldByMeSeats.length > 0) {
    // Hold Active State
    btnHold.classList.add('hidden');
    btnConfirm.classList.remove('hidden');
    btnRelease.classList.remove('hidden');

    const total = heldByMeSeats.reduce((sum, s) => sum + s.price, 0);
    totalPriceEl.textContent = `$${total.toFixed(2)}`;

    container.innerHTML = heldByMeSeats.map(s => `
      <div class="flex justify-between items-center p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-xs">
        <div>
          <span class="font-bold text-amber-300">Seat ${s.seat_label}</span>
          <span class="text-[10px] text-amber-200/70 ml-2">(${s.category})</span>
        </div>
        <span class="font-bold text-emerald-400">$${s.price.toFixed(2)}</span>
      </div>
    `).join('');

    return;
  }

  // Normal Selection State
  btnHold.classList.remove('hidden');
  btnConfirm.classList.add('hidden');
  btnRelease.classList.add('hidden');

  btnHold.disabled = selectedSeats.length === 0;

  const total = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  totalPriceEl.textContent = `$${total.toFixed(2)}`;

  if (selectedSeats.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
        No seats selected yet.<br/>Click any available seat on the grid.
      </div>
    `;
  } else {
    container.innerHTML = selectedSeats.map(s => `
      <div class="flex justify-between items-center p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs">
        <div>
          <span class="font-bold text-white">Seat ${s.seat_label}</span>
          <span class="text-[10px] text-slate-400 ml-2">(${s.category})</span>
        </div>
        <span class="font-bold text-emerald-400">$${s.price.toFixed(2)}</span>
      </div>
    `).join('');
  }
}

// Request Seat Hold (TTL Trigger)
async function requestSeatHold() {
  if (selectedSeatIds.length === 0) return;

  try {
    const res = await fetch('/api/seats/hold', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ show_id: currentShow.id, seat_ids: selectedSeatIds })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    activeHoldToken = data.hold_token;
    holdExpiresAt = data.expires_at;

    localStorage.setItem('tb_hold_token', activeHoldToken);
    localStorage.setItem('tb_hold_expires', holdExpiresAt);

    selectedSeatIds = [];
    showToast(data.message, 'success');

    await fetchSeats(currentShow.id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Release Seat Hold
async function releaseSeatHold() {
  if (!activeHoldToken) return;

  try {
    const res = await fetch('/api/seats/hold/release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ hold_token: activeHoldToken })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    clearHoldState();
    showToast(data.message, 'info');
    await fetchSeats(currentShow.id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Confirm Checkout
async function confirmCheckout() {
  if (!activeHoldToken) return;

  try {
    const res = await fetch('/api/seats/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ hold_token: activeHoldToken })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    clearHoldState();
    showToast('🎉 Booking Confirmed! QR Code Ticket generated.', 'success');
    navigateTo('bookings');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function clearHoldState() {
  activeHoldToken = null;
  holdExpiresAt = null;
  localStorage.removeItem('tb_hold_token');
  localStorage.removeItem('tb_hold_expires');
  if (holdCountdownInterval) clearInterval(holdCountdownInterval);
  document.getElementById('hold-timer-banner')?.classList.add('hidden');
}

// Live Hold Countdown Timer
function startHoldCountdown() {
  const banner = document.getElementById('hold-timer-banner');
  const timerDisplay = document.getElementById('hold-countdown-timer');
  if (!banner || !timerDisplay || !holdExpiresAt) return;

  banner.classList.remove('hidden');

  if (holdCountdownInterval) clearInterval(holdCountdownInterval);

  holdCountdownInterval = setInterval(() => {
    const now = new Date().getTime();
    const expiry = new Date(holdExpiresAt).getTime();
    const diff = expiry - now;

    if (diff <= 0) {
      clearInterval(holdCountdownInterval);
      clearHoldState();
      showToast('Seat hold expired. Seats automatically released.', 'warning');
      if (currentShow) fetchSeats(currentShow.id);
      return;
    }

    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);
}

// Waitlist UI Handler
function updateWaitlistUI(categorySummary) {
  const container = document.getElementById('waitlist-join-container');
  if (!container || !categorySummary) return;

  const isSoldOut = categorySummary.some(c => c.available_seats === 0);
  if (isSoldOut) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

async function joinWaitlist() {
  const category = document.getElementById('waitlist-category-select')?.value || 'Premium';
  if (!currentShow) return;

  try {
    const res = await fetch('/api/waitlist/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ show_id: currentShow.id, category })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Joined waitlist! Queue position: #${data.queue_position}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Load My Bookings with QR Code Modal Viewer
async function loadMyBookings() {
  const container = document.getElementById('my-bookings-list');

  if (!container) return;

  container.innerHTML = `
    <div class="bookings-loading">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <p>Loading your tickets...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/seats/bookings/my', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await res.json();

    if (!data.bookings || data.bookings.length === 0) {
      container.innerHTML = `
        <div class="empty-bookings">
          <i class="fa-solid fa-ticket"></i>
          <h3>No confirmed tickets yet</h3>
          <p>Explore our events and book your next experience.</p>
          <button onclick="navigateTo('events')">
            Explore Events
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = data.bookings.map(b => `
      <div class="booking-card">

        <div class="booking-card-top">
          <span class="booking-type">${b.event_type}</span>

          <span class="booking-status ${b.status}">
            <i class="fa-solid fa-circle-check"></i>
            ${b.status.toUpperCase()}
          </span>
        </div>

        <h3>${b.event_title}</h3>

        <div class="booking-venue">
          <i class="fa-solid fa-location-dot"></i>
          ${b.venue_name}
        </div>

        <div class="booking-details">
          <div class="booking-detail">
            <span>SEAT</span>
            <strong>${b.seat_label}</strong>
            <small>${b.category}</small>
          </div>

          <div class="booking-detail">
            <span>BOOKING REF</span>
            <strong>${b.booking_reference}</strong>
          </div>
        </div>

        <div class="booking-show-time">
          <i class="fa-regular fa-calendar"></i>

          <div>
            <span>SHOW DATE & TIME</span>
            <strong>${new Date(b.show_time).toLocaleString()}</strong>
          </div>
        </div>

        <div class="booking-actions">
          <button
            class="qr-button"
            onclick="viewQRCodeModal('${b.booking_reference}', '${b.event_title}')"
          >
            <i class="fa-solid fa-qrcode"></i>
            View Entrance QR
          </button>

          <button
            class="cancel-button"
            onclick="cancelBooking(${b.id})"
          >
            <i class="fa-solid fa-xmark"></i>
            Cancel
          </button>
        </div>

      </div>
    `).join('');

  } catch (err) {
    console.error(err);

    container.innerHTML = `
      <div class="empty-bookings">
        <i class="fa-solid fa-circle-exclamation"></i>
        <h3>Unable to load bookings</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}


// Cancel Booking
async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking? The seat will be automatically re-allocated to the waitlist queue.')) return;

  try {
    const res = await fetch('/api/seats/bookings/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ booking_id: bookingId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadMyBookings();

  } catch (err) {
    showToast(err.message, 'error');
  }
}
// Load My Waitlist & Time-Limited Offers
async function loadMyWaitlist() {
  const container = document.getElementById('my-waitlist-list');
  if (!container) return;

  container.innerHTML = `<div class="py-12 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><p>Loading waitlist...</p></div>`;

  try {
    const res = await fetch('/api/waitlist/my', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (!data.waitlists || data.waitlists.length === 0) {
      container.innerHTML = `<div class="py-12 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl">You are not currently on any event waitlists.</div>`;
      return;
    }

    container.innerHTML = data.waitlists.map(w => `
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-indigo-400">${w.event_title}</span>
            <span class="text-xs text-slate-500">• ${w.category} Category</span>
          </div>
          <p class="text-xs text-slate-400 mt-1">Show Date: ${new Date(w.show_time).toLocaleString()}</p>
        </div>

        <div>
          ${w.status === 'offered' ? `
            <div class="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-right space-y-2">
              <div class="text-xs font-bold text-amber-300">⚡ SEAT OFFER AVAILABLE (Seat ${w.seat_label})</div>
              <p class="text-[11px] text-amber-200/80">Expires: ${new Date(w.offer_expires_at).toLocaleTimeString()}</p>
              <button onclick="claimWaitlistOffer('${w.offer_token}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/30">
                Claim Seat Offer Now
              </button>
            </div>
          ` : `
            <span class="text-xs font-bold px-3 py-1.5 rounded-xl ${w.status === 'waiting' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-slate-800 text-slate-400'}">
              Status: ${w.status.toUpperCase()}
            </span>
          `}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="py-12 text-center text-rose-400">${err.message}</div>`;
  }
}

// Claim Waitlist Offer
async function claimWaitlistOffer(offerToken) {
  try {
    const res = await fetch('/api/waitlist/offer/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ offer_token: offerToken })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    navigateTo('bookings');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Organiser Dashboard Renderer
async function loadOrganiserDashboard() {
  try {
    const res = await fetch('/api/events/analytics/revenue', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    const analytics = data.analytics || [];

    const totalRevenue = analytics.reduce((sum, a) => sum + a.total_revenue, 0);
    const totalBookings = analytics.reduce((sum, a) => sum + a.total_bookings, 0);

    const cardsGrid = document.getElementById('organiser-analytics-grid');
    cardsGrid.innerHTML = `
      <div class="bg-slate-900/60 p-6 rounded-3xl border border-slate-800/80 backdrop-blur-xl">
        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Gross Revenue</span>
        <div class="text-3xl font-extrabold text-emerald-400 mt-2">$${totalRevenue.toFixed(2)}</div>
      </div>
      <div class="bg-slate-900/60 p-6 rounded-3xl border border-slate-800/80 backdrop-blur-xl">
        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Tickets Sold</span>
        <div class="text-3xl font-extrabold text-indigo-400 mt-2">${totalBookings}</div>
      </div>
      <div class="bg-slate-900/60 p-6 rounded-3xl border border-slate-800/80 backdrop-blur-xl">
        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Events Managed</span>
        <div class="text-3xl font-extrabold text-purple-400 mt-2">${analytics.length}</div>
      </div>
    `;

    const tbody = document.getElementById('organiser-revenue-tbody');
    tbody.innerHTML = analytics.map(a => {
      const rate = a.total_seats_count ? Math.round((a.booked_seats_count / a.total_seats_count) * 100) : 0;
      return `
        <tr class="hover:bg-slate-900/40">
          <td class="p-4 font-bold text-white">${a.event_title} <span class="text-[10px] font-normal text-slate-500">(${a.event_type})</span></td>
          <td class="p-4 text-slate-400">${a.venue_name}</td>
          <td class="p-4 text-center font-bold text-purple-300">${a.booked_seats_count} / ${a.total_seats_count}</td>
          <td class="p-4 text-center">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${rate > 80 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-300'}">
              ${rate}%
            </span>
          </td>
          <td class="p-4 text-right font-extrabold text-emerald-400">$${a.total_revenue.toFixed(2)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Organiser dashboard error:', err);
  }
}

// Admin Venues Renderer
async function loadAdminVenues() {
  const grid = document.getElementById('admin-venues-grid');
  if (!grid) return;

  try {
    const res = await fetch('/api/venues');
    const data = await res.json();
    const venues = data.venues || [];

    grid.innerHTML = venues.map(v => `
      <div class="bg-slate-900/60 p-6 rounded-3xl border border-slate-800/80 backdrop-blur-xl space-y-3">
        <div class="flex justify-between items-start">
          <h3 class="text-lg font-bold text-white">${v.name}</h3>
          <span class="text-xs font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">${v.rows_count * v.cols_count} Total Seats</span>
        </div>
        <p class="text-xs text-slate-400"><i class="fa-solid fa-location-dot mr-1"></i> ${v.location}</p>
        <div class="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-300 flex justify-between">
          <span>Grid Dimensions: <strong>${v.rows_count} Rows × ${v.cols_count} Cols</strong></span>
          <span>Category Split: Premium (1-2) / Standard (3+)</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Admin venues error:', err);
  }
}

// Create Event Modal Handler
async function openCreateEventModal() {
  const modal = document.getElementById('create-event-modal');
  const venueSelect = document.getElementById('ev-venue-id');
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/venues');
    const data = await res.json();
    venueSelect.innerHTML = (data.venues || []).map(v => `<option value="${v.id}">${v.name} (${v.rows_count}x${v.cols_count} seats)</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

function closeCreateEventModal() {
  document.getElementById('create-event-modal')?.classList.add('hidden');
}

async function handleCreateEvent(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('ev-title').value,
    type: document.getElementById('ev-type').value,
    venue_id: document.getElementById('ev-venue-id').value,
    description: document.getElementById('ev-desc').value,
    poster_url: document.getElementById('ev-poster').value,
    show_time: document.getElementById('ev-time').value,
    premium_price: document.getElementById('ev-price-prem').value,
    standard_price: document.getElementById('ev-price-std').value,
  };

  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Event created & visual seat map generated!', 'success');
    closeCreateEventModal();
    loadOrganiserDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Create Venue Modal Handler
function openCreateVenueModal() {
  document.getElementById('create-venue-modal')?.classList.remove('hidden');
}

function closeCreateVenueModal() {
  document.getElementById('create-venue-modal')?.classList.add('hidden');
}

async function handleCreateVenue(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('vn-name').value,
    location: document.getElementById('vn-location').value,
    rows_count: document.getElementById('vn-rows').value,
    cols_count: document.getElementById('vn-cols').value,
  };

  try {
    const res = await fetch('/api/venues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Venue created successfully!', 'success');
    closeCreateVenueModal();
    loadAdminVenues();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// System Email Outbox Modal & QR Code Previewer
async function toggleOutboxModal() {
  const modal = document.getElementById('outbox-modal');
  if (!modal) return;

  const isHidden = modal.classList.contains('hidden');
  if (isHidden) {
    modal.classList.remove('hidden');
    await loadOutboxEmails();
  } else {
    modal.classList.add('hidden');
  }
}

async function loadOutboxEmails() {
  const container = document.getElementById('outbox-list-container');
  if (!container) return;

  try {
    const res = await fetch('/api/outbox');
    const data = await res.json();
    const emails = data.emails || [];

    if (emails.length === 0) {
      container.innerHTML = `<div class="text-center py-8 text-xs text-slate-500">Outbox is empty. Book a ticket to trigger a QR code email!</div>`;
      return;
    }

    container.innerHTML = emails.map(e => `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div class="p-3 bg-slate-950 border-b border-slate-800 flex justify-between items-center text-xs">
          <div>
            <span class="text-slate-400">To:</span> <strong class="text-indigo-300">${e.recipient}</strong>
          </div>
          <span class="text-[10px] text-slate-500">${new Date(e.sent_at).toLocaleTimeString()}</span>
        </div>
        <div class="p-4">
          <h4 class="font-bold text-white text-xs mb-3">${e.subject}</h4>
          <div class="rounded-xl overflow-hidden border border-slate-800">${e.body_html}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-rose-400 text-xs">${err.message}</div>`;
  }
}

function viewQRCodeModal(bookingRef, title) {
  toggleOutboxModal();
}

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' :
                  type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-200' :
                  type === 'warning' ? 'bg-amber-950/90 border-amber-500/50 text-amber-200' :
                  'bg-slate-900/90 border-slate-700/50 text-slate-200';

  toast.className = `${bgClass} backdrop-blur-xl border p-4 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-emerald-400' : type === 'error' ? 'fa-circle-xmark text-rose-400' : 'fa-circle-info text-sky-400'} text-base"></i>
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transition-opacity');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
