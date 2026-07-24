// ===== Farmer / Plot data =====
const PLOTS = {
  plot1: {
    id: 'plot1',
    name: 'ลุงสมชาย',
    plotCode: 'Plot-001',
    crop: 'อ้อยคั้นน้ำ',
    coords: '14.9642° N, 102.0931° E',
    zone: 'กลุ่มสัญญาน้ำตาลโซน A',
    initial: 32,
    target: 58,
    greeting: 'สวัสดีคุณลุงสมชาย 😊 ระบบ AQUA AI ตรวจสอบพิกัดแปลงอ้อยของท่านผ่านดาวเทียมเรียบร้อยแล้วครับ ท่านสามารถกดดูคำแนะนำการรดน้ำประจำวันได้เลยครับ'
  },
  plot2: {
    id: 'plot2',
    name: 'น้าสมศรี',
    plotCode: 'Plot-002',
    crop: 'อ้อยโรงงาน',
    coords: '14.9688° N, 102.0954° E',
    zone: 'กลุ่มสัญญาน้ำตาลโซน A',
    initial: 58,
    target: 58,
    greeting: 'สวัสดีค่ะน้าสมศรี 💧 ความชื้นดินในแปลงอ้อยโรงงานของน้าตอนนี้อยู่ในเกณฑ์ดีค่ะ ระบบจะแจ้งเตือนทันทีหากความชื้นเริ่มลดลงนะคะ'
  },
  plot3: {
    id: 'plot3',
    name: 'ผู้ใหญ่ผู้ดี',
    plotCode: 'Plot-003',
    crop: 'ข้าวหอมมะลิ',
    coords: '15.1245° N, 101.8942° E',
    zone: 'กลุ่มนาแปลงใหญ่ ม.4',
    initial: 75,
    target: 55,
    greeting: 'สวัสดีครับผู้ใหญ่ผู้ดี 🌾 ตอนนี้ระดับน้ำในแปลงนามีปริมาณสูงกว่าเกณฑ์ที่เหมาะสม ระบบแนะนำให้ระบายน้ำออกตามรอบเวลาครับ'
  }
};

const PLOT_META = {
  plot1: { area: '5 ไร่', battery: 92, signal: 'ดีมาก', fairness: 98 },
  plot2: { area: '8 ไร่', battery: 88, signal: 'ดี', fairness: 96 },
  plot3: { area: '12 ไร่', battery: 95, signal: 'ดีมาก', fairness: 99 }
};

const STATUS_COLORS = { wet: '#22c55e', normal: '#f5b300', dry: '#f2790f', critical: '#e33d3d' };
const WELCOME_KEY = 'aquaAi_welcomeSeen_v1';
const STORAGE_KEY = 'aquaAiState_v1';

let weatherInterval = null;

// ===== Urgent low-moisture notification (น้ำน้อยมาก < 20%) =====
const URGENT_MOISTURE_THRESHOLD = 20; // แจ้งเตือนแบบแรงเมื่อความชื้นต่ำกว่านี้
const URGENT_MOISTURE_RESET = 25;     // ต้องกลับขึ้นมาเกินนี้ก่อนถึงจะแจ้งเตือนซ้ำได้ (กันแจ้งรัว ๆ)
let urgentNotified = {};              // { plotId: true/false } — กันไม่ให้ยิงแจ้งเตือนซ้ำทุก tick
let unreadNotifications = 3;          // ต้องตรงกับตัวเลขเริ่มต้นบน bell-dot ใน HTML

// Dynamic Simulation Speed System
let currentSpeedMultiplier = 1;

function setSimSpeed(multiplier) {
  currentSpeedMultiplier = parseFloat(multiplier);
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.speed) === currentSpeedMultiplier);
  });

  // Restart active plot simulation ticks with the new speed multiplier
  Object.keys(PLOTS).forEach(id => {
    if (state.plots[id].pumpOn) {
      startMoistureSimulation(id);
    } else {
      startMoistureDrain(id);
    }
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('AQUA AI: could not read saved state', e);
  }
  const fresh = { activePlot: 'plot1', plots: {} };
  Object.keys(PLOTS).forEach(id => {
    fresh.plots[id] = {
      moisture: PLOTS[id].initial,
      pumpOn: false,
      messages: [{ from: 'bot', text: PLOTS[id].greeting }]
    };
  });
  return fresh;
}

function saveState() {
  showSavingIndicator();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('AQUA AI: could not save state', e);
  }
}

let saveIndicatorTimeout;
function showSavingIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.classList.remove('opacity-0');
  el.classList.add('opacity-100');
  clearTimeout(saveIndicatorTimeout);
  saveIndicatorTimeout = setTimeout(() => {
    el.classList.remove('opacity-100');
    el.classList.add('opacity-0');
  }, 1200);
}

let state = loadState();
let simIntervals = {};

function clearSim(plotId) {
  if (simIntervals[plotId]) {
    clearInterval(simIntervals[plotId]);
    delete simIntervals[plotId];
  }
}

// ===== Welcome Overlay Logic with Animated Percentage =====
function initWelcomeOverlay() {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;

  const hasSeen = sessionStorage.getItem(WELCOME_KEY);
  if (hasSeen) {
    overlay.remove();
    return;
  }

  const fillEl = document.getElementById('welcomeLoadingFill');
  const percentEl = document.getElementById('welcomePercentText');
  const textEl = document.getElementById('welcomeLoadingText');

  let progress = 0;
  const statusTexts = [
    'กำลังเชื่อมต่อระบบ AI ดาวเทียม...',
    'คำนวณความชื้นดินรายพิกัด...',
    'โหลดข้อมูลฟาร์มเสมือนจริง...',
    'ระบบพร้อมใช้งาน!'
  ];

  const duration = 2800; // เวลาโหลด 2.8 วินาที
  const intervalTime = 30;
  const increment = 100 / (duration / intervalTime);

  const timer = setInterval(() => {
    progress = Math.min(100, progress + increment);
    const currentInt = Math.floor(progress);

    if (fillEl) fillEl.style.width = currentInt + '%';
    if (percentEl) percentEl.innerText = currentInt + '%';

    if (textEl) {
      if (currentInt < 30) textEl.innerText = statusTexts[0];
      else if (currentInt < 65) textEl.innerText = statusTexts[1];
      else if (currentInt < 90) textEl.innerText = statusTexts[2];
      else textEl.innerText = statusTexts[3];
    }

    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(() => {
        overlay.classList.add('fade-out');
        sessionStorage.setItem(WELCOME_KEY, 'true');
        setTimeout(() => overlay.remove(), 800);
      }, 350);
    }
  }, intervalTime);
}

// ===== Moisture simulation (Fill & Drain Auto Loops with Dynamic Speed) =====
const BASE_FILL_TICK_MS = 300;
const BASE_DRAIN_TICK_MS = 1500;
const FULL_MOISTURE = 100;

// Variable สำหรับเก็บ Timeout การหน่วงเวลาของแต่ละแปลง (ป้องกันการรันซ้ำ)
let shutoffDelayTimeouts = {};

function startMoistureSimulation(plotId) {
  clearSim(plotId);

  // หากมีคิวหน่วงเวลาปิดน้ำค้างอยู่ให้ยกเลิกก่อน
  if (shutoffDelayTimeouts[plotId]) {
    clearTimeout(shutoffDelayTimeouts[plotId]);
    delete shutoffDelayTimeouts[plotId];
  }

  updateDashboardRow(plotId, true);

  const plotState = state.plots[plotId];
  const effectiveTickMs = Math.max(30, BASE_FILL_TICK_MS / currentSpeedMultiplier);

  simIntervals[plotId] = setInterval(() => {
    if (plotState.pumpOn && plotState.moisture < FULL_MOISTURE) {
      plotState.moisture = Math.min(FULL_MOISTURE, +(plotState.moisture + 0.8).toFixed(1));
      updateDashboardRow(plotId, true);
      checkUrgentMoisture(plotId);
      saveState();

      // 🚨 [ระบบ AUTO SHUTOFF]: เมื่อระดับน้ำ >= 95% หรือ Float Switch ทำงาน
      if (plotState.moisture >= 99) {
        // 1. ปิดวาล์ว/ปั๊มน้ำทันที
        plotState.pumpOn = false;
        clearSim(plotId);

        // 2. อัปเดต UI หน้าจอและแชท
        syncPumpButtonUI();
        updateDashboardRow(plotId, false, true); // Reached target = true

        // 3. แจ้งเตือนแบบไม่มีเสียง (ใช้อิโมจิ 💧 + ประเภท 'info' จะไม่มีเสียงหวูดเตือน)
        const plot = PLOTS[plotId];
        addNotification(
          `💧 ปิดวาล์วอัตโนมัติ (${plot.plotCode})`,
          `ระบบทำการปิดวาล์วน้ำแปลง${plot.crop}ของ${plot.name} เรียบร้อยแล้ว เนื่องจากตรวจพบระดับน้ำเต็มเกณฑ์ (${Math.round(plotState.moisture)}%)`,
          'info'
        );

        pushMessage(plotId, 'bot', `✅ <strong>ระบบปิดวาล์วอัตโนมัติ (Auto Shutoff)</strong><br>ระดับน้ำในแปลงสูงถึงเกณฑ์เต็มแล้ว (${Math.round(plotState.moisture)}%) ระบบทำการปิดวาล์วน้ำเพื่อป้องกันน้ำล้นเรียบร้อยครับ`);

        // 4. สุ่มเว้นระยะเวลา 5 - 10 วินาที (สุ่มแยกรายแปลง) เพื่อให้น้ำทรงตัวเต็มแปลงก่อนเริ่มลด
        const randomDelaySec = Math.floor(Math.random() * 6) + 5; // ได้ค่า 5, 6, 7, 8, 9 หรือ 10 วินาที
        console.log(`[Auto Shutoff] แปลง ${plot.plotCode} ปิดวาล์วแล้ว คงระดับน้ำไว้ ${randomDelaySec} วินาทีก่อนเริ่มลดลง`);

        shutoffDelayTimeouts[plotId] = setTimeout(() => {
          startMoistureDrain(plotId);
          delete shutoffDelayTimeouts[plotId];
        }, randomDelaySec * 1000);

        saveState();
        return;
      }
    }

    // กรณีปิดปั๊มเองแบบ Manual หรือน้ำเต็ม 100%
    if (!plotState.pumpOn || plotState.moisture >= FULL_MOISTURE) {
      clearSim(plotId);
      if (!plotState.pumpOn && !shutoffDelayTimeouts[plotId]) {
        startMoistureDrain(plotId);
      }
    }
  }, effectiveTickMs);
}

function startMoistureDrain(plotId) {
  clearSim(plotId);

  const plotState = state.plots[plotId];
  const floor = 0;
  const effectiveTickMs = Math.max(30, BASE_DRAIN_TICK_MS / currentSpeedMultiplier);

  simIntervals[plotId] = setInterval(() => {
    if (!plotState.pumpOn && plotState.moisture > floor) {
      plotState.moisture = Math.max(floor, +(plotState.moisture - 0.4).toFixed(1));
      updateDashboardRow(plotId, false);
      checkUrgentMoisture(plotId);
      saveState();
    }

    if (plotState.pumpOn || plotState.moisture <= floor) {
      clearSim(plotId);
      if (plotState.pumpOn) {
        startMoistureSimulation(plotId);
      }
    }
  }, effectiveTickMs);
}

