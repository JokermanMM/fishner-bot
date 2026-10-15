(() => {
  "use strict";

  const telegram = window.Telegram?.WebApp;
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const demoSessions = [
    {
      id: "00000000-0000-0000-0000-000000000001", createdByName: "Максим Шнер", latitude: 55.7539,
      longitude: 37.6208, waterbody: "Большое озеро", caughtOn: "2026-10-10", lure: "Джиг, зелёный силикон",
      disposition: "released", notes: "Взяли у камыша на третьей проводке.", photos: [],
      fishes: [
        { id: "f1", ownerName: "Максим Шнер", speciesName: "Щука", weightGrams: 5820, lengthMm: 890 },
        { id: "f2", ownerName: "Антон", speciesName: "Окунь", weightGrams: 840, lengthMm: 390 },
      ],
    },
    {
      id: "00000000-0000-0000-0000-000000000002", createdByName: "Антон", latitude: 55.641,
      longitude: 37.522, waterbody: "Тихая заводь", caughtOn: "2026-10-08", lure: "Кукуруза",
      disposition: "kept", notes: "Утренняя поклёвка перед туманом.", photos: [],
      fishes: [{ id: "f3", ownerName: "Саша", speciesName: "Сазан", weightGrams: 4310, lengthMm: 710 }],
    },
  ];
  const state = {
    sessions: [], filtered: [], viewer: null, map: null, markers: [], media: new Map(),
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selectedDay: null,
  };

  const elements = {
    status: document.querySelector("#status-card"), welcome: document.querySelector("#welcome"),
    heroStats: document.querySelector("#hero-stats"), catchGrid: document.querySelector("#catch-grid"),
    galleryCount: document.querySelector("#gallery-count"), speciesFilter: document.querySelector("#species-filter"),
    anglerFilter: document.querySelector("#angler-filter"), mapCount: document.querySelector("#map-count"),
    mapEmpty: document.querySelector("#map-empty"), calendarTitle: document.querySelector("#calendar-title"),
    calendarGrid: document.querySelector("#calendar-grid"), dayList: document.querySelector("#day-list"),
    recordHero: document.querySelector("#record-hero"), anglerBars: document.querySelector("#angler-bars"),
    speciesBars: document.querySelector("#species-bars"), recordsList: document.querySelector("#records-list"),
    dialog: document.querySelector("#catch-dialog"), dialogMedia: document.querySelector("#dialog-media"),
    dialogBody: document.querySelector("#dialog-body"), emptyTemplate: document.querySelector("#empty-template"),
  };

  const mediaObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          mediaObserver.unobserve(entry.target);
          const session = state.sessions.find((item) => item.id === entry.target.dataset.mediaFor);
          if (session?.photos[0]) void attachPhoto(entry.target, session.photos[0], `Улов на ${session.waterbody ?? "водоёме"}`);
        }
      }, { rootMargin: "240px 0px" })
    : null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
    })[character]);
  }

  function formatWeight(grams) {
    if (grams < 1000) return `${grams} г`;
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(grams / 1000)} кг`;
  }

  function formatLength(millimeters) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(millimeters / 10)} см`;
  }

  function dateValue(date) { return new Date(`${date.slice(0, 10)}T12:00:00.000Z`); }
  function shortDate(date) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(dateValue(date)); }
  function longDate(date) { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(dateValue(date)); }

  function plural(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function allFish() {
    return state.sessions.flatMap((session) => session.fishes.map((fish) => ({ ...fish, session })));
  }

  function setStatus(kind, title, message) {
    if (kind === "hidden") { elements.status.hidden = true; return; }
    elements.status.hidden = false;
    elements.status.classList.toggle("is-error", kind === "error");
    elements.status.innerHTML = `${kind === "loading" ? '<div class="spinner" aria-hidden="true"></div>' : ""}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  }

  function emptyState() { return elements.emptyTemplate.content.cloneNode(true); }

  function setupTelegram() {
    if (!telegram) return;
    telegram.ready(); telegram.expand();
    telegram.setHeaderColor?.("#071d2a"); telegram.setBackgroundColor?.("#061b27");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "x-telegram-init-data": telegram?.initData ?? "", ...(options.headers ?? {}) } });
    if (!response.ok) {
      let message = "Не удалось загрузить дневник";
      try { message = (await response.json()).error ?? message; } catch { /* not JSON */ }
      throw new Error(message);
    }
    return response;
  }

  async function loadData() {
    if (isLocalPreview && !telegram?.initData) return { viewer: { id: 1, firstName: "Максим" }, sessions: demoSessions };
    if (!telegram?.initData) throw new Error("Откройте дневник кнопкой «Открыть дневник» внутри @fishner_bot");
    return (await api("/api/mini-app/bootstrap", { method: "POST" })).json();
  }

  function renderHero() {
    const fishes = allFish();
    const totalWeight = fishes.reduce((sum, item) => sum + item.weightGrams, 0);
    const species = new Set(fishes.map((item) => item.speciesName.toLocaleLowerCase("ru-RU")));
    elements.welcome.textContent = state.viewer?.firstName ? `${state.viewer.firstName}, вот что поймала наша компания` : "Общий дневник друзей";
    elements.heroStats.innerHTML = `
      <div><strong>${fishes.length}</strong><span>${plural(fishes.length, ["рыба", "рыбы", "рыб"])}</span></div>
      <div><strong>${formatWeight(totalWeight)}</strong><span>общий вес</span></div>
      <div><strong>${species.size}</strong><span>${plural(species.size, ["вид", "вида", "видов"])}</span></div>`;
  }

  function fillFilters() {
    const fishes = allFish();
    const species = [...new Set(fishes.map((item) => item.speciesName))].sort((a, b) => a.localeCompare(b, "ru"));
    const anglers = [...new Set(fishes.map((item) => item.ownerName))].sort((a, b) => a.localeCompare(b, "ru"));
    for (const value of species) elements.speciesFilter.add(new Option(value, value));
    for (const value of anglers) elements.anglerFilter.add(new Option(value, value));
  }

  function applyFilters() {
    const species = elements.speciesFilter.value;
    const angler = elements.anglerFilter.value;
    state.filtered = state.sessions.filter((session) => session.fishes.some((fish) =>
      (!species || fish.speciesName === species) && (!angler || fish.ownerName === angler)));
    renderGallery();
  }

  function fishSummary(session) {
    const counts = new Map();
    for (const fish of session.fishes) counts.set(fish.speciesName, (counts.get(fish.speciesName) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(", ");
  }

  function anglerSummary(session) {
    return [...new Set(session.fishes.map((fish) => fish.ownerName))].join(", ");
  }

  function renderGallery() {
    mediaObserver?.disconnect(); elements.catchGrid.replaceChildren();
    elements.galleryCount.textContent = String(state.filtered.length);
    if (!state.filtered.length) { elements.catchGrid.append(emptyState()); return; }
    for (const session of state.filtered) {
      const totalWeight = session.fishes.reduce((sum, fish) => sum + fish.weightGrams, 0);
      const card = document.createElement("button");
      card.type = "button"; card.className = "catch-card";
      card.innerHTML = `
        <div class="catch-card__media" data-media-for="${session.id}">
          <span class="catch-card__badge">${session.photos.length > 1 ? `📷 ${session.photos.length}` : escapeHtml(anglerSummary(session))}</span>
          ${session.photos.length > 1 ? `<span class="catch-card__angler">${escapeHtml(anglerSummary(session))}</span>` : ""}
        </div>
        <div class="catch-card__body">
          <h3>${escapeHtml(fishSummary(session))}</h3>
          <div class="catch-card__weight">${session.fishes.length} ${plural(session.fishes.length, ["рыба", "рыбы", "рыб"])} · ${formatWeight(totalWeight)}</div>
          <div class="catch-card__meta"><span>${escapeHtml(session.waterbody ?? "Место не указано")}</span><span>${shortDate(session.caughtOn)}</span></div>
        </div>`;
      card.addEventListener("click", () => openSession(session));
      elements.catchGrid.append(card);
      const container = card.querySelector(".catch-card__media");
      if (session.photos[0]) {
        if (mediaObserver) mediaObserver.observe(container); else void attachPhoto(container, session.photos[0], fishSummary(session));
      }
    }
  }

  async function mediaUrl(photo) {
    if (state.media.has(photo.id)) return state.media.get(photo.id);
    const response = await api(`/api/mini-app/media/${photo.id}`);
    const url = URL.createObjectURL(await response.blob());
    state.media.set(photo.id, url);
    return url;
  }

  async function attachPhoto(container, photo, alt) {
    if (!container || !photo) return;
    try {
      const image = document.createElement("img");
      image.src = await mediaUrl(photo); image.alt = alt; image.loading = "lazy";
      container.append(image);
    } catch { container.classList.add("media-error"); }
  }

  function openSession(session) {
    elements.dialogMedia.replaceChildren();
    elements.dialogMedia.classList.toggle("is-gallery", session.photos.length > 1);
    for (const [index, photo] of session.photos.entries()) {
      const frame = document.createElement("div"); frame.className = "dialog-photo";
      if (session.photos.length > 1) frame.innerHTML = `<span>${index + 1} / ${session.photos.length}</span>`;
      elements.dialogMedia.append(frame); void attachPhoto(frame, photo, fishSummary(session));
    }
    const fishRows = session.fishes.map((fish, index) => `
      <div class="fish-detail">
        <span>${index + 1}</span>
        <div><strong>${escapeHtml(fish.speciesName)}</strong><small>Поймал: ${escapeHtml(fish.ownerName)}</small></div>
        <b>${formatWeight(fish.weightGrams)}${fish.lengthMm ? `<small>${formatLength(fish.lengthMm)}</small>` : ""}</b>
      </div>`).join("");
    elements.dialogBody.innerHTML = `
      <span class="kicker">${session.fishes.length} ${plural(session.fishes.length, ["рыба", "рыбы", "рыб"])} в одном улове</span>
      <h2>${escapeHtml(fishSummary(session))}</h2>
      <div class="fish-details">${fishRows}</div>
      <div class="detail-grid">
        <div><small>Дата</small>${escapeHtml(longDate(session.caughtOn))}</div>
        <div><small>Место</small>${escapeHtml(session.waterbody ?? "Не указано")}</div>
        <div><small>Приманка</small>${escapeHtml(session.lure ?? "Не указана")}</div>
        <div><small>Рыба</small>${session.disposition === "released" ? "Отпущена ♻️" : session.disposition === "kept" ? "Забрана 🧺" : "Не указано"}</div>
      </div>
      ${session.notes ? `<div class="detail-note">${escapeHtml(session.notes)}</div>` : ""}
      <div class="added-by">Запись добавил: ${escapeHtml(session.createdByName)}</div>
      <div class="detail-actions">
        <a class="manage-link" href="https://t.me/fishner_bot?start=manage_${session.id}">✎ Управлять уловом</a>
        ${session.latitude != null && session.longitude != null ? `<a class="map-link" href="https://www.openstreetmap.org/?mlat=${session.latitude}&mlon=${session.longitude}#map=15/${session.latitude}/${session.longitude}" target="_blank" rel="noreferrer">⌖ Открыть точную точку</a>` : ""}
      </div>`;
    elements.dialogBody.querySelector(".manage-link")?.addEventListener("click", (event) => {
      if (!telegram?.openTelegramLink) return;
      event.preventDefault();
      telegram.openTelegramLink(`https://t.me/fishner_bot?start=manage_${session.id}`);
    });
    elements.dialog.showModal(); telegram?.HapticFeedback?.impactOccurred("light");
  }

  function renderMap() {
    const located = state.sessions.filter((item) => item.latitude != null && item.longitude != null);
    elements.mapCount.textContent = String(located.length); elements.mapEmpty.hidden = located.length > 0;
    if (!located.length || !window.L) return;
    if (!state.map) {
      state.map = window.L.map("catch-map", { zoomControl: false, attributionControl: true });
      window.L.control.zoom({ position: "bottomright" }).addTo(state.map);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(state.map);
    }
    state.markers.forEach((marker) => marker.remove());
    state.markers = located.map((session) => {
      const icon = window.L.divIcon({ className: "fish-marker", html: "<span>🐟</span>", iconSize: [34, 34], iconAnchor: [17, 28] });
      const marker = window.L.marker([session.latitude, session.longitude], { icon }).addTo(state.map);
      marker.bindPopup(`<strong>${escapeHtml(fishSummary(session))}</strong><br>${escapeHtml(anglerSummary(session))} · ${escapeHtml(session.waterbody ?? "Без названия")}`);
      return marker;
    });
    state.map.fitBounds(window.L.latLngBounds(located.map((item) => [item.latitude, item.longitude])), { padding: [38, 38], maxZoom: 13 });
    setTimeout(() => state.map?.invalidateSize(), 60);
  }

  function renderCalendar() {
    const month = state.calendarMonth;
    elements.calendarTitle.textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);
    const byDay = new Map();
    for (const session of state.sessions) { const list = byDay.get(session.caughtOn) ?? []; list.push(session); byDay.set(session.caughtOn, list); }
    const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    elements.calendarGrid.replaceChildren();
    for (let index = 0; index < firstWeekday; index += 1) { const spacer = document.createElement("span"); spacer.className = "calendar-day is-empty"; elements.calendarGrid.append(spacer); }
    for (let day = 1; day <= days; day += 1) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const sessions = byDay.get(key) ?? [];
      const button = document.createElement("button"); button.type = "button"; button.className = "calendar-day"; button.textContent = String(day);
      button.dataset.count = String(sessions.reduce((sum, session) => sum + session.fishes.length, 0));
      button.classList.toggle("has-catches", sessions.length > 0); button.classList.toggle("is-selected", key === state.selectedDay);
      button.addEventListener("click", () => { state.selectedDay = key; renderCalendar(); telegram?.HapticFeedback?.selectionChanged(); });
      elements.calendarGrid.append(button);
    }
    renderDayList(byDay.get(state.selectedDay) ?? []);
  }

  function renderDayList(sessions) {
    elements.dayList.replaceChildren();
    for (const session of sessions) {
      const row = document.createElement("button"); row.type = "button"; row.className = "day-row";
      row.innerHTML = `<div>🐟</div><div><strong>${escapeHtml(fishSummary(session))}</strong><small>${escapeHtml(anglerSummary(session))} · ${escapeHtml(session.waterbody ?? "Без места")}</small></div><div class="day-row__weight">${formatWeight(session.fishes.reduce((sum, fish) => sum + fish.weightGrams, 0))}</div>`;
      row.addEventListener("click", () => openSession(session)); elements.dayList.append(row);
    }
  }

  function aggregate(items, key, value) {
    const result = new Map();
    for (const item of items) result.set(item[key], (result.get(item[key]) ?? 0) + value(item));
    return [...result.entries()].sort((left, right) => right[1] - left[1]);
  }

  function renderBars(container, rows, formatter) {
    container.replaceChildren();
    if (!rows.length) { const muted = document.createElement("p"); muted.className = "privacy-note"; muted.textContent = "Пока недостаточно данных"; container.append(muted); return; }
    const maximum = rows[0][1] || 1;
    for (const [label, value] of rows.slice(0, 6)) {
      const row = document.createElement("div"); row.className = "bar";
      row.innerHTML = `<div class="bar__label"><span>${escapeHtml(label)}</span><span>${escapeHtml(formatter(value))}</span></div><div class="bar__track"><div class="bar__fill" style="width:${Math.max(4, (value / maximum) * 100)}%"></div></div>`;
      container.append(row);
    }
  }

  function renderStats() {
    const fishes = allFish();
    const sorted = [...fishes].sort((left, right) => right.weightGrams - left.weightGrams);
    const biggest = sorted[0];
    elements.recordHero.innerHTML = biggest ? `<div class="record-hero__icon">★ Рекорд компании</div><h3>${escapeHtml(biggest.speciesName)}</h3><strong>${formatWeight(biggest.weightGrams)}${biggest.lengthMm ? ` · ${formatLength(biggest.lengthMm)}` : ""}</strong><p>${escapeHtml(biggest.ownerName)} · ${escapeHtml(biggest.session.waterbody ?? "Место не указано")}</p>` : `<div class="record-hero__icon">★ Первый рекорд впереди</div><h3>Начните историю</h3><p>Следующий сохранённый улов станет первым рекордом компании.</p>`;
    renderBars(elements.anglerBars, aggregate(fishes, "ownerName", (item) => item.weightGrams), formatWeight);
    renderBars(elements.speciesBars, aggregate(fishes, "speciesName", () => 1), (value) => `${value} ${plural(value, ["рыба", "рыбы", "рыб"])}`);
    const records = new Map();
    for (const item of sorted) { const key = item.speciesName.toLocaleLowerCase("ru-RU"); if (!records.has(key)) records.set(key, item); }
    elements.recordsList.replaceChildren();
    [...records.values()].forEach((item, index) => {
      const row = document.createElement("div"); row.className = "record-row";
      row.innerHTML = `<div class="record-row__medal">${index < 3 ? ["Ⅰ", "Ⅱ", "Ⅲ"][index] : "•"}</div><div>${escapeHtml(item.speciesName)}<small>${escapeHtml(item.ownerName)}</small></div><strong>${formatWeight(item.weightGrams)}</strong>`;
      elements.recordsList.append(row);
    });
  }

  function switchView(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === name));
    document.querySelectorAll("[data-view-panel]").forEach((panel) => { const active = panel.dataset.viewPanel === name; panel.hidden = !active; panel.classList.toggle("is-active", active); });
    if (name === "map") renderMap(); if (name === "calendar") renderCalendar();
    telegram?.HapticFeedback?.selectionChanged();
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
    elements.speciesFilter.addEventListener("change", applyFilters); elements.anglerFilter.addEventListener("change", applyFilters);
    document.querySelector("#month-prev").addEventListener("click", () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); state.selectedDay = null; renderCalendar(); });
    document.querySelector("#month-next").addEventListener("click", () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); state.selectedDay = null; renderCalendar(); });
    document.querySelector("#dialog-close").addEventListener("click", () => elements.dialog.close());
    elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
  }

  async function start() {
    setupTelegram(); bindEvents();
    try {
      const data = await loadData(); state.viewer = data.viewer; state.sessions = data.sessions; state.filtered = data.sessions;
      if (state.sessions[0]) { const newest = dateValue(state.sessions[0].caughtOn); state.calendarMonth = new Date(newest.getUTCFullYear(), newest.getUTCMonth(), 1); }
      renderHero(); fillFilters(); renderGallery(); renderCalendar(); renderStats(); setStatus("hidden");
    } catch (error) {
      setStatus("error", "Дневник не открылся", error instanceof Error ? error.message : "Попробуйте открыть его из бота ещё раз");
      elements.catchGrid.replaceChildren(emptyState());
    }
  }

  void start();
})();
