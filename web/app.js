(() => {
  "use strict";

  const telegram = window.Telegram?.WebApp;
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const state = {
    catches: [],
    filtered: [],
    viewer: null,
    map: null,
    markers: [],
    media: new Map(),
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDay: null,
  };
  const mediaObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          mediaObserver.unobserve(entry.target);
          const item = state.catches.find((candidate) => candidate.id === entry.target.dataset.mediaFor);
          if (item) void attachMedia(entry.target, item, false);
        }
      }, { rootMargin: "240px 0px" })
    : null;

  const elements = {
    status: document.querySelector("#status-card"),
    welcome: document.querySelector("#welcome"),
    heroStats: document.querySelector("#hero-stats"),
    catchGrid: document.querySelector("#catch-grid"),
    galleryCount: document.querySelector("#gallery-count"),
    speciesFilter: document.querySelector("#species-filter"),
    anglerFilter: document.querySelector("#angler-filter"),
    mapCount: document.querySelector("#map-count"),
    mapEmpty: document.querySelector("#map-empty"),
    calendarTitle: document.querySelector("#calendar-title"),
    calendarGrid: document.querySelector("#calendar-grid"),
    dayList: document.querySelector("#day-list"),
    recordHero: document.querySelector("#record-hero"),
    anglerBars: document.querySelector("#angler-bars"),
    speciesBars: document.querySelector("#species-bars"),
    recordsList: document.querySelector("#records-list"),
    dialog: document.querySelector("#catch-dialog"),
    dialogMedia: document.querySelector("#dialog-media"),
    dialogBody: document.querySelector("#dialog-body"),
    emptyTemplate: document.querySelector("#empty-template"),
  };

  const demoCatches = [
    { id: "00000000-0000-0000-0000-000000000001", ownerName: "Максим", speciesName: "Щука", weightGrams: 5820, lengthMm: 890, latitude: 55.7539, longitude: 37.6208, waterbody: "Большое озеро", caughtAt: "2026-10-10T06:42:00.000Z", lure: "Джиг, зелёный силикон", disposition: "released", notes: "Взяла у камыша на третьей проводке. Очень сильная рыба.", mediaType: null, hasMedia: false },
    { id: "00000000-0000-0000-0000-000000000002", ownerName: "Антон", speciesName: "Сазан", weightGrams: 4310, lengthMm: 710, latitude: 55.641, longitude: 37.522, waterbody: "Тихая заводь", caughtAt: "2026-10-08T04:18:00.000Z", lure: "Кукуруза", disposition: "kept", notes: "Утренняя поклёвка перед самым туманом.", mediaType: null, hasMedia: false },
    { id: "00000000-0000-0000-0000-000000000003", ownerName: "Максим", speciesName: "Окунь", weightGrams: 840, lengthMm: 390, latitude: 55.814, longitude: 37.702, waterbody: "Лесной пруд", caughtAt: "2026-10-03T12:25:00.000Z", lure: "Вертушка №2", disposition: "released", notes: null, mediaType: null, hasMedia: false },
    { id: "00000000-0000-0000-0000-000000000004", ownerName: "Саша", speciesName: "Щука", weightGrams: 3750, lengthMm: 760, latitude: null, longitude: null, waterbody: "Северный карьер", caughtAt: "2026-09-27T08:10:00.000Z", lure: "Воблер", disposition: "released", notes: "Первый заброс после дождя.", mediaType: null, hasMedia: false },
    { id: "00000000-0000-0000-0000-000000000005", ownerName: "Антон", speciesName: "Лещ", weightGrams: 2160, lengthMm: 540, latitude: 55.69, longitude: 37.41, waterbody: "Река Москва", caughtAt: "2026-09-14T16:05:00.000Z", lure: "Фидер", disposition: "kept", notes: null, mediaType: null, hasMedia: false },
  ];

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

  function shortDate(iso) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(iso));
  }

  function longDate(iso) {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
  }

  function plural(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function setStatus(kind, title, message) {
    if (kind === "hidden") {
      elements.status.hidden = true;
      return;
    }
    elements.status.hidden = false;
    elements.status.classList.toggle("is-error", kind === "error");
    elements.status.innerHTML = `${kind === "loading" ? '<div class="spinner" aria-hidden="true"></div>' : ""}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  }

  function emptyState() {
    return elements.emptyTemplate.content.cloneNode(true);
  }

  function setupTelegram() {
    if (!telegram) return;
    telegram.ready();
    telegram.expand();
    telegram.setHeaderColor?.("#071d2a");
    telegram.setBackgroundColor?.("#061b27");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "x-telegram-init-data": telegram?.initData ?? "",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) {
      let message = "Не удалось загрузить дневник";
      try { message = (await response.json()).error ?? message; } catch { /* response is not JSON */ }
      throw new Error(message);
    }
    return response;
  }

  async function loadData() {
    if (isLocalPreview && !telegram?.initData) {
      return { viewer: { id: 1, firstName: "Максим" }, catches: demoCatches };
    }
    if (!telegram?.initData) throw new Error("Откройте дневник кнопкой «Открыть дневник» внутри @fishner_bot");
    return (await api("/api/mini-app/bootstrap", { method: "POST" })).json();
  }

  function renderHero() {
    const totalWeight = state.catches.reduce((sum, item) => sum + item.weightGrams, 0);
    const species = new Set(state.catches.map((item) => item.speciesName.toLocaleLowerCase("ru-RU")));
    elements.welcome.textContent = state.viewer?.firstName
      ? `${state.viewer.firstName}, вот что поймала наша компания`
      : "Общий дневник друзей";
    elements.heroStats.innerHTML = `
      <div><strong>${state.catches.length}</strong><span>${plural(state.catches.length, ["рыба", "рыбы", "рыб"])}</span></div>
      <div><strong>${formatWeight(totalWeight)}</strong><span>общий вес</span></div>
      <div><strong>${species.size}</strong><span>${plural(species.size, ["вид", "вида", "видов"])}</span></div>`;
  }

  function fillFilters() {
    const species = [...new Set(state.catches.map((item) => item.speciesName))].sort((a, b) => a.localeCompare(b, "ru"));
    const anglers = [...new Set(state.catches.map((item) => item.ownerName))].sort((a, b) => a.localeCompare(b, "ru"));
    for (const value of species) elements.speciesFilter.add(new Option(value, value));
    for (const value of anglers) elements.anglerFilter.add(new Option(value, value));
  }

  function applyFilters() {
    const species = elements.speciesFilter.value;
    const angler = elements.anglerFilter.value;
    state.filtered = state.catches.filter((item) => (!species || item.speciesName === species) && (!angler || item.ownerName === angler));
    renderGallery();
  }

  function renderGallery() {
    mediaObserver?.disconnect();
    elements.catchGrid.replaceChildren();
    elements.galleryCount.textContent = String(state.filtered.length);
    if (!state.filtered.length) {
      elements.catchGrid.append(emptyState());
      return;
    }

    for (const item of state.filtered) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "catch-card";
      card.innerHTML = `
        <div class="catch-card__media" data-media-for="${item.id}">
          <span class="catch-card__badge">${escapeHtml(item.ownerName)}</span>
        </div>
        <div class="catch-card__body">
          <h3>${escapeHtml(item.speciesName)}</h3>
          <div class="catch-card__weight">${formatWeight(item.weightGrams)}${item.lengthMm ? ` · ${formatLength(item.lengthMm)}` : ""}</div>
          <div class="catch-card__meta"><span>${escapeHtml(item.waterbody ?? "Место не указано")}</span><span>${shortDate(item.caughtAt)}</span></div>
        </div>`;
      card.addEventListener("click", () => openCatch(item));
      elements.catchGrid.append(card);
      if (item.hasMedia) {
        const mediaContainer = card.querySelector(".catch-card__media");
        if (mediaObserver) mediaObserver.observe(mediaContainer);
        else void attachMedia(mediaContainer, item, false);
      }
    }
  }

  async function mediaUrl(item) {
    if (state.media.has(item.id)) return state.media.get(item.id);
    const response = await api(`/api/mini-app/media/${item.id}`);
    const url = URL.createObjectURL(await response.blob());
    state.media.set(item.id, url);
    return url;
  }

  async function attachMedia(container, item, controls) {
    if (!container || !item.hasMedia) return;
    try {
      const source = await mediaUrl(item);
      const media = document.createElement(item.mediaType === "video" ? "video" : "img");
      media.src = source;
      if (media instanceof HTMLImageElement) media.alt = `${item.speciesName}, улов ${item.ownerName}`;
      else {
        media.controls = controls;
        media.muted = !controls;
        media.playsInline = true;
        media.preload = "metadata";
      }
      container.append(media);
    } catch {
      container.classList.add("media-error");
    }
  }

  function openCatch(item) {
    elements.dialogMedia.replaceChildren();
    elements.dialogBody.innerHTML = `
      <span class="kicker">Улов ${escapeHtml(item.ownerName)}</span>
      <h2>${escapeHtml(item.speciesName)}</h2>
      <div class="dialog-primary">${formatWeight(item.weightGrams)}${item.lengthMm ? ` · ${formatLength(item.lengthMm)}` : ""}</div>
      <div class="detail-grid">
        <div><small>Когда</small>${escapeHtml(longDate(item.caughtAt))}</div>
        <div><small>Место</small>${escapeHtml(item.waterbody ?? "Не указано")}</div>
        <div><small>Приманка</small>${escapeHtml(item.lure ?? "Не указана")}</div>
        <div><small>Рыба</small>${item.disposition === "released" ? "Отпущена ♻️" : item.disposition === "kept" ? "Забрана 🧺" : "Не указано"}</div>
      </div>
      ${item.notes ? `<div class="detail-note">${escapeHtml(item.notes)}</div>` : ""}
      ${item.latitude != null && item.longitude != null ? `<a class="map-link" href="https://www.openstreetmap.org/?mlat=${item.latitude}&mlon=${item.longitude}#map=15/${item.latitude}/${item.longitude}" target="_blank" rel="noreferrer">⌖ Открыть точную точку</a>` : ""}`;
    if (item.hasMedia) void attachMedia(elements.dialogMedia, item, true);
    elements.dialog.showModal();
    telegram?.HapticFeedback?.impactOccurred("light");
  }

  function renderMap() {
    const located = state.catches.filter((item) => item.latitude != null && item.longitude != null);
    elements.mapCount.textContent = String(located.length);
    elements.mapEmpty.hidden = located.length > 0;
    if (!located.length || !window.L) return;
    if (!state.map) {
      state.map = window.L.map("catch-map", { zoomControl: false, attributionControl: true });
      window.L.control.zoom({ position: "bottomright" }).addTo(state.map);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap",
      }).addTo(state.map);
    }
    state.markers.forEach((marker) => marker.remove());
    state.markers = located.map((item) => {
      const icon = window.L.divIcon({ className: "fish-marker", html: "<span>🐟</span>", iconSize: [34, 34], iconAnchor: [17, 28] });
      const marker = window.L.marker([item.latitude, item.longitude], { icon }).addTo(state.map);
      marker.bindPopup(`<strong>${escapeHtml(item.speciesName)} · ${formatWeight(item.weightGrams)}</strong><br>${escapeHtml(item.ownerName)} · ${escapeHtml(item.waterbody ?? "Без названия")}`);
      marker.on("click", () => telegram?.HapticFeedback?.selectionChanged());
      return marker;
    });
    const bounds = window.L.latLngBounds(located.map((item) => [item.latitude, item.longitude]));
    state.map.fitBounds(bounds, { padding: [38, 38], maxZoom: 13 });
    setTimeout(() => state.map?.invalidateSize(), 60);
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function renderCalendar() {
    const month = state.calendarMonth;
    elements.calendarTitle.textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);
    const byDay = new Map();
    for (const item of state.catches) {
      const key = dateKey(new Date(item.caughtAt));
      const list = byDay.get(key) ?? [];
      list.push(item);
      byDay.set(key, list);
    }
    const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    elements.calendarGrid.replaceChildren();
    for (let index = 0; index < firstWeekday; index += 1) {
      const spacer = document.createElement("span");
      spacer.className = "calendar-day is-empty";
      elements.calendarGrid.append(spacer);
    }
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const key = dateKey(date);
      const catches = byDay.get(key) ?? [];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);
      button.dataset.count = String(catches.length);
      button.classList.toggle("has-catches", catches.length > 0);
      button.classList.toggle("is-today", key === dateKey(new Date()));
      button.classList.toggle("is-selected", key === state.selectedDay);
      button.addEventListener("click", () => {
        state.selectedDay = key;
        renderCalendar();
        telegram?.HapticFeedback?.selectionChanged();
      });
      elements.calendarGrid.append(button);
    }
    renderDayList(byDay.get(state.selectedDay) ?? []);
  }

  function renderDayList(items) {
    elements.dayList.replaceChildren();
    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "day-row";
      row.innerHTML = `<div>🐟</div><div><strong>${escapeHtml(item.speciesName)}</strong><small>${escapeHtml(item.ownerName)} · ${escapeHtml(item.waterbody ?? "Без места")}</small></div><div class="day-row__weight">${formatWeight(item.weightGrams)}</div>`;
      row.addEventListener("click", () => openCatch(item));
      elements.dayList.append(row);
    }
  }

  function aggregate(items, key, value) {
    const result = new Map();
    for (const item of items) result.set(item[key], (result.get(item[key]) ?? 0) + value(item));
    return [...result.entries()].sort((left, right) => right[1] - left[1]);
  }

  function renderBars(container, rows, formatter) {
    container.replaceChildren();
    if (!rows.length) {
      const muted = document.createElement("p");
      muted.className = "privacy-note";
      muted.textContent = "Пока недостаточно данных";
      container.append(muted);
      return;
    }
    const maximum = rows[0][1] || 1;
    for (const [label, value] of rows.slice(0, 6)) {
      const row = document.createElement("div");
      row.className = "bar";
      row.innerHTML = `<div class="bar__label"><span>${escapeHtml(label)}</span><span>${escapeHtml(formatter(value))}</span></div><div class="bar__track"><div class="bar__fill" style="width:${Math.max(4, (value / maximum) * 100)}%"></div></div>`;
      container.append(row);
    }
  }

  function renderStats() {
    const sorted = [...state.catches].sort((left, right) => right.weightGrams - left.weightGrams);
    const biggest = sorted[0];
    elements.recordHero.innerHTML = biggest ? `
      <div class="record-hero__icon">★ Рекорд компании</div>
      <h3>${escapeHtml(biggest.speciesName)}</h3>
      <strong>${formatWeight(biggest.weightGrams)}${biggest.lengthMm ? ` · ${formatLength(biggest.lengthMm)}` : ""}</strong>
      <p>${escapeHtml(biggest.ownerName)} · ${escapeHtml(biggest.waterbody ?? "Место не указано")}</p>` : `
      <div class="record-hero__icon">★ Первый рекорд впереди</div>
      <h3>Начните историю</h3><p>Следующий сохранённый улов станет первым рекордом компании.</p>`;

    renderBars(elements.anglerBars, aggregate(state.catches, "ownerName", (item) => item.weightGrams), formatWeight);
    renderBars(elements.speciesBars, aggregate(state.catches, "speciesName", () => 1), (value) => `${value} ${plural(value, ["рыба", "рыбы", "рыб"])}`);

    const records = new Map();
    for (const item of sorted) {
      const key = item.speciesName.toLocaleLowerCase("ru-RU");
      if (!records.has(key)) records.set(key, item);
    }
    elements.recordsList.replaceChildren();
    [...records.values()].forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "record-row";
      row.innerHTML = `<div class="record-row__medal">${index < 3 ? ["Ⅰ", "Ⅱ", "Ⅲ"][index] : "•"}</div><div>${escapeHtml(item.speciesName)}<small>${escapeHtml(item.ownerName)}</small></div><strong>${formatWeight(item.weightGrams)}</strong>`;
      elements.recordsList.append(row);
    });
    if (!records.size) {
      const muted = document.createElement("p");
      muted.className = "privacy-note";
      muted.textContent = "Рекорды появятся после первого улова";
      elements.recordsList.append(muted);
    }
  }

  function switchView(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === name));
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      const active = panel.dataset.viewPanel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    if (name === "map") renderMap();
    if (name === "calendar") renderCalendar();
    telegram?.HapticFeedback?.selectionChanged();
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
    elements.speciesFilter.addEventListener("change", applyFilters);
    elements.anglerFilter.addEventListener("change", applyFilters);
    document.querySelector("#month-prev").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      state.selectedDay = null;
      renderCalendar();
    });
    document.querySelector("#month-next").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      state.selectedDay = null;
      renderCalendar();
    });
    document.querySelector("#dialog-close").addEventListener("click", () => elements.dialog.close());
    elements.dialog.addEventListener("click", (event) => {
      if (event.target === elements.dialog) elements.dialog.close();
    });
  }

  async function start() {
    setupTelegram();
    bindEvents();
    try {
      const data = await loadData();
      state.viewer = data.viewer;
      state.catches = data.catches;
      state.filtered = data.catches;
      if (state.catches[0]) {
        const newest = new Date(state.catches[0].caughtAt);
        state.calendarMonth = new Date(newest.getFullYear(), newest.getMonth(), 1);
      }
      renderHero();
      fillFilters();
      renderGallery();
      renderCalendar();
      renderStats();
      setStatus("hidden");
    } catch (error) {
      setStatus("error", "Дневник не открылся", error instanceof Error ? error.message : "Попробуйте открыть его из бота ещё раз");
      elements.catchGrid.replaceChildren(emptyState());
    }
  }

  void start();
})();