// ==================== 1. ระบบเวลาประเทศไทย Real-time (Asia/Bangkok) ====================
function updateBangkokClock() {
  const dateEl = document.getElementById('topBarDate');
  if (!dateEl) return;

  const now = new Date();
  const options = {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  // แสดงผล วัน เดือน ปี พ.ศ. + เวลาเรียลไทม์
  const formatted = new Intl.DateTimeFormat('th-TH', options).format(now);

  // 🌟 ใช้ innerHTML เพื่อใส่แท็ก <span> สำหรับต่อท้าย (GMT+7) ตัวเล็กสีเข้ม/จาง
  dateEl.innerHTML = `${formatted} น. <span style="font-size: 0.8em; opacity: 0.7; font-weight: normal; margin-left: 4px;">(GMT+7)</span>`;
}

// ==================== 2. ระบบ Notification & Welcome Message ====================
let notificationsList = [];

// ฟังก์ชันเพิ่มการแจ้งเตือนใหม่
// ฟังก์ชันเพิ่มการแจ้งเตือนใหม่ลงใน Dropdown Box
function addNotification(title, text, type = 'info') {
  // 🛡️ เช็คกันข้อความแจ้งเตือนซ้ำเป๊ะๆ ติดกัน
  if (notificationsList.length > 0) {
    const latest = notificationsList[0];
    if (latest.title === title && latest.text === text) {
      return; // ถ้าเป็นข้อความเดิมซ้ำ ให้ข้าม ไม่สร้างเพิ่ม
    }
  }

  const now = new Date();
  const timeFormatted = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  // 🌟 ต่อท้ายเวลาในแจ้งเตือนด้วย (GMT+7) ตัวเล็ก
  const timeStr = `${timeFormatted} น. <span style="font-size: 0.85em; opacity: 0.7; font-weight: normal;">(GMT+7)</span>`;

  const newNotif = {
    id: Date.now() + Math.random(),
    title: title,
    text: text,
    type: type,
    time: timeStr,
    isRead: false
  };

  notificationsList.unshift(newNotif);
  updateNotifBadge(true);
  renderNotifDropdownList();
}

// อัปเดตตัวเลขแจ้งเตือนบนปุ่มกระดิ่ง
function updateNotifBadge(shouldShake = false) {
  const unreadCount = notificationsList.filter(n => !n.isRead).length;
  const dot = document.getElementById('bellDot');
  const bellBtn = document.querySelector('.bell-btn');

  if (dot) {
    dot.innerText = unreadCount;
    dot.style.display = unreadCount > 0 ? 'flex' : 'none';
  }

  // เอฟเฟกต์กระดิ่งสั่นเมื่อมีการแจ้งเตือนใหม่เข้า
  if (shouldShake && bellBtn) {
    bellBtn.classList.remove('bell-shake');
    void bellBtn.offsetWidth; // Trigger reflow
    bellBtn.classList.add('bell-shake');
    setTimeout(() => bellBtn.classList.remove('bell-shake'), 900);
  }
}

// อัปเดตตัวเลขแจ้งเตือนสีแดงบนปุ่มกระดิ่ง
function updateNotifBadge() {
  const unreadCount = notificationsList.filter(n => !n.isRead).length;
  const dot = document.getElementById('bellDot');
  if (dot) {
    dot.innerText = unreadCount;
    dot.style.display = unreadCount > 0 ? 'flex' : 'none';
  }
}

// Render รายการใน Dropdown
function renderNotifDropdownList() {
  const listContainer = document.getElementById('notifList');
  if (!listContainer) return;

  if (notificationsList.length === 0) {
    listContainer.innerHTML = '<div class="p-4 text-center text-xs text-[var(--ink-faint)]">ไม่มีการแจ้งเตือน</div>';
    return;
  }

  listContainer.innerHTML = notificationsList.map(n => `
    <div class="notif-item ${n.isRead ? 'read' : 'unread'}" onclick="markNotifAsRead(${n.id})">
      <div class="notif-icon ${n.type}">
        <i class="fa-solid ${n.type === 'critical' ? 'fa-triangle-exclamation' : (n.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-bell')}"></i>
      </div>
      <div class="notif-content">
        <div class="notif-title">${n.title}</div>
        <div class="notif-text">${n.text}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `).join('');
}

// ===== Font Size Selection & LocalStorage Sync =====
function initFontSize() {
  const savedSize = localStorage.getItem('aquaFontSize') || 'normal';
  applyFontSize(savedSize);
}

function applyFontSize(size) {
  document.documentElement.setAttribute('data-font-size', size);
  try {
    localStorage.setItem('aquaFontSize', size);
  } catch (e) { }

  document.querySelectorAll('.font-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === size);
  });
}

