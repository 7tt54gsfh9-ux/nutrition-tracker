/**
 * Nutrition Tracker — localStorage SPA
 * Defaults: 2000 kcal/day; Open Food Facts for barcodes.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "nutrition-tracker-v1";
  const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack", "drink"];
  const MEAL_LABELS = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    drink: "Drink",
  };
  const RING_CIRC = 2 * Math.PI * 52; // r=52

  const DEFAULT_SETTINGS = {
    calorieGoal: 2000,
    proteinGoal: null,
    carbsGoal: null,
    fatGoal: null,
  };

  /** @typedef {{ id: string, date: string, name: string, mealType: string, serving: string, calories: number, protein: number|null, carbs: number|null, fat: number|null, notes: string, createdAt: string }} Entry */

  // ---------- State ----------
  let state = loadState();
  /** @type {string} YYYY-MM-DD */
  let selectedDate = todayISO();
  let html5QrCode = null;
  let scanBusy = false;

  // ---------- Persistence ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { settings: { ...DEFAULT_SETTINGS }, entries: [] };
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, entries: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  function todayISO() {
    const d = new Date();
    return toISODate(d);
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function shiftDate(iso, delta) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + delta);
    return toISODate(d);
  }

  function formatDisplayDate(iso) {
    const today = todayISO();
    if (iso === today) return "Today";
    if (iso === shiftDate(today, -1)) return "Yesterday";
    const d = parseISODate(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  }

  function entriesForDate(iso) {
    return state.entries.filter((e) => e.date === iso);
  }

  function numOrNull(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmtMacro(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  // ---------- Views ----------
  function showView(name) {
    document.querySelectorAll(".view").forEach((el) => {
      const on = el.id === "view-" + name;
      el.classList.toggle("active", on);
      el.hidden = !on;
    });
    document.querySelectorAll(".tab").forEach((btn) => {
      const on = btn.dataset.view === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (name === "history") renderHistory();
    if (name === "settings") fillSettingsForm();
    if (name === "today") renderToday();
  }

  function renderToday() {
    const label = document.getElementById("today-label");
    label.textContent = formatDisplayDate(selectedDate);

    const nextBtn = document.getElementById("next-day");
    nextBtn.disabled = selectedDate >= todayISO();

    const entries = entriesForDate(selectedDate);
    const totals = sumEntries(entries);
    const goal = state.settings.calorieGoal || 2000;
    const remaining = goal - totals.calories;
    const over = remaining < 0;

    document.getElementById("cal-remaining").textContent = String(
      Math.abs(Math.round(remaining))
    );
    document.getElementById("cal-unit-label").textContent = over ? "over" : "left";
    document.getElementById("stat-eaten").textContent = String(Math.round(totals.calories));
    document.getElementById("stat-goal").textContent = String(goal);

    const ring = document.getElementById("cal-ring-fg");
    const progress = Math.min(totals.calories / goal, 1);
    ring.style.strokeDasharray = String(RING_CIRC);
    ring.style.strokeDashoffset = String(RING_CIRC * (1 - progress));
    ring.classList.toggle("over", over);

    renderMacroBar("protein", totals.protein, state.settings.proteinGoal);
    renderMacroBar("carbs", totals.carbs, state.settings.carbsGoal);
    renderMacroBar("fat", totals.fat, state.settings.fatGoal);

    renderEntriesGrouped(entries);
  }

  function sumEntries(entries) {
    return entries.reduce(
      (acc, e) => {
        acc.calories += Number(e.calories) || 0;
        acc.protein += Number(e.protein) || 0;
        acc.carbs += Number(e.carbs) || 0;
        acc.fat += Number(e.fat) || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }

  function renderMacroBar(key, value, goal) {
    const bar = document.getElementById("bar-" + key);
    const valEl = document.getElementById("val-" + key);
    const rounded = Math.round(value * 10) / 10;
    if (goal && goal > 0) {
      const pct = Math.min((value / goal) * 100, 100);
      bar.style.width = pct + "%";
      valEl.textContent = `${fmtMacro(rounded)}/${goal}g`;
    } else {
      bar.style.width = value > 0 ? Math.min(value / 2, 100) + "%" : "0%";
      // soft visual when no goal — scale roughly
      if (!goal) bar.style.width = Math.min((value / 150) * 100, 100) + "%";
      valEl.textContent = fmtMacro(rounded) + "g";
    }
  }

  function renderEntriesGrouped(entries) {
    const root = document.getElementById("entries-by-meal");
    if (!entries.length) {
      root.innerHTML =
        '<div class="empty-state"><p>No food logged yet</p><p class="hint">Add a meal or scan a barcode to get started.</p></div>';
      return;
    }

    const byMeal = {};
    MEAL_ORDER.forEach((m) => (byMeal[m] = []));
    entries.forEach((e) => {
      const key = byMeal[e.mealType] ? e.mealType : "snack";
      byMeal[key].push(e);
    });

    let html = "";
    MEAL_ORDER.forEach((meal) => {
      const list = byMeal[meal];
      if (!list.length) return;
      const mealCals = Math.round(list.reduce((s, e) => s + (Number(e.calories) || 0), 0));
      html += `<div class="meal-group">
        <h3 class="meal-heading"><span>${MEAL_LABELS[meal]}</span><span class="meal-cals">${mealCals} kcal</span></h3>`;
      list
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
        .forEach((e) => {
          html += entryCardHTML(e);
        });
      html += "</div>";
    });
    root.innerHTML = html;

    root.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.edit));
    });
    root.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteEntry(btn.dataset.delete));
    });
  }

  function entryCardHTML(e) {
    const macros = [];
    if (e.protein != null) macros.push(`P ${fmtMacro(e.protein)}g`);
    if (e.carbs != null) macros.push(`C ${fmtMacro(e.carbs)}g`);
    if (e.fat != null) macros.push(`F ${fmtMacro(e.fat)}g`);
    const serving = e.serving ? escapeHtml(e.serving) : "";
    const notes = e.notes
      ? `<p class="entry-notes">${escapeHtml(e.notes)}</p>`
      : "";
    return `<article class="entry-card">
      <div class="entry-body">
        <p class="entry-name">${escapeHtml(e.name)}</p>
        <p class="entry-meta">${serving || "1 serving"}</p>
        ${macros.length ? `<p class="entry-macros">${macros.join(" · ")}</p>` : ""}
        ${notes}
        <div class="entry-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-delete="${e.id}">Delete</button>
        </div>
      </div>
      <div class="entry-cals">${Math.round(Number(e.calories) || 0)}</div>
    </article>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHistory() {
    const root = document.getElementById("history-list");
    const byDate = {};
    state.entries.forEach((e) => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });
    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    if (!dates.length) {
      root.innerHTML =
        '<div class="empty-state"><p>No history yet</p><p class="hint">Logged days will show up here.</p></div>';
      return;
    }
    root.innerHTML = dates
      .map((iso) => {
        const totals = sumEntries(byDate[iso]);
        const count = byDate[iso].length;
        return `<button type="button" class="history-item" data-date="${iso}">
          <span class="history-date">${formatDisplayDate(iso)}</span>
          <span class="history-cals">${Math.round(totals.calories)} kcal · ${count} item${count === 1 ? "" : "s"}</span>
        </button>`;
      })
      .join("");

    root.querySelectorAll("[data-date]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = btn.dataset.date;
        showView("today");
      });
    });
  }

  // ---------- Modal: add/edit ----------
  function openAddModal(prefills) {
    document.getElementById("modal-title").textContent = "Add food";
    document.getElementById("entry-form").reset();
    document.getElementById("entry-id").value = "";
    document.getElementById("entry-meal").value = guessMealType();
    if (prefills) applyPrefills(prefills);
    showModal(true);
    setTimeout(() => document.getElementById("entry-name").focus(), 100);
  }

  function openEditModal(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    document.getElementById("modal-title").textContent = "Edit entry";
    document.getElementById("entry-id").value = e.id;
    document.getElementById("entry-name").value = e.name;
    document.getElementById("entry-meal").value = e.mealType;
    document.getElementById("entry-serving").value = e.serving || "";
    document.getElementById("entry-calories").value = e.calories;
    document.getElementById("entry-protein").value = e.protein != null ? e.protein : "";
    document.getElementById("entry-carbs").value = e.carbs != null ? e.carbs : "";
    document.getElementById("entry-fat").value = e.fat != null ? e.fat : "";
    document.getElementById("entry-notes").value = e.notes || "";
    showModal(true);
  }

  function applyPrefills(p) {
    if (p.name) document.getElementById("entry-name").value = p.name;
    if (p.serving) document.getElementById("entry-serving").value = p.serving;
    if (p.calories != null) document.getElementById("entry-calories").value = p.calories;
    if (p.protein != null) document.getElementById("entry-protein").value = p.protein;
    if (p.carbs != null) document.getElementById("entry-carbs").value = p.carbs;
    if (p.fat != null) document.getElementById("entry-fat").value = p.fat;
    if (p.mealType) document.getElementById("entry-meal").value = p.mealType;
    if (p.notes) document.getElementById("entry-notes").value = p.notes;
  }

  function guessMealType() {
    const h = new Date().getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 21) return "dinner";
    return "snack";
  }

  function showModal(open) {
    document.getElementById("modal-overlay").hidden = !open;
    if (!open) return;
  }

  function closeModal() {
    showModal(false);
  }

  function saveEntryFromForm(ev) {
    ev.preventDefault();
    const id = document.getElementById("entry-id").value;
    const entry = {
      id: id || uid(),
      date: selectedDate,
      name: document.getElementById("entry-name").value.trim(),
      mealType: document.getElementById("entry-meal").value,
      serving: document.getElementById("entry-serving").value.trim(),
      calories: Number(document.getElementById("entry-calories").value) || 0,
      protein: numOrNull(document.getElementById("entry-protein").value),
      carbs: numOrNull(document.getElementById("entry-carbs").value),
      fat: numOrNull(document.getElementById("entry-fat").value),
      notes: document.getElementById("entry-notes").value.trim(),
      createdAt: new Date().toISOString(),
    };
    if (!entry.name) return;

    if (id) {
      const idx = state.entries.findIndex((x) => x.id === id);
      if (idx >= 0) {
        entry.createdAt = state.entries[idx].createdAt;
        entry.date = state.entries[idx].date;
        state.entries[idx] = entry;
      } else {
        state.entries.push(entry);
      }
    } else {
      state.entries.push(entry);
    }
    saveState();
    closeModal();
    renderToday();
  }

  function deleteEntry(id) {
    if (!confirm("Delete this entry?")) return;
    state.entries = state.entries.filter((e) => e.id !== id);
    saveState();
    renderToday();
  }

  // ---------- Settings ----------
  function fillSettingsForm() {
    const s = state.settings;
    document.getElementById("goal-calories").value = s.calorieGoal;
    document.getElementById("goal-protein").value = s.proteinGoal ?? "";
    document.getElementById("goal-carbs").value = s.carbsGoal ?? "";
    document.getElementById("goal-fat").value = s.fatGoal ?? "";
    document.getElementById("settings-saved").hidden = true;
  }

  function saveSettings(ev) {
    ev.preventDefault();
    state.settings.calorieGoal =
      Number(document.getElementById("goal-calories").value) || 2000;
    state.settings.proteinGoal = numOrNull(document.getElementById("goal-protein").value);
    state.settings.carbsGoal = numOrNull(document.getElementById("goal-carbs").value);
    state.settings.fatGoal = numOrNull(document.getElementById("goal-fat").value);
    saveState();
    const toast = document.getElementById("settings-saved");
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 2000);
  }

  function clearAllData() {
    if (!confirm("Delete all entries and reset settings? This cannot be undone.")) return;
    state = { settings: { ...DEFAULT_SETTINGS }, entries: [] };
    saveState();
    selectedDate = todayISO();
    fillSettingsForm();
    renderToday();
  }

  // ---------- Barcode / Open Food Facts ----------
  function openBarcodeModal() {
    document.getElementById("barcode-overlay").hidden = false;
    document.getElementById("barcode-status").textContent = "";
    document.getElementById("barcode-status").className = "barcode-status";
    document.getElementById("barcode-input").value = "";
    setBarcodeMode("scan");
  }

  function closeBarcodeModal() {
    stopScanner();
    document.getElementById("barcode-overlay").hidden = true;
  }

  function setBarcodeMode(mode) {
    document.querySelectorAll("[data-barcode-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.barcodeMode === mode);
    });
    const scan = mode === "scan";
    document.getElementById("scanner-pane").hidden = !scan;
    document.getElementById("manual-pane").hidden = scan;
    if (scan) startScanner();
    else stopScanner();
  }

  async function startScanner() {
    if (typeof Html5Qrcode === "undefined") {
      setBarcodeStatus("Camera scanner library failed to load. Use Type / paste instead.", "error");
      return;
    }
    stopScanner();
    const elId = "qr-reader";
    html5QrCode = new Html5Qrcode(elId);
    scanBusy = false;
    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 250, height: 140 }, aspectRatio: 1.5 },
        onScanSuccess,
        () => {}
      );
    } catch (err) {
      console.warn(err);
      setBarcodeStatus(
        "Could not start camera. Allow camera access, or use Type / paste. Camera needs HTTPS or localhost.",
        "error"
      );
    }
  }

  async function stopScanner() {
    if (!html5QrCode) return;
    try {
      const state = html5QrCode.getState && html5QrCode.getState();
      // 2 = SCANNING, 3 = PAUSED in html5-qrcode
      if (state === 2 || state === 3) {
        await html5QrCode.stop();
      }
      html5QrCode.clear();
    } catch {
      /* ignore */
    }
    html5QrCode = null;
  }

  function onScanSuccess(decodedText) {
    if (scanBusy) return;
    scanBusy = true;
    const code = String(decodedText).trim();
    setBarcodeStatus("Found " + code + " — looking up…", "");
    lookupBarcode(code).finally(() => {
      setTimeout(() => (scanBusy = false), 1500);
    });
  }

  function setBarcodeStatus(msg, cls) {
    const el = document.getElementById("barcode-status");
    el.textContent = msg;
    el.className = "barcode-status" + (cls ? " " + cls : "");
  }

  async function lookupBarcode(barcode) {
    const code = String(barcode).replace(/\s/g, "");
    if (!/^\d{8,14}$/.test(code)) {
      setBarcodeStatus("Enter a valid barcode (8–14 digits).", "error");
      return;
    }
    setBarcodeStatus("Looking up product…", "");
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`
      );
      if (!res.ok) throw new Error("Network error " + res.status);
      const data = await res.json();
      if (data.status !== 1 || !data.product) {
        setBarcodeStatus("Product not found in Open Food Facts. Try adding manually.", "error");
        return;
      }
      const prefills = mapOpenFoodFacts(data.product);
      setBarcodeStatus("Found: " + (prefills.name || "product"), "ok");
      await stopScanner();
      closeBarcodeModal();
      openAddModal(prefills);
    } catch (err) {
      console.warn(err);
      setBarcodeStatus("Lookup failed. Check your connection and try again.", "error");
    }
  }

  function mapOpenFoodFacts(p) {
    const n = p.nutriments || {};
    // Prefer per serving if available, else per 100g
    let serving = "";
    let calories = null;
    let protein = null;
    let carbs = null;
    let fat = null;

    const servingSize = p.serving_size || "";
    const hasServingEnergy =
      n["energy-kcal_serving"] != null || n.energy_kcal_serving != null;

    if (hasServingEnergy && servingSize) {
      serving = servingSize;
      calories = pickNum(n["energy-kcal_serving"], n.energy_kcal_serving);
      protein = pickNum(n.proteins_serving);
      carbs = pickNum(n.carbohydrates_serving);
      fat = pickNum(n.fat_serving);
    } else {
      serving = servingSize || "100 g";
      calories = pickNum(n["energy-kcal_100g"], n.energy_kcal_100g, n["energy-kcal"]);
      // energy sometimes only in kJ
      if (calories == null && n["energy_100g"] != null) {
        calories = Math.round(Number(n["energy_100g"]) / 4.184);
      }
      protein = pickNum(n.proteins_100g, n.proteins);
      carbs = pickNum(n.carbohydrates_100g, n.carbohydrates);
      fat = pickNum(n.fat_100g, n.fat);
      if (!servingSize) {
        // label that values are per 100g
        serving = "100 g";
      }
    }

    const name =
      p.product_name ||
      p.product_name_en ||
      p.generic_name ||
      p.brands ||
      "Unknown product";

    const brand = p.brands ? String(p.brands).split(",")[0].trim() : "";
    const displayName =
      brand && name && !String(name).toLowerCase().includes(brand.toLowerCase())
        ? `${brand} ${name}`
        : name;

    return {
      name: String(displayName).trim().slice(0, 120),
      serving: String(serving).slice(0, 60),
      calories: calories != null ? Math.round(calories) : 0,
      protein: protein != null ? round1(protein) : null,
      carbs: carbs != null ? round1(carbs) : null,
      fat: fat != null ? round1(fat) : null,
      notes: p.code ? "Barcode " + p.code : "",
    };
  }

  function pickNum(...vals) {
    for (const v of vals) {
      if (v != null && v !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // ---------- Events ----------
  function bind() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.view));
    });

    document.getElementById("prev-day").addEventListener("click", () => {
      selectedDate = shiftDate(selectedDate, -1);
      renderToday();
    });
    document.getElementById("next-day").addEventListener("click", () => {
      if (selectedDate >= todayISO()) return;
      selectedDate = shiftDate(selectedDate, 1);
      renderToday();
    });

    document.getElementById("btn-add").addEventListener("click", () => openAddModal());
    document.getElementById("btn-barcode").addEventListener("click", openBarcodeModal);

    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("btn-cancel").addEventListener("click", closeModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    document.getElementById("entry-form").addEventListener("submit", saveEntryFromForm);

    document.getElementById("barcode-close").addEventListener("click", closeBarcodeModal);
    document.getElementById("barcode-overlay").addEventListener("click", (e) => {
      if (e.target.id === "barcode-overlay") closeBarcodeModal();
    });
    document.querySelectorAll("[data-barcode-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setBarcodeMode(btn.dataset.barcodeMode));
    });
    document.getElementById("btn-lookup").addEventListener("click", () => {
      lookupBarcode(document.getElementById("barcode-input").value);
    });
    document.getElementById("barcode-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        lookupBarcode(e.target.value);
      }
    });

    document.getElementById("settings-form").addEventListener("submit", saveSettings);
    document.getElementById("btn-clear-data").addEventListener("click", clearAllData);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!document.getElementById("barcode-overlay").hidden) closeBarcodeModal();
        else if (!document.getElementById("modal-overlay").hidden) closeModal();
      }
    });
  }

  // ---------- Init ----------
  bind();
  showView("today");
})();
