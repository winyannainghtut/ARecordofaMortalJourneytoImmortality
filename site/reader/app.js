(function () {
  "use strict";

  const SETTINGS_KEY = "novel_reader_settings_v1";
  const LAST_CHAPTER_KEY = "novel_reader_last_chapter_v1";
  const PROGRESS_KEY = "novel_reader_scroll_progress_v1";
  const SYSTEM_THEME_QUERY = window.matchMedia("(prefers-color-scheme: dark)");

  const defaultSettings = {
    theme: "system",
    font: "serif",
    fontSize: 19,
    lineHeight: 1.75,
    width: 780,
    source: "all"
  };

  const fontMap = {
    serif: "'Source Serif 4', Georgia, serif",
    friendly: "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
    classic: "'Alegreya', Georgia, serif"
  };

  const state = {
    entries: [],
    visibleEntries: [],
    currentId: null,
    settings: readJSON(SETTINGS_KEY, defaultSettings),
    progress: readJSON(PROGRESS_KEY, {}),
    saveTimer: null
  };

  const els = {
    appShell: document.getElementById("appShell"),
    sidebar: document.getElementById("sidebar"),
    closeSidebarBtn: document.getElementById("closeSidebarBtn"),
    openSidebarBtn: document.getElementById("openSidebarBtn"),
    chapterList: document.getElementById("chapterList"),
    sourceFilter: document.getElementById("sourceFilter"),
    libraryMeta: document.getElementById("libraryMeta"),
    searchInput: document.getElementById("searchInput"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    themeSelect: document.getElementById("themeSelect"),
    fontSelect: document.getElementById("fontSelect"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightRange: document.getElementById("lineHeightRange"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    widthRange: document.getElementById("widthRange"),
    widthValue: document.getElementById("widthValue"),
    chapterTitle: document.getElementById("chapterTitle"),
    chapterInfo: document.getElementById("chapterInfo"),
    content: document.getElementById("content"),
    readerPanel: document.getElementById("readerPanel")
  };

  init();

  async function init() {
    bindEvents();
    hydrateSettingsControls();
    applyVisualSettings();
    await loadManifest();
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", () => {
      renderChapterList();
    });

    els.prevBtn.addEventListener("click", () => moveToSibling(-1));
    els.nextBtn.addEventListener("click", () => moveToSibling(1));

    els.themeSelect.addEventListener("change", () => {
      state.settings.theme = els.themeSelect.value;
      saveSettings();
      applyTheme();
    });

    els.fontSelect.addEventListener("change", () => {
      state.settings.font = els.fontSelect.value;
      saveSettings();
      applyTypography();
    });

    els.fontSizeRange.addEventListener("input", () => {
      state.settings.fontSize = Number(els.fontSizeRange.value);
      applyTypography();
      saveSettings();
    });

    els.lineHeightRange.addEventListener("input", () => {
      state.settings.lineHeight = Number(els.lineHeightRange.value);
      applyTypography();
      saveSettings();
    });

    els.widthRange.addEventListener("input", () => {
      state.settings.width = Number(els.widthRange.value);
      applyTypography();
      saveSettings();
    });

    els.openSidebarBtn.addEventListener("click", () => {
      document.body.classList.add("sidebar-open");
    });

    els.closeSidebarBtn.addEventListener("click", () => {
      document.body.classList.remove("sidebar-open");
    });

    els.readerPanel.addEventListener("scroll", () => {
      if (!state.currentId) return;
      state.progress[state.currentId] = Math.max(0, els.readerPanel.scrollTop);
      scheduleProgressSave();
    });

    window.addEventListener("beforeunload", () => {
      flushProgressSave();
    });

    SYSTEM_THEME_QUERY.addEventListener("change", () => {
      if (state.settings.theme === "system") {
        applyTheme();
      }
    });
  }

  async function loadManifest() {
    try {
      const response = await fetch("./manifest.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load manifest (${response.status})`);
      }

      const payload = await response.json();
      state.entries = Array.isArray(payload.entries) ? payload.entries : [];
      els.libraryMeta.textContent = `${state.entries.length} chapters indexed`;

      renderSourceFilter();
      renderChapterList();

      if (!state.entries.length) {
        els.chapterInfo.textContent = "No markdown files were indexed.";
        return;
      }

      const lastChapter = localStorage.getItem(LAST_CHAPTER_KEY);
      const defaultChapter = state.entries[0]?.id;
      const initialChapter = state.entries.some((entry) => entry.id === lastChapter)
        ? lastChapter
        : defaultChapter;

      if (initialChapter) {
        await openChapter(initialChapter);
      }
    } catch (error) {
      els.libraryMeta.textContent = "Failed to load chapter index";
      els.chapterInfo.textContent = String(error.message || error);
      els.content.innerHTML = `<p class="empty-state">Run <code>python reader/generate_manifest.py</code> then reload.</p>`;
    }
  }

  function renderSourceFilter() {
    const sources = [...new Set(state.entries.map((entry) => entry.sourceLabel))];
    els.sourceFilter.innerHTML = "";

    const allButton = buildFilterChip("All", "all", state.settings.source === "all");
    els.sourceFilter.appendChild(allButton);

    for (const source of sources) {
      const active = state.settings.source === source;
      const button = buildFilterChip(source, source, active);
      els.sourceFilter.appendChild(button);
    }
  }

  function buildFilterChip(label, value, active) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${active ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      state.settings.source = value;
      saveSettings();
      renderSourceFilter();
      renderChapterList();
    });
    return button;
  }

  function renderChapterList() {
    const query = els.searchInput.value.trim().toLowerCase();
    const sourceFilter = state.settings.source;

    const filtered = state.entries.filter((entry) => {
      if (sourceFilter !== "all" && entry.sourceLabel !== sourceFilter) {
        return false;
      }

      if (!query) return true;

      const haystack = `${entry.title} ${entry.path} ${entry.group || ""}`.toLowerCase();
      return haystack.includes(query);
    });

    state.visibleEntries = filtered;
    els.chapterList.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("li");
      empty.className = "chapter-group";
      empty.textContent = "No chapters match this filter.";
      els.chapterList.appendChild(empty);
      updateNavButtons();
      return;
    }

    let lastGroupKey = "";
    for (const entry of filtered) {
      const groupLabel = `${entry.sourceLabel} / ${entry.group || "root"}`;
      if (groupLabel !== lastGroupKey) {
        const groupItem = document.createElement("li");
        groupItem.className = "chapter-group";
        groupItem.textContent = groupLabel;
        els.chapterList.appendChild(groupItem);
        lastGroupKey = groupLabel;
      }

      const item = document.createElement("li");
      item.className = `chapter-item${entry.id === state.currentId ? " active" : ""}`;
      item.dataset.chapterId = entry.id;

      const title = document.createElement("div");
      title.className = "chapter-title";
      title.textContent = entry.title;

      const path = document.createElement("div");
      path.className = "chapter-path";
      path.textContent = entry.path;

      item.appendChild(title);
      item.appendChild(path);
      item.addEventListener("click", () => openChapter(entry.id, true));
      els.chapterList.appendChild(item);
    }

    updateNavButtons();
  }

  async function openChapter(chapterId, closeSidebarOnMobile) {
    const entry = state.entries.find((item) => item.id === chapterId);
    if (!entry) return;

    flushProgressSave();
    state.currentId = chapterId;
    localStorage.setItem(LAST_CHAPTER_KEY, chapterId);

    renderChapterList();
    setChapterMeta(entry, "Loading...");

    try {
      const response = await fetch(toReaderPath(entry.path));
      if (!response.ok) {
        throw new Error(`Could not open ${entry.path} (${response.status})`);
      }

      const markdown = await response.text();
      const rendered = marked.parse(markdown, {
        mangle: false,
        headerIds: true
      });

      els.content.innerHTML = DOMPurify.sanitize(rendered);
      const words = countWords(markdown);
      const minutes = Math.max(1, Math.round(words / 220));
      setChapterMeta(entry, `${words.toLocaleString()} words · ~${minutes} min read`);

      requestAnimationFrame(() => {
        const savedTop = Number(state.progress[chapterId] || 0);
        els.readerPanel.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
      });

      if (closeSidebarOnMobile) {
        document.body.classList.remove("sidebar-open");
      }
    } catch (error) {
      setChapterMeta(entry, String(error.message || error));
      els.content.innerHTML = `<p class="empty-state">${escapeHtml(String(error.message || error))}</p>`;
    }
  }

  function setChapterMeta(entry, detail) {
    els.chapterTitle.textContent = entry ? entry.title : "Select a chapter";
    els.chapterInfo.textContent = entry ? `${entry.sourceLabel} · ${entry.path} · ${detail}` : detail;
  }

  function moveToSibling(direction) {
    if (!state.currentId || !state.visibleEntries.length) return;
    const currentIndex = state.visibleEntries.findIndex((entry) => entry.id === state.currentId);
    if (currentIndex < 0) return;

    const nextIndex = currentIndex + direction;
    const nextEntry = state.visibleEntries[nextIndex];
    if (nextEntry) {
      openChapter(nextEntry.id, true);
    }
  }

  function updateNavButtons() {
    if (!state.currentId) {
      els.prevBtn.disabled = true;
      els.nextBtn.disabled = true;
      return;
    }

    const currentIndex = state.visibleEntries.findIndex((entry) => entry.id === state.currentId);
    els.prevBtn.disabled = currentIndex <= 0;
    els.nextBtn.disabled = currentIndex < 0 || currentIndex >= state.visibleEntries.length - 1;
  }

  function hydrateSettingsControls() {
    const settings = { ...defaultSettings, ...state.settings };
    state.settings = settings;

    els.themeSelect.value = settings.theme;
    els.fontSelect.value = settings.font;
    els.fontSizeRange.value = String(settings.fontSize);
    els.lineHeightRange.value = String(settings.lineHeight);
    els.widthRange.value = String(settings.width);
  }

  function applyVisualSettings() {
    applyTheme();
    applyTypography();
  }

  function applyTheme() {
    const theme = state.settings.theme;
    const resolved = theme === "system"
      ? SYSTEM_THEME_QUERY.matches ? "dark" : "light"
      : theme;
    document.documentElement.setAttribute("data-theme", resolved);
  }

  function applyTypography() {
    const fontSize = clamp(Number(state.settings.fontSize), 14, 32);
    const lineHeight = clamp(Number(state.settings.lineHeight), 1.35, 2.2);
    const width = clamp(Number(state.settings.width), 560, 1080);
    const fontFamily = fontMap[state.settings.font] || fontMap.serif;

    document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--reader-line-height", `${lineHeight}`);
    document.documentElement.style.setProperty("--reader-width", `${width}px`);
    document.documentElement.style.setProperty("--reader-font", fontFamily);

    els.fontSizeValue.textContent = `${fontSize}px`;
    els.lineHeightValue.textContent = lineHeight.toFixed(2);
    els.widthValue.textContent = `${width}px`;
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function scheduleProgressSave() {
    if (state.saveTimer) return;
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
    }, 400);
  }

  function flushProgressSave() {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
  }

  function toReaderPath(rootRelativePath) {
    const safePath = rootRelativePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `../${safePath}`;
  }

  function countWords(text) {
    return (text.trim().match(/\S+/g) || []).length;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return cloneDefault(fallback);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...fallback, ...parsed };
      }
      return cloneDefault(fallback);
    } catch (_error) {
      return cloneDefault(fallback);
    }
  }

  function cloneDefault(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