function setFontSize(size) {
  applyFontSize(size);
  if (typeof showSavingIndicator === 'function') {
    showSavingIndicator();
  }
  const dropdown = document.getElementById('fontSizeDropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function toggleFontSizeDropdown(e) {
  if (e) e.stopPropagation();

  // ปิด Notif Dropdown ถ้าเปิดค้างอยู่
  const notif = document.getElementById('notifDropdown');
  if (notif) notif.classList.add('hidden');

  const dropdown = document.getElementById('fontSizeDropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

// ปิด Dropdown เมื่อคลิกที่อื่นภายนอก
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('fontSizeDropdown');
  const btn = e?.target?.closest('button[onclick*="toggleFontSizeDropdown"]');
  if (dropdown && !dropdown.contains(e.target) && !btn) {
    dropdown.classList.add('hidden');
  }
});

// สลับการซ่อน/แสดง Dropdown
function toggleNotifDropdown(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

// ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
function markAllNotifsRead() {
  notificationsList.forEach(n => n.isRead = true);
  updateNotifBadge();
  renderNotifDropdownList();
}

// อ่านรายการเดียว
function markNotifAsRead(id) {
  const item = notificationsList.find(n => n.id === id);
  if (item) item.isRead = true;
  updateNotifBadge();
  renderNotifDropdownList();
}

// ปิด Dropdown เมื่อคลิกพื้นที่อื่นภายนอก
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('notifDropdown');
  const bellBtn = document.querySelector('.bell-btn');
  if (dropdown && !dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// แจ้งเตือนเข้าสู่ระบบ Welcome ทุกครั้งที่โหลดหน้าเว็บ
function initWelcomeNotification() {
  if (!sessionStorage.getItem('aqua_welcome_notified')) {
    addNotification(
      '👋 เข้าสู่เว็บไซต์ Welcome!',
      'ยินดีต้อนรับเข้าสู่ระบบจัดการน้ำอัจฉริยะ AQUA AI',
      'info'
    );
    // บันทึกไว้ว่าแจ้งเตือนแล้วใน Session นี้
    sessionStorage.setItem('aqua_welcome_notified', 'true');
  }
}
// ===== Urgent notification: fires a strong alert once each time a plot dips below 20% =====

function getUrgentNotified(plotId) {
  try {
    return sessionStorage.getItem('urgentNotified_' + plotId) === 'true';
  } catch (e) {
    return false;
  }
}

function setUrgentNotified(plotId, status) {
  try {
    sessionStorage.setItem('urgentNotified_' + plotId, status ? 'true' : 'false');
  } catch (e) { }
}

function checkUrgentMoisture(plotId) {
  const plotState = state.plots[plotId];
  const plot = PLOTS[plotId];

  // 🛑 ถ้าปั๊มน้ำเปิดอยู่แล้ว -> ข้ามการทำงาน
  if (plotState.pumpOn) {
    setUrgentNotified(plotId, true);
    return;
  }

  // ⚡ [ระบบเปิดวาล์วอัตโนมัติเมื่อ < 10%] ⚡
  const isAutoOpenEnabled = localStorage.getItem('aquaAutoOpenValve') === 'true';
  if (isAutoOpenEnabled && plotState.moisture < 10) {
    plotState.pumpOn = true;
    startMoistureSimulation(plotId); // สั่งเปิดน้ำรดแปลงทันที

    syncPumpButtonUI();
    updateDashboardRow(plotId, true);

    // ส่งข้อความเข้าแชท LINE OA
    pushMessage(plotId, 'bot', `⚡ <strong>ระบบเปิดวาล์วอัตโนมัติ (Auto Irrigation)</strong><br>ระดับความชื้นดินในแปลง${plot.crop}ลดลงเหลือเพียง <strong>${Math.round(plotState.moisture)}%</strong> (< 10%) ระบบสั่งเปิดปั๊มน้ำให้อัตโนมัติเรียบร้อยครับ`);

    // ส่งเข้าแจ้งเตือน Dropdown กระดิ่ง
    addNotification(
      `⚡ เปิดวาล์วอัตโนมัติ (${plot.plotCode})`,
      `ความชื้นต่ำกว่า 10% (${Math.round(plotState.moisture)}%) ระบบทำการเปิดปั๊มน้ำให้อัตโนมัติตามที่ตั้งค่าไว้`,
      'info'
    );

    saveState();
    return;
  }

  // การแจ้งเตือนด่วนวิกฤตปกติ (< 20%)
  const isAlreadyNotified = getUrgentNotified(plotId);
  if (plotState.moisture < URGENT_MOISTURE_THRESHOLD) {
    if (!isAlreadyNotified) {
      setUrgentNotified(plotId, true);
      triggerUrgentAlert(plotId);
    }
  } else if (plotState.moisture >= URGENT_MOISTURE_RESET) {
    setUrgentNotified(plotId, false);
  }
}

// ==================== ฟังก์ชัน Auto Scroll เลื่อนขึ้นบนสุด ====================
function scrollToTopDashboard() {
  // 1. เลื่อน window / document / body ขึ้นบนสุด
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.scrollTo({ top: 0, behavior: 'smooth' });

  // 2. ดึงแถบ Top Bar หรือส่วนบนสุดของ Dashboard เข้ามาในหน้าจอ
  const topNav = document.querySelector('.top-bar') || document.getElementById('page-dashboard');
  if (topNav) {
    topNav.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function triggerUrgentAlert(plotId) {
  const plot = PLOTS[plotId];
  const plotState = state.plots[plotId];
  const roundedMoisture = Math.round(plotState.moisture);

  // 1. เด้ง Toast แบนเนอร์สีแดงด้านบนหน้าจอ
  showUrgentToast(`⚠️ แจ้งเตือนวิกฤต! แปลง${plot.crop}ของ${plot.name} (${plot.plotCode}) เหลือความชื้นเพียง <strong>${roundedMoisture}%</strong> ต่ำกว่าเกณฑ์วิกฤตมาก ต้องเปิดปั๊มน้ำโดยด่วนที่สุด!`);

  // 2. ส่งข้อความแจ้งเตือนเข้าช่องแชท LINE OA
  pushMessage(plotId, 'bot', `🚨 <strong>แจ้งเตือนด่วนที่สุด (ความชื้นต่ำวิกฤต)</strong><br>ความชื้นดินแปลง${plot.crop}ของ${plot.name} (${plot.plotCode}) เหลือเพียง <strong>${roundedMoisture}%</strong> ต่ำกว่าเกณฑ์วิกฤต (${URGENT_MOISTURE_THRESHOLD}%) พืชเสี่ยงขาดน้ำรุนแรง<br><br>👉 กดปุ่ม <strong>[สั่งเปิดปั๊มน้ำ]</strong> ด่วนเพื่อป้องกันความเสียหายครับ`);

  // 3. ✨ [เพิ่มใหม่] สั่งให้เด้งรายการเข้า Dropdown Box ที่ปุ่มกระดิ่ง ✨
  addNotification(
    `🚨 วิกฤต! ความชื้นต่ำ (${plot.plotCode})`,
    `แปลง${plot.crop}ของ${plot.name} เหลือความชื้นเพียง ${roundedMoisture}% (ต่ำกว่าเกณฑ์ ${URGENT_MOISTURE_THRESHOLD}%)`,
    'critical'
  );

  // 4. สั่นสะเทือนอุปกรณ์ (ถ้าเครื่องรองรับ) และส่งเสียงเตือน
  if (navigator.vibrate) {
    try { navigator.vibrate([250, 100, 250, 100, 250]); } catch (e) { }
  }
  playUrgentAlertSound();

  if (typeof renderAlertsPage === 'function' && document.getElementById('alertsList')) {
    renderAlertsPage();
  }
}

function showUrgentToast(message) {
  const container = document.getElementById('urgentToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'urgent-toast';
  toast.innerHTML = `
    <i class="fa-solid fa-triangle-exclamation urgent-toast-icon"></i>
    <div class="urgent-toast-text">${message}</div>
    <button class="urgent-toast-close" aria-label="ปิด">✕</button>
  `;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 350);
  };
  toast.querySelector('.urgent-toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 7000);
}

function bumpNotificationBadge() {
  unreadNotifications++;
  const dot = document.querySelector('.bell-dot');
  const bellBtn = document.querySelector('.bell-btn');
  if (dot) {
    dot.innerText = unreadNotifications;
    dot.classList.remove('bell-dot-urgent');
    void dot.offsetWidth; // restart animation แม้จะยิงติดกันหลายครั้ง
    dot.classList.add('bell-dot-urgent');
  }
  if (bellBtn) {
    bellBtn.classList.remove('bell-shake');
    void bellBtn.offsetWidth;
    bellBtn.classList.add('bell-shake');
    setTimeout(() => bellBtn.classList.remove('bell-shake'), 900);
  }
}

function playUrgentAlertSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.15);
    osc.frequency.setValueAtTime(880, now + 0.3);
    osc.frequency.setValueAtTime(660, now + 0.45);
    osc.start(now);
    osc.stop(now + 0.6);
    osc.onended = () => ctx.close();
  } catch (e) {
    // เบราว์เซอร์บางตัวบล็อกเสียงจนกว่าจะมีการโต้ตอบ — ปล่อยผ่านเงียบ ๆ ไม่ให้แอปพัง
  }
}

// อัปเดตฟังก์ชัน switchContact ใน script.js
function switchContact(plotId, scrollUp = true) { // 👈 ตั้งค่าเริ่มต้นเป็น true
  state.activePlot = plotId;
  saveState();
  renderChatHeader();
  renderChatMessages();
  renderContactChips();
  syncPumpButtonUI();
  highlightDashboardRow();
  renderMap();
  renderAllPages();

  // 🚀 เลื่อนหน้าจอกลับขึ้นไปที่ LINE OA / Dashboard ทันที
  if (scrollUp) {
    const targetEl = document.querySelector('.phone-frame') || document.getElementById('page-dashboard');
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function renderContactChips() {
  Object.keys(PLOTS).forEach(id => {
    const chip = document.getElementById('chip-' + id);
    if (!chip) return;
    chip.classList.toggle('active-chip', id === state.activePlot);
  });
}

function renderChatHeader() {
  const plot = PLOTS[state.activePlot];
  const hName = document.getElementById('chatHeaderName');
  const hSub = document.getElementById('chatHeaderSub');
  if (hName) hName.innerText = 'AQUA AI • ' + plot.name;
  if (hSub) hSub.innerText = '● ปกติ (' + plot.plotCode + ' · ' + plot.crop + ')';
}

function renderChatMessages() {
  const container = document.getElementById('lineChatContainer');
  if (!container) return;
  const plotState = state.plots[state.activePlot];
  container.innerHTML = '<div class="text-center"><span class="bg-black/15 text-white rounded-full px-2 py-0.5 text-[10px]">วันนี้</span></div>';
  plotState.messages.forEach(msg => {
    if (msg.from === 'bot') {
      appendBotMessage(msg.text, false);
    } else {
      appendUserMessage(msg.text, false);
    }
  });
  container.scrollTop = container.scrollHeight;
}

// ===== Chat actions =====
function simulateLineAction(actionType) {
  const plotId = state.activePlot;
  const plot = PLOTS[plotId];
  const plotState = state.plots[plotId];

  if (actionType === 'moisture') {
    pushMessage(plotId, 'user', 'ตรวจความชื้นดินให้หน่อย');

    setTimeout(() => {
      const roundedMoisture = Math.round(plotState.moisture);
      const statusLabel = roundedMoisture < 50 ? 'ดินค่อนข้างแห้ง' : (roundedMoisture > 65 ? 'น้ำขังเกินเกณฑ์' : 'ความชื้นอยู่ในเกณฑ์ดี');
      pushMessage(plotId, 'bot', `🤖 <strong>ผลวิเคราะห์ดาวเทียม (${plot.plotCode}):</strong><br>ขณะนี้ความชื้นดินในแปลง${plot.crop}ของ${plot.name} อยู่ที่ <strong>${roundedMoisture}%</strong> (สถานะ: ${statusLabel})<br><br>💡 คาดการณ์สภาพอากาศล่วงหน้า: บ่ายนี้แดดจัด ไม่มีฝนครับ`);
    }, 600);

  } else if (actionType === 'irrigation') {
    pushMessage(plotId, 'user', 'AI แนะนำให้ทำยังไงต่อ');

    setTimeout(() => {
      const cmd = actionCommand(plotId);
      if (cmd.action === 'open') {
        pushMessage(plotId, 'bot', `✨ <strong>คำแนะนำจาก AQUA AI:</strong><br>ให้เปิดน้ำเข้าแปลง <strong>${cmd.queue} คิว</strong> (ลึกประมาณ ${cmd.depthCm} ซม.) ครับ เพื่อให้${plot.crop}ได้น้ำในเกณฑ์ที่พอดีสูงสุด (Optimal Yield)<br><br>👉 กดปุ่ม <strong>[สั่งเปิด/ปิดปั๊ม]</strong> ด้านล่างเพื่อทำงานได้ทันทีครับ`);
      } else if (cmd.action === 'drain') {
        pushMessage(plotId, 'bot', `✨ <strong>คำแนะนำจาก AQUA AI:</strong><br>ระดับน้ำในแปลงสูงกว่าเกณฑ์ที่เหมาะสม แนะนำให้ <strong>"ระบายน้ำออก"</strong> ตามรอบเวลาเพื่อป้องกันรากเน่าและรักษาคุณภาพผลผลิตครับ`);
      } else {
        pushMessage(plotId, 'bot', `✨ <strong>คำแนะนำจาก AQUA AI:</strong><br>ระดับความชื้นอยู่ที่ <strong>${Math.round(plotState.moisture)}%</strong> ซึ่งพอดีดีมากครับ แนะนำให้ <strong>"ปิดปั๊มน้ำ"</strong> เพื่อประหยัดค่าไฟและลดปัญหาดินแฉะเกินไปครับ`);
      }
    }, 600);

  } else if (actionType === 'toggle_pump') {
    plotState.pumpOn = !plotState.pumpOn;

    if (plotState.pumpOn) {
      pushMessage(plotId, 'user', 'สั่งเปิดปั๊มน้ำ');
      setPumpButtonLoading(true);

      setTimeout(() => {
        syncPumpButtonUI();
        pushMessage(plotId, 'bot', `⚡ สั่งเปิดเครื่องปั๊มน้ำหน้างานเรียบร้อยแล้ว! กำลังเริ่มนับเวลาและคำนวณการเพิ่มตัวของความชื้นดิน...`);
        startMoistureSimulation(plotId);

        if (!location.pathname.endsWith('3d.html')) {
          setTimeout(() => {
            window.location.href = '3d.html?plot=' + plotId;
          }, 900);
        }

      }, 800);
    } else {
      pushMessage(plotId, 'user', 'สั่งปิดปั๊มน้ำ');
      setPumpButtonLoading(false, true);

      setTimeout(() => {
        syncPumpButtonUI();
        pushMessage(plotId, 'bot', `⏹️ ปิดปั๊มน้ำเรียบร้อย! วันนี้ประหยัดปริมาณน้ำสะสมไปได้เพิ่มขึ้น ระบบบันทึกประวัติเข้าแดชบอร์ดส่วนกลางแล้วครับ`);
        updateDashboardRow(plotId, false);
        startMoistureDrain(plotId);
        saveState();
      }, 800);
    }
    saveState();
  }
}

function pushMessage(plotId, from, text) {
  state.plots[plotId].messages.push({ from, text });
  saveState();
  if (plotId === state.activePlot) {
    if (from === 'bot') appendBotMessage(text);
    else appendUserMessage(text);
  }
}

// ===== Chat bubble rendering =====
function appendUserMessage(text, scroll = true) {
  const container = document.getElementById('lineChatContainer');
  if (!container) return;
  const msgHtml = `
    <div class="flex justify-end space-x-2">
      <div class="bubble-user p-2.5 rounded-2xl rounded-tr-none shadow-sm max-w-[80%]">
        ${text}
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', msgHtml);
  if (scroll) container.scrollTop = container.scrollHeight;
}

function appendBotMessage(text, scroll = true) {
  const container = document.getElementById('lineChatContainer');
  if (!container) return;
  const msgHtml = `
    <div class="flex items-start space-x-2">
      <div class="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-white font-bold text-[9px] flex-shrink-0 shadow">AQ</div>
      <div class="bubble-bot p-2.5 rounded-2xl rounded-tl-none shadow-sm max-w-[80%]">
        ${text}
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', msgHtml);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ===== Pump button UI (left phone panel) =====
function setPumpButtonLoading(turningOn, turningOff) {
  const icon = document.getElementById('linePumpIcon');
  const label = document.getElementById('linePumpText');
  if (!icon || !label) return;
  if (turningOn) {
    icon.className = "fa-solid fa-circle-notch animate-spin text-sky-600 mb-1 text-base";
    label.innerText = "กำลังเปิดปั๊ม...";
  } else if (turningOff) {
    icon.className = "fa-solid fa-circle-notch animate-spin text-rose-600 mb-1 text-base";
    label.innerText = "กำลังปิดปั๊ม...";
  }
}

function syncPumpButtonUI() {
  const plotState = state.plots[state.activePlot];
  const icon = document.getElementById('linePumpIcon');
  const label = document.getElementById('linePumpText');
  if (!icon || !label) return;
  if (plotState.pumpOn) {
    icon.className = "fa-solid fa-power-off text-rose-600 mb-1 text-base";
    label.innerText = "สั่งปิดปั๊มน้ำ";
  } else {
    icon.className = "fa-solid fa-power-off text-cyan-600 mb-1 text-base";
    label.innerText = "สั่งเปิด/ปิดปั๊ม";
  }
}

// ===== Dashboard row rendering =====
function updateDashboardRow(plotId, pumpActive, reachedTarget) {
  const plotState = state.plots[plotId];
  const plot = PLOTS[plotId];
  const bar = document.getElementById(plotId + 'MoistureBar');
  const text = document.getElementById(plotId + 'MoistureText');
  const badge = document.getElementById(plotId + 'PumpBadge');
  const advice = document.getElementById(plotId + 'AIAdvice');
  if (!bar) return;

  const displayMoisture = Math.round(plotState.moisture);
  bar.style.width = plotState.moisture + '%';

  if (reachedTarget) {
    text.innerText = `${displayMoisture}% (ความชื้นเหมาะสม)`;
    text.className = "font-medium text-emerald-600";
    if (advice) {
      advice.innerText = "ความชื้นพอดี ควรปิดน้ำ";
      advice.className = "text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded font-medium";
    }
  } else if (pumpActive) {
    text.innerText = `${displayMoisture}% (กำลังเพิ่มขึ้น)`;
    text.className = "font-medium text-sky-600 animate-pulse";
  } else {
    text.innerText = `${displayMoisture}% (${displayMoisture < 50 ? 'ต่ำ' : displayMoisture > 65 ? 'น้ำขัง' : 'พอดี'})`;
    text.className = displayMoisture < 50 ? "font-medium text-sky-700" : (displayMoisture > 65 ? "font-medium text-blue-600" : "font-medium text-emerald-600");
  }

  if (badge) {
    if (pumpActive) {
      badge.className = "bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5";
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> กำลังเปิดน้ำ`;
      if (advice) {
        advice.innerText = "กำลังรดน้ำตามคำแนะนำ AI";
        advice.className = "text-sky-700 bg-sky-50 border border-sky-200 px-2 py-1 rounded font-medium";
      }
    } else {
      badge.className = "bg-slate-100 text-[var(--ink-soft)] px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5";
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ปิดอยู่`;
      if (advice && !reachedTarget) {
        const cmd = actionCommand(plotId);
        advice.innerText = cmd.text;
        advice.className = cmd.action === 'open' ? "text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded font-medium" : "text-[var(--ink-faint)] badge-idle px-2 py-1 rounded font-medium";
      }
    }
  }

  renderMap();
  renderAllPages();
}

function highlightDashboardRow() {
  Object.keys(PLOTS).forEach(id => {
    const row = document.getElementById('row-' + id);
    if (row) row.classList.toggle('active-row', id === state.activePlot);
  });
}

// ===== Interactive Map =====
function moistureStatus(value) {
  if (value >= 65) return { key: 'wet', label: 'ชื้นมาก', className: 'moisture-wet', icon: 'fa-seedling' };
  if (value >= 50) return { key: 'normal', label: 'ปกติ', className: 'moisture-normal', icon: 'fa-droplet' };
  if (value >= 35) return { key: 'dry', label: 'แห้ง', className: 'moisture-dry', icon: 'fa-droplet' };
  return { key: 'critical', label: 'แห้งมาก', className: 'moisture-critical', icon: 'fa-triangle-exclamation' };
}

// ฟังก์ชันเลื่อนลงไปยังแผนที่เมื่อกดปุ่มแจ้งเตือนลอย
function scrollToInteractiveMap() {
  const mapCard = document.getElementById('interactiveMapCard') || document.getElementById('mapCanvas');
  if (mapCard) {
    mapCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // เล่นเอฟเฟกต์ไฟกะพริบเน้นการ์ดแผนที่
    mapCard.classList.remove('map-highlight-pulse');
    void mapCard.offsetWidth; // Trigger reflow
    mapCard.classList.add('map-highlight-pulse');
    setTimeout(() => mapCard.classList.remove('map-highlight-pulse'), 2000);
  }
}

// ==================== ระบบตั้งค่าเปิดวาล์วอัตโนมัติ (< 10%) ====================
function initAutoOpenValveSetting() {
  const saved = localStorage.getItem('aquaAutoOpenValve');
  // ค่าเริ่มต้นเป็น false (ปิดไว้)
  const isAutoOpen = saved === 'true';
  const switchEl = document.getElementById('autoOpenValveSwitch');
  if (switchEl) switchEl.classList.toggle('on', isAutoOpen);
}

function toggleAutoOpenValve() {
  const switchEl = document.getElementById('autoOpenValveSwitch');
  if (!switchEl) return;
  const isOn = switchEl.classList.toggle('on');
  localStorage.setItem('aquaAutoOpenValve', isOn ? 'true' : 'false');

  if (typeof showSavingIndicator === 'function') {
    showSavingIndicator();
  }
}

// อัปเดตฟังก์ชัน renderMap ให้ซ่อน/แสดงปุ่มลอยอัตโนมัติเมื่อมีแปลงวิกฤต
function renderMap() {
  const criticalPlots = [];

  Object.keys(PLOTS).forEach(id => {
    const plotState = state.plots[id];
    const plot = PLOTS[id];
    const status = moistureStatus(plotState.moisture);

    const zone = document.getElementById('zone-' + id);
    if (zone) {
      zone.setAttribute('class', 'field-zone ' + status.className);
    }

    const pin = document.getElementById('pin-' + id);
    if (pin) {
      pin.className = 'map-pin ' + status.className;
      if (id === state.activePlot) pin.classList.add('pin-active');
      if (status.key === 'critical') pin.classList.add('pin-critical');
      pin.title = `${plot.plotCode} (${plot.name}) · ${Math.round(plotState.moisture)}% (${status.label})`;
    }

    const pinIcon = document.getElementById('pin-icon-' + id);
    if (pinIcon) {
      pinIcon.className = 'fa-solid ' + status.icon;
    }

    if (status.key === 'critical') {
      criticalPlots.push(plot.name);
    }
  });

  const banner = document.getElementById('mapAlertBanner');
  const bannerText = document.getElementById('mapAlertText');
  const floatingBtn = document.getElementById('floatingMapAlertBtn');

  // ตรวจสอบว่ามีแปลงความชื้นวิกฤตหรือไม่
  if (criticalPlots.length > 0) {
    if (bannerText) bannerText.innerText = `พื้นที่แปลงสีแดง (${criticalPlots.join(', ')}) ความชื้นต่ำ ให้รดน้ำด่วน`;
    if (banner) banner.style.display = 'flex';
    if (floatingBtn) floatingBtn.classList.remove('hidden'); // แสดงปุ่มเตือนลอยสีแดง
  } else {
    if (banner) banner.style.display = 'none';
    if (floatingBtn) floatingBtn.classList.add('hidden'); // ซ่อนปุ่มเมื่อไม่มีแปลงวิกฤต
  }
}

function mapControlFeedback(label) {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  const original = el.innerHTML;
  el.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> ${label}`;
  el.classList.remove('opacity-0');
  el.classList.add('opacity-100');
  clearTimeout(saveIndicatorTimeout);
  saveIndicatorTimeout = setTimeout(() => {
    el.classList.remove('opacity-100');
    el.classList.add('opacity-0');
    setTimeout(() => { el.innerHTML = original; }, 300);
  }, 1000);
}

// ===== Map zoom / locate / layer controls =====
let mapZoomLevel = 1;
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 2.4;
const MAP_ZOOM_STEP = 0.3;

function applyMapZoom() {
  const viewport = document.getElementById('mapViewport');
  if (viewport) viewport.style.transform = `scale(${mapZoomLevel})`;
}

function mapZoomIn() {
  mapZoomLevel = Math.min(MAP_ZOOM_MAX, +(mapZoomLevel + MAP_ZOOM_STEP).toFixed(2));
  applyMapZoom();
  mapControlFeedback('เข้ามาใกล้พื้นที่');
}

function mapZoomOut() {
  mapZoomLevel = Math.max(MAP_ZOOM_MIN, +(mapZoomLevel - MAP_ZOOM_STEP).toFixed(2));
  applyMapZoom();
  mapControlFeedback('ย่อออกจากพื้นที่');
}

function mapLocate() {
  mapZoomLevel = 1;
  applyMapZoom();
  mapControlFeedback('รีเซ็ตมุมมองแผนที่');
}

function mapToggleLayer() {
  const canvas = document.getElementById('mapCanvas');
  if (!canvas) return;
  const isPlain = canvas.classList.toggle('map-layer-plain');
  mapControlFeedback(isPlain ? 'เลเยอร์ความชื้น' : 'เลเยอร์ดาวเทียม');
}

// ===== ScrollSpy =====
function initScrollSpy() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageId = entry.target.id.replace('page-', '');

        document.querySelectorAll('.side-nav-item').forEach(item => {
          const isActive = item.getAttribute('data-page') === pageId;
          item.classList.toggle('active', isActive);

          if (isActive) {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      }
    });
  }, {
    rootMargin: '-20% 0px -60% 0px'
  });

  PAGE_IDS.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) observer.observe(el);
  });
}

// ===== Theme (dark / light) =====
function initTheme() {
  const saved = (() => { try { return localStorage.getItem('aquaTheme'); } catch (e) { return null; } })();
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem('aquaTheme', theme); } catch (e) { }
  const settingsSwitch = document.getElementById('settingsThemeSwitch');
  if (settingsSwitch) settingsSwitch.classList.toggle('on', theme === 'dark');
}

// ==================== ระบบสลับการแสดงสัตว์เลี้ยง ====================
function initAnimalsSetting() {
  const saved = localStorage.getItem('aquaShowAnimals');
  const show = saved === null ? false : saved === 'true'; // 👈 เปลี่ยนเป็น false
  const switchEl = document.getElementById('settingsAnimalsSwitch');
  if (switchEl) switchEl.classList.toggle('on', show);
}

function toggleAnimals() {
  const switchEl = document.getElementById('settingsAnimalsSwitch');
  if (!switchEl) return;
  const isOn = switchEl.classList.toggle('on');
  localStorage.setItem('aquaShowAnimals', isOn ? 'true' : 'false');
  showSavingIndicator();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(isDark ? 'light' : 'dark');
}

// ===== Mobile navigation drawer =====
function openMobileNav() {
  const nav = document.getElementById('sideNav');
  const backdrop = document.getElementById('mobileNavBackdrop');
  if (nav) nav.classList.add('mobile-open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
  const nav = document.getElementById('sideNav');
  const backdrop = document.getElementById('mobileNavBackdrop');
  if (nav) nav.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

function toggleMobileNav() {
  const nav = document.getElementById('sideNav');
  if (nav && nav.classList.contains('mobile-open')) {
    closeMobileNav();
  } else {
    openMobileNav();
  }
}

// ===== SPA page switching =====
const PAGE_IDS = ['dashboard', 'digitaltwin', 'allocation', 'prediction', 'iot', 'farm', 'reports', 'carbon', 'roi', 'scheduling', 'alerts', 'community', 'settings'];

function switchPage(pageId) {
  if (PAGE_IDS.indexOf(pageId) === -1) return;

  document.querySelectorAll('.side-nav-item').forEach(item => {
    const isActive = item.getAttribute('data-page') === pageId;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  closeMobileNav();

  const targetSection = document.getElementById('page-' + pageId);
  if (targetSection) {
    setTimeout(() => {
      targetSection.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 150);
  }

  const bar = document.getElementById('pageLoadBar');
  if (bar) {
    bar.classList.remove('running');
    void bar.offsetWidth;
    bar.classList.add('running');
  }

  renderAllPages();
}

function openChatFor(plotId) {
  switchContact(plotId);
  switchPage('dashboard');
}

// ===== Analytics pages: render from the shared PLOTS/state data =====
function renderAllPages() {
  renderDigitalTwinPage();
  renderWaterAllocationPage();
  renderAIPredictionPage();
  renderIoTPage();
  renderAnomalyList();
  renderMaintenanceList();
  renderFarmPage();
  renderReportsPage();
  renderCarbonPage();
  renderROIPage();
  renderSchedulingPage();
  renderAlertsPage();
  renderCommunityPage();
  renderWeeklyReportPreview();
}

function actionCommand(plotId) {
  const plot = PLOTS[plotId];
  const plotState = state.plots[plotId];
  const deficit = plot.target - plotState.moisture;

  if (deficit > 0) {
    const queue = Math.max(0.5, +(deficit * 0.12).toFixed(1));
    const depthCm = Math.max(1, Math.round(deficit * 0.35));
    return { action: 'open', tone: 'warning', text: `เปิดน้ำ ${queue} คิว (ลึกประมาณ ${depthCm} ซม.)`, queue, depthCm };
  } else if (plotState.moisture > plot.target + 10) {
    return { action: 'drain', tone: 'info', text: 'ระบายน้ำออก 1 รอบตามตารางเวลา' };
  }
  return { action: 'hold', tone: 'good', text: 'คงระดับน้ำเดิม ไม่ต้องเปิด-ปิดเพิ่ม' };
}

function plotAdvice(plotId) {
  const cmd = actionCommand(plotId);
  return { text: cmd.text, tone: cmd.tone };
}

function renderDigitalTwinPage() {
  const grid = document.getElementById('dtGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const status = moistureStatus(plotState.moisture);
    const color = STATUS_COLORS[status.key];
    const advice = plotAdvice(id);
    const isActive = id === state.activePlot;
    return `
      <div class="aqua-card rounded-xl p-4 cursor-pointer ${isActive ? 'ring-2 ring-[var(--aqua-sky)]' : ''}" onclick="switchContact('${id}')">
        <div class="flex items-center gap-3">
          <div class="ring-progress" style="background: conic-gradient(${color} ${plotState.moisture}%, var(--track-bg) 0);">
            <span>${Math.round(plotState.moisture)}%</span>
          </div>
          <div>
            <div class="font-bold text-sm text-[var(--ink)]">${plot.plotCode}</div>
            <div class="text-[11px] text-[var(--ink-faint)]">${plot.name} · ${plot.crop}</div>
            <div class="text-[10px] mt-1" style="color:${color}; font-weight:700;">${status.label}</div>
          </div>
        </div>
        <p class="text-[11px] text-[var(--ink-soft)] mt-3">🤖 ${advice.text}</p>
        <button class="text-[10px] font-semibold mt-3 text-white px-3 py-1.5 rounded-lg" style="background: var(--aqua-blue);" onclick="event.stopPropagation(); openChatFor('${id}')">เปิดแชทกับเกษตรกร</button>
      </div>
    `;
  }).join('');
}

function renderWaterAllocationPage() {
  const list = document.getElementById('waList');
  if (!list) return;
  list.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const liters = Math.max(300, Math.round((100 - plotState.moisture) * 32 / 10) * 10);
    const pct = Math.min(100, Math.round(liters / 22));
    return `
      <div class="bar-chart-row">
        <div class="bar-chart-label">${plot.plotCode} · ${plot.name}</div>
        <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${pct}%;"></div></div>
        <div class="bar-chart-value">${liters.toLocaleString()} ล.</div>
      </div>
    `;
  }).join('');
}

function renderAIPredictionPage() {
  const grid = document.getElementById('aiPredGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const advice = plotAdvice(id);
    const confidence = 90 + (PLOT_META[id].fairness % 8);
    const yieldChange = (plotState.moisture >= plot.target - 5 && plotState.moisture <= plot.target + 10) ? '+14.8%' : '+6.2%';
    return `
      <div class="aqua-card rounded-xl p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-bold text-sm text-[var(--ink)]">${plot.plotCode}</div>
          <span class="text-[10px] font-bold text-emerald-600">${confidence}% Confidence</span>
        </div>
        <p class="text-[11px] text-[var(--ink-faint)] mb-3">${plot.name} · ${plot.crop}</p>
        <div class="surface-soft rounded-lg p-3 text-[11.5px] text-[var(--ink)] mb-3">✨ ${advice.text}</div>
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-[var(--ink-faint)]">คาดการณ์ Yield เพิ่มขึ้น</span>
          <span class="font-bold text-emerald-600">${yieldChange}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderIoTPage() {
  const tbody = document.getElementById('iotTable');
  if (!tbody) return;
  tbody.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const meta = PLOT_META[id];
    return `
      <tr class="row-hover">
        <td class="p-4 font-semibold text-[var(--ink)]">${plot.plotCode} <span class="text-[var(--ink-faint)] font-normal">(${plot.name})</span></td>
        <td class="p-4">${Math.round(plotState.moisture)}%</td>
        <td class="p-4">${meta.battery}%</td>
        <td class="p-4">${meta.signal}</td>
        <td class="p-4 text-right text-[var(--ink-faint)]">เมื่อสักครู่</td>
      </tr>
    `;
  }).join('');
}

function renderFarmPage() {
  const grid = document.getElementById('farmGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const meta = PLOT_META[id];
    return `
      <div class="aqua-card rounded-xl p-4">
        <div class="font-bold text-sm text-[var(--ink)]">${plot.plotCode}</div>
        <div class="text-[11px] text-[var(--ink-faint)] mb-3">${plot.zone}</div>
        <div class="space-y-1.5 text-[11.5px] text-[var(--ink-soft)]">
          <div class="flex justify-between"><span>เกษตรกร</span><span class="font-medium text-[var(--ink)]">${plot.name}</span></div>
          <div class="flex justify-between"><span>พืชที่ปลูก</span><span class="font-medium text-[var(--ink)]">${plot.crop}</span></div>
          <div class="flex justify-between"><span>พื้นที่</span><span class="font-medium text-[var(--ink)]">${meta.area}</span></div>
          <div class="flex justify-between"><span>พิกัด</span><span class="font-medium text-[var(--ink)]">${plot.coords}</span></div>
          <div class="flex justify-between"><span>ช่องทางติดต่อ</span><span class="font-medium text-emerald-600">LINE OA เชื่อมต่อแล้ว</span></div>
        </div>
        <button class="text-[10px] font-semibold mt-3 text-white px-3 py-1.5 rounded-lg" style="background: var(--aqua-blue);" onclick="openChatFor('${id}')">เปิดแชทกับเกษตรกร</button>
      </div>
    `;
  }).join('');
}

function renderReportsPage() {
  const bars = document.getElementById('reportsBars');
  if (!bars) return;
  bars.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    return `
      <div class="bar-chart-row">
        <div class="bar-chart-label">${plot.plotCode} · ${plot.name}</div>
        <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${plotState.moisture}%;"></div></div>
        <div class="bar-chart-value">${Math.round(plotState.moisture)}% / ${plot.target}%</div>
      </div>
    `;
  }).join('');
}

function renderAlertsPage() {
  const list = document.getElementById('alertsList');
  if (!list) return;
  const items = [];

  Object.keys(PLOTS).forEach(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const status = moistureStatus(plotState.moisture);
    if (status.key === 'critical') {
      items.push({ tone: 'critical', icon: 'fa-triangle-exclamation', title: `${plot.plotCode} (${plot.name}) ความชื้นต่ำวิกฤต`, sub: `อยู่ที่ ${Math.round(plotState.moisture)}% ต่ำกว่าเป้าหมายมาก ควรรดน้ำโดยด่วน` });
    } else if (status.key === 'dry') {
      items.push({ tone: 'warning', icon: 'fa-droplet', title: `${plot.plotCode} (${plot.name}) ความชื้นต่ำกว่าเกณฑ์`, sub: `อยู่ที่ ${Math.round(plotState.moisture)}% แนะนำให้เปิดน้ำเร็ว ๆ นี้` });
    }
  });

  items.push({ tone: 'info', icon: 'fa-cloud-rain', title: 'พยากรณ์ฝนพรุ่งนี้ 80%', sub: 'ระบบจะปรับลดโควตาน้ำอัตโนมัติหากฝนตกหนัก' });
  items.push({ tone: 'info', icon: 'fa-water', title: 'อ่างเก็บน้ำชุมชนรองรับได้อีก 6 วัน', sub: 'ระดับน้ำต้นทุนยังอยู่ในเกณฑ์ปลอดภัย' });

  list.innerHTML = items.map(it => `
    <div class="alert-item alert-${it.tone}">
      <i class="fa-solid ${it.icon} alert-icon"></i>
      <div>
        <div class="alert-title">${it.title}</div>
        <div class="alert-sub">${it.sub}</div>
      </div>
    </div>
  `).join('');
}

function renderCommunityPage() {
  const grid = document.getElementById('communityGrid');
  if (!grid) return;
  const gradients = { plot1: 'from-sky-400 to-blue-600', plot2: 'from-cyan-400 to-sky-600', plot3: 'from-blue-400 to-indigo-600' };
  grid.innerHTML = Object.keys(PLOTS).map(id => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const meta = PLOT_META[id];
    const initials = plot.name.slice(0, 2);
    return `
      <div class="aqua-card rounded-xl p-4 text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-gradient-to-br ${gradients[id]} flex items-center justify-center text-white text-sm font-bold mb-2">${initials}</div>
        <div class="font-bold text-sm text-[var(--ink)]">${plot.name}</div>
        <div class="text-[10.5px] text-[var(--ink-faint)] mb-3">${plot.plotCode} · ${plot.crop}</div>
        <div class="flex items-center justify-center gap-4 text-[11px] mb-3">
          <div><div class="font-bold text-[var(--aqua-blue)]">${meta.fairness}%</div><div class="text-[var(--ink-faint)] text-[10px]">Fairness</div></div>
          <div><div class="font-bold text-[var(--ink)]">${Math.round(plotState.moisture)}%</div><div class="text-[var(--ink-faint)] text-[10px]">ความชื้น</div></div>
        </div>
        <button class="text-[10px] font-semibold text-white px-3 py-1.5 rounded-lg" style="background: var(--aqua-blue);" onclick="openChatFor('${id}')">เปิดแชท</button>
      </div>
    `;
  }).join('');
}

// ===== Sidebar Collapsible Logic =====
function initSidebarState() {
  const isCollapsed = localStorage.getItem('aquaSidebarCollapsed') === 'true';
  const sideNav = document.getElementById('sideNav');
  if (sideNav && isCollapsed) {
    sideNav.classList.add('collapsed');
  }
}

function toggleSidebar() {
  const sideNav = document.getElementById('sideNav');
  if (!sideNav) return;

  const isCollapsed = sideNav.classList.toggle('collapsed');

  // บันทึกสถานะลงใน localStorage
  try {
    localStorage.setItem('aquaSidebarCollapsed', isCollapsed ? 'true' : 'false');
  } catch (e) { }

  // หากอยู่ในหน้า 3D หรือ แผนที่ Interactive ให้เรียก Trigger Resize เพื่อให้ Canvas ปรับขนาดตามพอดี
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 300);
}

// เรียกทำงานเมื่อโหลดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
  initSidebarState();
});

// ===== Anomaly Detection + Predictive Maintenance =====
function renderAnomalyList() {
  const list = document.getElementById('anomalyList');
  if (!list) return;
  const items = [
    { tone: 'warning', icon: 'fa-triangle-exclamation', title: `${PLOTS.plot2.plotCode} (${PLOTS.plot2.name}): วาล์วสั่งปิดแล้ว แต่ความชื้นยังคงเพิ่มขึ้นต่อเนื่อง`, sub: 'AI สงสัยท่อรั่วหรือวาล์วปิดไม่สนิท แนะนำส่งช่างตรวจสอบหน้างานภายในวันนี้' },
    { tone: 'info', icon: 'fa-circle-check', title: `${PLOTS.plot1.plotCode} และ ${PLOTS.plot3.plotCode}: ไม่พบความผิดปกติ`, sub: 'คำสั่งเปิด/ปิดปั๊มสอดคล้องกับค่าที่เซนเซอร์อ่านได้ตามปกติ' }
  ];
  list.innerHTML = items.map(it => `
    <div class="alert-item alert-${it.tone}">
      <i class="fa-solid ${it.icon} alert-icon"></i>
      <div><div class="alert-title">${it.title}</div><div class="alert-sub">${it.sub}</div></div>
    </div>
  `).join('');
}

function renderMaintenanceList() {
  const list = document.getElementById('maintenanceList');
  if (!list) return;
  const items = [
    { tone: 'warning', icon: 'fa-battery-quarter', title: `${PLOTS.plot1.plotCode}: แบตเตอรี่เซนเซอร์ลดลงเร็วกว่าปกติ (-8%/สัปดาห์)`, sub: 'คาดว่าต้องเปลี่ยนแบตเตอรี่ภายใน ~12 วัน แนะนำเตรียมอะไหล่ล่วงหน้า' },
    { tone: 'info', icon: 'fa-tower-broadcast', title: `${PLOTS.plot3.plotCode}: สัญญาณ LoRaWAN เริ่มไม่เสถียรบางช่วงเวลา`, sub: 'แนะนำตรวจสอบตำแหน่งเสาสัญญาณหรือสิ่งกีดขวางใหม่ในพื้นที่' }
  ];
  list.innerHTML = items.map(it => `
    <div class="alert-item alert-${it.tone}">
      <i class="fa-solid ${it.icon} alert-icon"></i>
      <div><div class="alert-title">${it.title}</div><div class="alert-sub">${it.sub}</div></div>
    </div>
  `).join('');
}

// ===== Carbon Credit Tracking =====
function renderCarbonPage() {
  const dieselEl = document.getElementById('carbonDiesel');
  if (!dieselEl) return;

  const dieselLiters = 1860;
  const electricityKwh = 4120;
  const co2eKg = Math.round(dieselLiters * 2.68 + electricityKwh * 0.4999);
  const trees = Math.round(co2eKg / 21);

  dieselEl.innerText = dieselLiters.toLocaleString() + ' ล.';
  document.getElementById('carbonElectric').innerText = electricityKwh.toLocaleString() + ' kWh';
  document.getElementById('carbonCO2e').innerText = co2eKg.toLocaleString() + ' กก.';
  document.getElementById('carbonTrees').innerText = trees.toLocaleString() + ' ต้น';

  const bars = document.getElementById('carbonBars');
  if (bars) {
    const weights = {};
    let totalWeight = 0;
    Object.keys(PLOTS).forEach(id => {
      const w = Math.max(10, PLOTS[id].target - state.plots[id].moisture + 40);
      weights[id] = w;
      totalWeight += w;
    });
    bars.innerHTML = Object.keys(PLOTS).map(id => {
      const plot = PLOTS[id];
      const pct = Math.round((weights[id] / totalWeight) * 100);
      const share = Math.round((weights[id] / totalWeight) * co2eKg);
      return `
        <div class="bar-chart-row">
          <div class="bar-chart-label">${plot.plotCode} · ${plot.name}</div>
          <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${pct}%;"></div></div>
          <div class="bar-chart-value">${share.toLocaleString()} กก.</div>
        </div>
      `;
    }).join('');
  }
}

// ฟังก์ชันสร้าง Water Sweep Transition แบบ Dynamic
function triggerWaterSweepEffect(onMiddle) {
  // 🟢 ตรวจสอบว่าผู้ใช้เปิดหรือปิด Transition ไว้ (Default = เปิด)
  const isTransitionEnabled = localStorage.getItem('aquaPageTransition') !== 'false';

  // หากปิดใช้งาน ให้เรียกทำงานส่วนกลางทันทีโดยไม่ต้องแสดงเอฟเฟกต์คลื่นน้ำ
  if (!isTransitionEnabled) {
    if (typeof onMiddle === 'function') onMiddle();
    return;
  }

  // สร้าง Layer คลื่นน้ำขึ้นใน DOM
  const curtain = document.createElement('div');
  curtain.className = 'water-sweep-curtain';
  curtain.innerHTML = `
    <div class="water-sweep-wave" id="waterSweepWave"></div>
    <div class="water-sweep-sparkle" id="waterSweepSparkle"></div>
  `;
  document.body.appendChild(curtain);

  const wave = curtain.querySelector('#waterSweepWave');
  const sparkle = curtain.querySelector('#waterSweepSparkle');

  // สั่งรันแอนิเมชันปาดน้ำเข้าครอบหน้าจอ (Phase 1)
  wave.style.animation = 'liquidWaveSweepIn 0.45s cubic-bezier(0.77, 0, 0.175, 1) forwards';
  sparkle.style.transition = 'all 0.45s ease';
  sparkle.style.opacity = '1';
  sparkle.style.transform = 'scale(1.2)';

  // ช่วงกลางของการปาดน้ำ (สั่งเปลี่ยนหน้า / ซ่อน Splash Screen)
  setTimeout(() => {
    if (typeof onMiddle === 'function') onMiddle();

    // สั่งรันแอนิเมชันปาดน้ำออกเปิดเผยหน้าเว็บ (Phase 2)
    wave.style.animation = 'liquidWaveSweepOut 0.45s cubic-bezier(0.77, 0, 0.175, 1) forwards';
    sparkle.style.opacity = '0';

    setTimeout(() => {
      curtain.remove(); // ลบ Layer ออกเมื่อจบ Transition
    }, 450);
  }, 400);
}

// อัปเดตการปิด Welcome Overlay ใน script.js
function initWelcomeOverlay() {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;

  const hasSeen = sessionStorage.getItem(WELCOME_KEY);
  if (hasSeen) {
    overlay.remove();
    return;
  }

  const fillEl = document.getElementById('welcomeLoadingFill');
  const percentEl = document.getElementById('welcomePercentText');
  const textEl = document.getElementById('welcomeLoadingText');

  let progress = 0;
  const statusTexts = [
    'กำลังเชื่อมต่อระบบ AI ดาวเทียม...',
    'คำนวณความชื้นดินรายพิกัด...',
    'โหลดข้อมูลฟาร์มเสมือนจริง...',
    'ระบบพร้อมใช้งาน!'
  ];

  const duration = 2800;
  const intervalTime = 30;
  const increment = 100 / (duration / intervalTime);

  const timer = setInterval(() => {
    progress = Math.min(100, progress + increment);
    const currentInt = Math.floor(progress);

    if (fillEl) fillEl.style.width = currentInt + '%';
    if (percentEl) percentEl.innerText = currentInt + '%';

    if (textEl) {
      if (currentInt < 30) textEl.innerText = statusTexts[0];
      else if (currentInt < 65) textEl.innerText = statusTexts[1];
      else if (currentInt < 90) textEl.innerText = statusTexts[2];
      else textEl.innerText = statusTexts[3];
    }

    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(() => {
        // 🌊 รันเอฟเฟกต์คลื่นน้ำปาดหน้าจอทันทีเมื่อโหลดถึง 100%
        triggerWaterSweepEffect(() => {
          overlay.classList.add('water-transition-out');
          sessionStorage.setItem(WELCOME_KEY, 'true');
          setTimeout(() => overlay.remove(), 800);
        });
      }, 300);
    }
  }, intervalTime);
}

// ==================== ระบบ Custom Modal & ล้างประวัติการสนทนา ====================
let confirmModalCallback = null;

function clearChatHistory() {
  // เปิด Custom Modal แบบสวยงาม
  openConfirmModal((confirmed) => {
    if (!confirmed) return;

    // ล้างข้อความแชททุกแปลงกลับเป็นข้อความทักทายเริ่มต้น
    Object.keys(PLOTS).forEach(id => {
      if (state.plots[id]) {
        state.plots[id].messages = [{ from: 'bot', text: PLOTS[id].greeting }];
      }
    });

    // บันทึกสถานะลง localStorage และรีเรนเดอร์หน้าแชทใหม่
    saveState();
    renderChatMessages();

    // ส่งแจ้งเตือน
    if (typeof addNotification === 'function') {
      addNotification(
        '🗑️ ล้างประวัติแชทเรียบร้อย',
        'ระบบได้ทำการล้างประวัติข้อความการสนทนาของทุกแปลงแล้ว',
        'info'
      );
    }

    if (typeof showSavingIndicator === 'function') {
      showSavingIndicator();
    }
  });
}

// ==================== ระบบ Custom Modal สำหรับล้างแคช ====================
let clearCacheModalCallback = null;

function clearAppCache() {
  openClearCacheModal((confirmed) => {
    if (!confirmed) return;

    try {
      // 1. ล้างข้อมูลใน LocalStorage และ SessionStorage
      localStorage.clear();
      sessionStorage.clear();

      // 2. ล้าง Service Worker Caches (PWA Cache)
      if ('caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => {
            caches.delete(name);
          });
        });
      }

      // 3. ล้างการลงทะเบียน Service Worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => {
            registration.unregister();
          });
        });
      }

      // 4. รีโหลดหน้าเว็บใหม่ทันที
      window.location.reload();
    } catch (e) {
      console.error('AQUA AI: เกิดข้อผิดพลาดในการล้างแคช', e);
      alert('ไม่สามารถล้างแคชได้ในขณะนี้');
    }
  });
}

function openClearCacheModal(callback) {
  clearCacheModalCallback = callback;
  const modal = document.getElementById('customClearCacheModal');
  if (modal) modal.classList.remove('hidden');
}

function closeClearCacheModal(confirmed) {
  const modal = document.getElementById('customClearCacheModal');
  if (modal) modal.classList.add('hidden');
  if (clearCacheModalCallback) {
    clearCacheModalCallback(confirmed);
    clearCacheModalCallback = null;
  }
}

function openConfirmModal(callback) {
  confirmModalCallback = callback;
  const modal = document.getElementById('customConfirmModal');
  if (modal) modal.classList.remove('hidden');
}

function closeConfirmModal(confirmed) {
  const modal = document.getElementById('customConfirmModal');
  if (modal) modal.classList.add('hidden');
  if (confirmModalCallback) {
    confirmModalCallback(confirmed);
    confirmModalCallback = null;
  }
}

// ===== Corporate ROI Calculator =====
function calcROI() {
  const plotsInput = document.getElementById('roiPlots');
  if (!plotsInput) return;
  const plots = parseFloat(plotsInput.value) || 0;
  const cost = parseFloat(document.getElementById('roiCostPerPlot').value) || 0;
  const value = parseFloat(document.getElementById('roiValuePerPlot').value) || 0;

  const totalCost = plots * cost;
  const totalValue = plots * value;
  const net = totalValue - totalCost;
  const roiPct = totalCost > 0 ? Math.round((net / totalCost) * 100) : 0;
  const payback = (net > 0 && totalValue > 0) ? (totalCost / (totalValue / 12)) : null;

  const fmt = n => '฿' + Math.round(n).toLocaleString();
  document.getElementById('roiOutCost').innerText = fmt(totalCost);
  document.getElementById('roiOutValue').innerText = fmt(totalValue);
  document.getElementById('roiOutNet').innerText = fmt(net);
  document.getElementById('roiOutPct').innerText = roiPct + '%';
  document.getElementById('roiOutPayback').innerText = payback ? payback.toFixed(1) + ' เดือน' : '—';
}

function renderROIPage() {
  if (!document.getElementById('roiPlots')) return;
  calcROI();
}

// ===== Water Scheduling Engine =====
function renderSchedulingPage() {
  const tbody = document.getElementById('schedulingTable');
  if (!tbody) return;

  const ordered = Object.keys(PLOTS).slice().sort((a, b) => state.plots[a].moisture - state.plots[b].moisture);
  const slotLength = 25;
  let startMinutes = 6 * 60;

  const fmtTime = m => {
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  tbody.innerHTML = ordered.map((id, idx) => {
    const plot = PLOTS[id];
    const plotState = state.plots[id];
    const from = startMinutes + idx * slotLength;
    const to = from + slotLength;
    const reason = idx === 0
      ? `ความชื้นต่ำสุดในชุมชน (${Math.round(plotState.moisture)}%) ให้คิวก่อน`
      : (plotState.moisture > plot.target ? 'ความชื้นเพียงพอแล้ว จัดเป็นคิวสำรอง' : `รอคิวตามลำดับความชื้น (${Math.round(plotState.moisture)}%)`);
    return `
      <tr class="row-hover">
        <td class="p-4 font-bold text-[var(--aqua-blue)]">#${idx + 1}</td>
        <td class="p-4 font-semibold text-[var(--ink)]">${plot.plotCode} <span class="text-[var(--ink-faint)] font-normal">(${plot.name})</span></td>
        <td class="p-4">${fmtTime(from)} – ${fmtTime(to)}</td>
        <td class="p-4 text-[var(--ink-soft)]">${reason}</td>
      </tr>
    `;
  }).join('');
}

// ==================== ระบบสลับเปิด/ปิด Page Transition ====================
function initPageTransitionSetting() {
  const saved = localStorage.getItem('aquaPageTransition');
  // ค่าเริ่มต้นเป็น true (เปิดใช้งาน)
  const isEnabled = saved === null ? true : saved === 'true';
  const switchEl = document.getElementById('settingsTransitionSwitch');
  if (switchEl) switchEl.classList.toggle('on', isEnabled);
}

function togglePageTransition() {
  const switchEl = document.getElementById('settingsTransitionSwitch');
  if (!switchEl) return;
  const isOn = switchEl.classList.toggle('on');
  localStorage.setItem('aquaPageTransition', isOn ? 'true' : 'false');

  if (typeof showSavingIndicator === 'function') {
    showSavingIndicator();
  }
}

// ===== LINE Report Preview =====
function renderWeeklyReportPreview() {
  const el = document.getElementById('weeklyReportPreview');
  if (!el) return;
  const ids = Object.keys(PLOTS);
  const avgMoisture = Math.round(ids.reduce((sum, id) => sum + state.plots[id].moisture, 0) / ids.length);
  const lowPlot = ids.reduce((min, id) => (state.plots[id].moisture < state.plots[min].moisture ? id : min), ids[0]);

  el.innerHTML = `📊 <strong>สรุปสัปดาห์นี้</strong><br>💧 ความชื้นเฉลี่ยทุกแปลง ${avgMoisture}%<br>🌱 คาดการณ์ Yield เพิ่มขึ้น +14.8%<br>⚠️ ${PLOTS[lowPlot].plotCode} (${PLOTS[lowPlot].name}) ควรเฝ้าระวังความชื้นต่ำสุดในสัปดาห์นี้<br><br><span style="opacity:.7">ส่งอัตโนมัติทุกวันจันทร์ 08:00 น.</span>`;
}

// ==================== ระบบ Tutorial Onboarding Guide ====================
const GUIDE_KEY = 'aquaAi_guideSeen_v1';
const GUIDE_TODAY_KEY = 'aquaAi_guideDontShowToday';
let currentGuideStep = 1;
const TOTAL_GUIDE_STEPS = 4;

const GUIDE_STEPS_DATA = [
  {
    step: 1,
    badge: 'ขั้นตอนที่ 1 จาก 4',
    icon: 'fa-brands fa-line',
    iconBg: 'from-emerald-400 to-teal-600',
    title: '1. LINE OA สำหรับเกษตรกร',
    desc: 'อินเทอร์เฟซหลักฝั่งเกษตรกร ออกแบบให้ใช้งานง่ายผ่าน LINE:',
    bullets: [
      '<strong>ตรวจความชื้นดิน:</strong> เช็กค่าความชื้นรายพิกัดจากดาวเทียม',
      '<strong>AI แนะนำการให้น้ำ:</strong> คำนวณปริมาณน้ำที่เหมาะสมต่อพืช',
      '<strong>สั่งเปิด/ปิดปั๊มน้ำ:</strong> ควบคุมวาล์วสูบน้ำหน้างานได้ทันที'
    ]
  },
  {
    step: 2,
    badge: 'ขั้นตอนที่ 2 จาก 4',
    icon: 'fa-solid fa-chart-line',
    iconBg: 'from-sky-400 to-blue-600',
    title: '2. Centralized Corporate Dashboard',
    desc: 'ศูนย์ควบคุมส่วนกลางสำหรับโรงงานน้ำตาล / สหกรณ์ / อบต.:',
    bullets: [
      '<strong>ติดตามเรียลไทม์:</strong> ดูระดับความชื้นและสถานะปั๊มทุกแปลงพร้อมกัน',
      '<strong>Interactive Map:</strong> แผนที่แสดงโซนสีเตือนความชื้นวิกฤต (สีแดง)',
      '<strong>สลับแปลงรวดเร็ว:</strong> คลิกจุดบนแผนที่เพื่อเปิดแชทของแปลงนั้น'
    ]
  },
  {
    step: 3,
    badge: 'ขั้นตอนที่ 3 จาก 4',
    icon: 'fa-solid fa-cube',
    iconBg: 'from-indigo-400 to-purple-600',
    title: '3. 3D Digital Twin ฟาร์มเสมือนจริง',
    desc: 'จำลองฟาร์ม 3 มิติ เพื่อเห็นภาพการเจริญเติบโตของพืชพรรณ:',
    bullets: [
      '<strong>การเติบโตตามความชื้น:</strong> พืชเปลี่ยนสีสดชื่นและเติบโตเมื่อได้น้ำ',
      '<strong>ระบบหัวสปริงเกลอร์ & วาล์ว:</strong> แสดงเอฟเฟกต์การพ่นน้ำและปั๊มจริง',
      '<strong>สัตว์เลี้ยงและบรรยากาศ:</strong> เติมชีวิตชีวาให้การมอนิเตอร์ฟาร์ม'
    ]
  },
  {
    step: 4,
    badge: 'ขั้นตอนที่ 4 จาก 4',
    icon: 'fa-solid fa-gear',
    iconBg: 'from-amber-400 to-orange-600',
    title: '4. ระบบอัตโนมัติและการตั้งค่า',
    desc: 'เพิ่มประสิทธิภาพการดูแลแปลงแบบไร้กังวล:',
    bullets: [
      '<strong>เปิดวาล์วอัตโนมัติ (<10%):</strong> รดน้ำให้อัตโนมัติเมื่อดินแห้งวิกฤต',
      '<strong>ปรับขนาดตัวอักษร:</strong> เพิ่มขนาดข้อความให้อ่านง่ายสำหรับผู้สูงวัย',
      '<strong>ซิงค์ข้อมูล Cloud & PWA:</strong> รองรับการออฟไลน์และบันทึกค่าในเครื่อง'
    ]
  }
];

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initGuideOverlay() {
  const modal = document.getElementById('guideModal');
  
  // 🟢 [สำคัญ] บังคับซ่อน Modal ทันทีที่ระบบเริ่มทำงาน เพื่อลบปัญหา HTML โชว์ค้าง
  if (modal) {
    modal.classList.add('hidden');
  }

  const todayStr = getTodayString();
  const dontShowDate = localStorage.getItem(GUIDE_TODAY_KEY);
  const hasSeen = localStorage.getItem(GUIDE_KEY);

  // 🛡️ เช็กเงื่อนไข: หากเลือก "ไม่แสดงอีกในวันนี้" หรือเคยปิดไปแล้ว ให้หยุดทำงานทันที (ไม่เปิดขึ้นมา)
  if (dontShowDate === todayStr || hasSeen === 'true') {
    return;
  }

  // หากยังไม่เคยปิด ให้แสดงหลัง Splash Screen โหลดเสร็จ (3.2 วินาที)
  setTimeout(() => {
    openGuideModal(1);
  }, 3200);
}

// กดปุ่มปิด (✕) หรือกดปุ่ม "เริ่มใช้งานเลย"
function closeGuideModal() {
  const modal = document.getElementById('guideModal');
  if (modal) modal.classList.add('hidden');
  try {
    localStorage.setItem(GUIDE_KEY, 'true');
  } catch (e) {}
}

// 🟢 กดปุ่ม "ไม่แสดงอีกในวันนี้"
function dontShowGuideToday() {
  const modal = document.getElementById('guideModal');
  if (modal) modal.classList.add('hidden');
  try {
    const todayStr = getTodayString();
    localStorage.setItem(GUIDE_TODAY_KEY, todayStr);
    localStorage.setItem(GUIDE_KEY, 'true');
  } catch (e) {}

  if (typeof showSavingIndicator === 'function') {
    showSavingIndicator();
  }
}

function openGuideModal(step = 1) {
  currentGuideStep = step;
  renderGuideStep();
  const modal = document.getElementById('guideModal');
  if (modal) modal.classList.remove('hidden');
}

function renderGuideStep() {
  const data = GUIDE_STEPS_DATA[currentGuideStep - 1];
  const container = document.getElementById('guideContent');
  if (!container || !data) return;

  container.innerHTML = `
    <div class="guide-slide-body">
      <div class="guide-badge">${data.badge}</div>
      <div class="guide-icon-circle bg-gradient-to-br ${data.iconBg}">
        <i class="${data.icon}"></i>
      </div>
      <h3 class="guide-title">${data.title}</h3>
      <p class="guide-desc">${data.desc}</p>
      <ul class="guide-bullets">
        ${data.bullets.map(b => `<li><i class="fa-solid fa-circle-check text-sky-500"></i> <span>${b}</span></li>`).join('')}
      </ul>
    </div>
  `;

  const dots = document.querySelectorAll('#guideStepDots .guide-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentGuideStep - 1);
  });

  const prevBtn = document.getElementById('guidePrevBtn');
  const nextBtn = document.getElementById('guideNextBtn');

  if (prevBtn) prevBtn.classList.toggle('hidden', currentGuideStep === 1);
  if (nextBtn) {
    if (currentGuideStep === TOTAL_GUIDE_STEPS) {
      nextBtn.innerHTML = 'เริ่มใช้งานเลย <i class="fa-solid fa-check ml-1"></i>';
      nextBtn.className = 'guide-btn btn-success ml-auto';
    } else {
      nextBtn.innerHTML = 'ถัดไป <i class="fa-solid fa-chevron-right ml-1"></i>';
      nextBtn.className = 'guide-btn btn-primary ml-auto';
    }
  }
}

function nextGuideStep() {
  if (currentGuideStep < TOTAL_GUIDE_STEPS) {
    currentGuideStep++;
    renderGuideStep();
  } else {
    closeGuideModal();
  }
}

function prevGuideStep() {
  if (currentGuideStep > 1) {
    currentGuideStep--;
    renderGuideStep();
  }
}

// ===== Offline-First PWA =====
function updateOfflineUI() {
  const banner = document.getElementById('offlineBanner');
  const badge = document.getElementById('offlineStatusBadge');
  const isOnline = navigator.onLine;

  if (banner) banner.classList.toggle('visible', !isOnline);
  if (badge) {
    badge.className = 'text-[10px] font-bold flex items-center gap-1.5 flex-shrink-0 ' + (isOnline ? 'text-emerald-600' : 'text-amber-600');
    badge.innerHTML = isOnline
      ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Online'
      : '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Offline (ใช้ข้อมูลล่าสุด)';
  }
}

function initPWA() {
  updateOfflineUI();
  window.addEventListener('online', updateOfflineUI);
  window.addEventListener('offline', updateOfflineUI);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    });
  }
}

// ===== Simulated Weather for Roi Et, Thailand =====
function getSimulatedWeather() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const hour = now.getHours();
  const isRainy = month >= 4 && month <= 9; // พฤษภาคม - ตุลาคม (ฤดูฝน)

  let baseTemp, rainChance, condition, icon;

  if (hour >= 5 && hour < 9) {
    baseTemp = isRainy ? 24 : 20;
    condition = isRainy ? 'หมอกเบา' : 'อากาศเย็น';
    icon = isRainy ? 'fa-smog' : 'fa-sun';
  } else if (hour >= 9 && hour < 15) {
    baseTemp = isRainy ? 31 : 34;
    condition = isRainy ? 'เมฆมาก' : 'แดดจัด';
    icon = isRainy ? 'fa-cloud-sun' : 'fa-sun';
  } else if (hour >= 15 && hour < 19) {
    baseTemp = isRainy ? 28 : 30;
    condition = 'อากาศดี';
    icon = 'fa-cloud-sun';
  } else {
    baseTemp = isRainy ? 25 : 22;
    condition = isRainy ? 'มีฝนบางพื้นที่' : 'อากาศเย็นสบาย';
    icon = isRainy ? 'fa-cloud-moon-rain' : 'fa-moon';
  }

  // สุ่มค่าผันผวนเล็กน้อย
  const temp = baseTemp + Math.floor(Math.random() * 3) - 1;

  if (isRainy) {
    if (hour >= 13 && hour <= 17) {
      rainChance = 50 + Math.floor(Math.random() * 40);
      if (rainChance > 70) { condition = 'ฝนตกหนัก'; icon = 'fa-cloud-showers-heavy'; }
      else if (rainChance > 40) { condition = 'ฝนตก'; icon = 'fa-cloud-rain'; }
      else { condition = 'เมฆมาก'; icon = 'fa-cloud'; }
    } else if (hour >= 5 && hour <= 11) {
      rainChance = 20 + Math.floor(Math.random() * 25);
    } else {
      rainChance = 30 + Math.floor(Math.random() * 30);
    }
  } else {
    rainChance = Math.floor(Math.random() * 10);
    if (hour >= 11 && hour <= 15) { condition = 'แดดจัด'; icon = 'fa-sun'; }
  }

  return { temp, rainChance, condition, icon };
}

function updateWeatherBadge() {
  const container = document.getElementById('topBarWeather');
  const iconEl = document.getElementById('weatherIcon');
  const valueEl = document.getElementById('weatherValue');

  // 🌤️ ดึง Element ของหน้า 3D HUD
  const icon3D = document.getElementById('weatherIcon3D');
  const value3D = document.getElementById('weatherValue3D');

  const w = getSimulatedWeather();

  // อัปเดตหน้า Dashboard (index.html)
  if (iconEl) iconEl.className = `fa-solid ${w.icon} text-amber-400`;
  if (valueEl) valueEl.innerText = `${w.condition} ${w.rainChance}% · ${w.temp}°C`;

  // อัปเดตหน้า 3D HUD (3d.html)
  if (icon3D) icon3D.className = `fa-solid ${w.icon} text-amber-400`;
  if (value3D) value3D.innerText = `${w.condition} ${w.rainChance}% · ${w.temp}°C`;
}

// ===== Init App =====
function renderAllDashboardRows() {
  Object.keys(PLOTS).forEach(id => {
    const plotState = state.plots[id];
    updateDashboardRow(id, plotState.pumpOn);
  });
}

function initApp() {
  initFontSize();
  updateWeatherBadge();
  initAutoOpenValveSetting();
  initPageTransitionSetting();
  initGuideOverlay();
  if (weatherInterval) clearInterval(weatherInterval);
  weatherInterval = setInterval(updateWeatherBadge, 60000); // รีเฟรชสภาพอากาศทุกๆ 1 นาที

  initWelcomeOverlay();
  initTheme();
  initAnimalsSetting();
  initPWA();

  updateBangkokClock();
  setInterval(updateBangkokClock, 1000); // อัปเดตนาฬิกาทุก 1 วินาที
  initWelcomeNotification(); // ส่งแจ้งเตือน Welcome ทุกครั้งที่เปิด/รีเฟรชเว็บ

  renderContactChips();
  renderChatHeader();
  renderChatMessages();
  syncPumpButtonUI();
  renderAllDashboardRows();
  highlightDashboardRow();
  renderMap();
  renderAllPages();

  // 🚀 สั่งงาน Loop ทั้งเพิ่มน้ำและลดน้ำทันทีเมื่อโหลดหน้าเว็บ
  Object.keys(PLOTS).forEach(id => {
    if (state.plots[id].pumpOn) {
      startMoistureSimulation(id);
    } else {
      startMoistureDrain(id);
      checkUrgentMoisture(id); // เผื่อโหลดหน้ามาแล้วความชื้นต่ำกว่า 20% อยู่แล้ว
    }
  });

  initScrollSpy();
}

document.addEventListener('DOMContentLoaded', initApp);

// ==================== ระบบปฏิทินภาษาไทยแบบ Interactive ====================
let calCurrentDate = new Date(); // เก็บเดือน/ปี ที่กำลังเปิดดูในปฏิทิน

// สลับการซ่อน/แสดง ปฏิทิน
function toggleCalendarDropdown(e) {
  if (e) e.stopPropagation();
  const cal = document.getElementById('calendarDropdown');
  const notif = document.getElementById('notifDropdown');

  // ปิด Notif Dropdown ก่อนถ้าเปิดค้างอยู่
  if (notif) notif.classList.add('hidden');

  if (cal) {
    const isHidden = cal.classList.contains('hidden');
    cal.classList.toggle('hidden');
    if (isHidden) {
      calCurrentDate = new Date(); // เปิดมาให้ตั้งต้นที่เดือนปัจจุบันเสมอ
      renderCalendar();
    }
  }
}

// เลื่อนเปลี่ยนเดือน (-1 คือเดือนก่อน, 1 คือเดือนถัดไป)
function changeCalMonth(delta) {
  calCurrentDate.setMonth(calCurrentDate.getMonth() + delta);
  renderCalendar();
}

// กดปุ่มกลับมาวันปัจจุบัน
function resetCalToToday() {
  calCurrentDate = new Date();
  renderCalendar();
}

// คำนวณวันและวาดตารางปฏิทิน
function renderCalendar() {
  const titleEl = document.getElementById('calMonthYearTitle');
  const gridEl = document.getElementById('calDaysGrid');
  if (!titleEl || !gridEl) return;

  const yearBE = calCurrentDate.getFullYear() + 543;
  const monthIndex = calCurrentDate.getMonth();

  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  // อัปเดตหัวข้อ เดือน พ.ศ.
  titleEl.innerText = `${monthNames[monthIndex]} ${yearBE}`;

  // หาจุดเริ่มต้นและจำนวนวันของเดือน
  const firstDayIndex = new Date(calCurrentDate.getFullYear(), monthIndex, 1).getDay();
  const totalDays = new Date(calCurrentDate.getFullYear(), monthIndex + 1, 0).getDate();
  const prevMonthTotalDays = new Date(calCurrentDate.getFullYear(), monthIndex, 0).getDate();

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calCurrentDate.getFullYear() && today.getMonth() === calCurrentDate.getMonth();

  let html = '';

  // วันของเดือนก่อนหน้า (แสดงตัวเลขจางๆ)
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthTotalDays - i;
    html += `<div class="cal-day other-month">${dayNum}</div>`;
  }

  // วันของเดือนปัจจุบัน
  for (let day = 1; day <= totalDays; day++) {
    const isToday = isCurrentMonth && day === today.getDate();
    html += `<div class="cal-day current-month ${isToday ? 'is-today' : ''}">${day}</div>`;
  }

  // วันของเดือนถัดไป (เติมช่องที่เหลือให้ครบตาราง)
  const totalCells = firstDayIndex + totalDays;
  const nextDays = (7 - (totalCells % 7)) % 7;
  for (let j = 1; j <= nextDays; j++) {
    html += `<div class="cal-day other-month">${j}</div>`;
  }

  gridEl.innerHTML = html;
}

// ปิดปฏิทินอัตโนมัติเมื่อคลิกพื้นที่อื่นภายนอก
document.addEventListener('click', (e) => {
  const cal = document.getElementById('calendarDropdown');
  const datePill = document.querySelector('.top-pill[onclick*="toggleCalendarDropdown"]');
  if (cal && !cal.contains(e.target) && datePill && !datePill.contains(e.target)) {
    cal.classList.add('hidden');
  }
});

// ==================== ระบบสลับทิศทางลูกศรตามตำแหน่ง Scroll ====================
function updateFloatingAlertDirection() {
  const arrowEl = document.getElementById('floatingAlertArrow');
  const mapCard = document.getElementById('interactiveMapCard') || document.getElementById('mapCanvas');
  if (!arrowEl || !mapCard) return;

  const rect = mapCard.getBoundingClientRect();

  // ตรวจสอบว่าหน้าจอเลื่อนมาถึง/เลยการ์ดแผนที่ไปแล้วหรือยัง
  if (rect.top < window.innerHeight / 2) {
    // อยู่ที่แผนที่ หรือเลื่อนเลยลงมาแล้ว -> เปลี่ยนเป็นลูกศรชี้ขึ้น ↑
    arrowEl.className = 'fa-solid fa-arrow-up ml-1';
  } else {
    // อยู่เหนือแผนที่ -> เป็นลูกศรชี้ลง ↓
    arrowEl.className = 'fa-solid fa-arrow-down ml-1';
  }
}

// ผูกฟังก์ชันเข้ากับเหตุการณ์การเลื่อนหน้าจอ (Scroll Event)
window.addEventListener('scroll', updateFloatingAlertDirection);
document.addEventListener('scroll', updateFloatingAlertDirection);