(function () {
  "use strict";

  /* ====== Storage Keys ====== */
  const SETTINGS_KEY = "novel_reader_settings_v1";
  const LAST_CHAPTER_KEY = "novel_reader_last_chapter_v1";
  const PROGRESS_KEY = "novel_reader_scroll_progress_v1";
  const BOOKMARKS_KEY = "novel_reader_bookmarks_v1";
  const READ_STATUS_KEY = "novel_reader_read_status_v1";

  const SYSTEM_THEME_QUERY = window.matchMedia("(prefers-color-scheme: dark)");

  const defaultSettings = {
    theme: "sepia",
    font: "serif",
    fontSize: 19,
    lineHeight: 1.75,
    width: 780,
    source: "all"
  };

  const fontMap = {
    serif: "'Source Serif 4', Georgia, serif",
    friendly: "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
    classic: "'Alegreya', Georgia, serif",
    myanmarSerif: "var(--reader-font-myanmar-serif)",
    myanmarSans: "var(--reader-font-myanmar-sans)",
    myanmarPadauk: "'Padauk', var(--reader-font-myanmar-sans)"
  };

  /* ====== State ====== */
  const state = {
    sources: [],
    entries: [],
    visibleEntries: [],
    cachedUrls: new Set(),
    currentId: null,
    settings: readJSON(SETTINGS_KEY, defaultSettings),
    progress: readJSON(PROGRESS_KEY, {}),
    bookmarks: readJSONArray(BOOKMARKS_KEY),
    readStatus: readJSON(READ_STATUS_KEY, {}),
    saveTimer: null,
    statusTimer: null
  };

  /* ====== DOM References ====== */
  const els = {
    appShell: document.getElementById("appShell"),
    sidebar: document.getElementById("sidebar"),
    closeSidebarBtn: document.getElementById("closeSidebarBtn"),
    openSidebarBtn: document.getElementById("openSidebarBtn"),
    toggleSettingsBtn: document.getElementById("toggleSettingsBtn"),
    chapterList: document.getElementById("chapterList"),
    settingsPanel: document.getElementById("settingsPanel"),
    sourceFilter: document.getElementById("sourceFilter"),
    searchInput: document.getElementById("searchInput"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    bookmarkBtn: document.getElementById("bookmarkBtn"),
    backToTopBtn: document.getElementById("backToTopBtn"),
    toastContainer: document.getElementById("toastContainer"),
    readingProgressBar: document.getElementById("readingProgressBar"),
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

  /* ====== Initialization ====== */
  async function init() {
    document.body.classList.add("js-ready");
    bindEvents();
    setSettingsPanelOpen(false);
    hydrateSettingsControls();
    applyVisualSettings();
    updateBookmarkButton();
    await loadManifest();
    registerStatusWorker();
  }

  function registerStatusWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      }).catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
    }
  }

  /* ====== Download Manager ====== */
  async function startDownloadEpisodes() {
    if (!state.currentId) return;

    // Find index of current chapter
    const currentIndex = state.entries.findIndex((entry) => entry.id === state.currentId);
    if (currentIndex < 0) return;

    // Slice up to 100 episodes from current
    const episodesToDownload = state.entries.slice(currentIndex, currentIndex + 100);

    if (!episodesToDownload.length) return;

    showToast(`Downloading ${episodesToDownload.length} episodes for offline use...`, true);

    let downloadedCount = 0;

    try {
      const cache = await caches.open('novel-offline-cache-v1');
      const fetchPromises = episodesToDownload.map(async (entry) => {
        const url = toReaderPath(entry.path);
        try {
          const response = await fetch(url, { cache: "no-store", mode: "cors" });
          if (response.ok) {
            await cache.put(url, response.clone());
            downloadedCount++;
            updateToastProgress((downloadedCount / episodesToDownload.length) * 100);
          }
        } catch (err) {
          console.warn(`Failed to fetch ${url}`, err);
        }
      });

      await Promise.all(fetchPromises);

      setTimeout(async () => {
        showToast(`Downloaded ${downloadedCount} episodes successfully!`, false, 3000);
        await refreshCachedUrls();
      }, 500);
    } catch (err) {
      console.error(err);
      showToast('Error during download process.', false, 3000);
    }
  }

  async function refreshCachedUrls() {
    try {
      const cache = await caches.open('novel-offline-cache-v1');
      const keys = await cache.keys();
      state.cachedUrls.clear();
      keys.forEach((request) => {
        state.cachedUrls.add(new URL(request.url).pathname);
      });
      renderChapterList();
    } catch (e) {
      console.warn("Could not query cache", e);
    }
  }

  let currentToast = null;
  function showToast(message, isProgress = false, autoHideMs = 0) {
    if (currentToast) {
      currentToast.element.classList.add('hiding');
      setTimeout((el) => el.remove(), 300, currentToast.element);
    }

    const toastEl = document.createElement("div");
    toastEl.className = "toast";

    const headerEl = document.createElement("div");
    headerEl.className = "toast-header";
    headerEl.textContent = message;
    toastEl.appendChild(headerEl);

    let progressEl = null;
    if (isProgress) {
      const trackEl = document.createElement("div");
      trackEl.className = "toast-progress";
      progressEl = document.createElement("div");
      progressEl.className = "toast-progress-bar";
      trackEl.appendChild(progressEl);
      toastEl.appendChild(trackEl);
    }

    els.toastContainer.appendChild(toastEl);

    currentToast = {
      element: toastEl,
      header: headerEl,
      progressBar: progressEl
    };

    if (autoHideMs > 0) {
      setTimeout(() => {
        toastEl.classList.add("hiding");
        setTimeout(() => toastEl.remove(), 300);
        if (currentToast && currentToast.element === toastEl) currentToast = null;
      }, autoHideMs);
    }
  }

  function updateToastProgress(percent) {
    if (currentToast && currentToast.progressBar) {
      currentToast.progressBar.style.width = `${percent}%`;
    }
  }

  /* ====== Event Binding ====== */
  function bindEvents() {
    els.searchInput.addEventListener("input", () => {
      renderChapterList();
    });

    els.prevBtn.addEventListener("click", () => moveToSibling(-1));
    els.nextBtn.addEventListener("click", () => moveToSibling(1));

    if (els.downloadBtn) {
      els.downloadBtn.addEventListener("click", () => {
        startDownloadEpisodes();
      });
    }

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
      if (isMobile()) {
        document.body.classList.add("sidebar-open");
      } else {
        document.body.classList.remove("sidebar-hidden");
      }
      setSettingsPanelOpen(false);
    });

    els.closeSidebarBtn.addEventListener("click", () => {
      if (isMobile()) {
        document.body.classList.remove("sidebar-open");
      } else {
        document.body.classList.add("sidebar-hidden");
      }
    });

    if (els.toggleSettingsBtn) {
      els.toggleSettingsBtn.addEventListener("click", () => {
        const isOpen = els.settingsPanel?.classList.contains("is-open");
        setSettingsPanelOpen(!isOpen);
      });
    }

    /* Bookmark toggle */
    els.bookmarkBtn.addEventListener("click", () => {
      if (!state.currentId) return;
      toggleBookmark(state.currentId);
    });

    /* Back to top */
    els.backToTopBtn.addEventListener("click", () => {
      els.readerPanel.scrollTo({ top: 0, behavior: "smooth" });
    });

    /* Scroll – progress bar, back-to-top, read status */
    els.readerPanel.addEventListener("scroll", () => {
      if (!state.currentId) return;

      const scrollTop = Math.max(0, els.readerPanel.scrollTop);
      state.progress[state.currentId] = scrollTop;
      scheduleProgressSave();

      updateReadingProgressBar();
      updateBackToTopVisibility(scrollTop);
      updateReadStatus();
    });

    window.addEventListener("beforeunload", () => {
      flushProgressSave();
      flushReadStatusSave();
    });

    SYSTEM_THEME_QUERY.addEventListener("change", () => {
      if (state.settings.theme === "system") {
        applyTheme();
      }
    });

    /* Keyboard shortcuts */
    document.addEventListener("keydown", (e) => {
      if (isInputFocused()) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          moveToSibling(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          moveToSibling(1);
          break;
        case "Escape":
          e.preventDefault();
          if (isMobile()) {
            document.body.classList.toggle("sidebar-open");
          } else {
            document.body.classList.toggle("sidebar-hidden");
          }
          break;
      }
    });
  }

  /* Manifest Loading */
  async function loadManifest() {
    try {
      const response = await fetch("./manifest.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load manifest (${response.status})`);
      }

      const payload = await response.json();
      state.sources = Array.isArray(payload.sources) ? payload.sources : [];
      state.entries = Array.isArray(payload.entries) ? payload.entries : [];

      await refreshCachedUrls();
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
      els.chapterInfo.textContent = String(error.message || error);
      els.content.innerHTML = `<p class="empty-state">Run <code>python reader/generate_manifest.py</code> then reload.</p>`;
    }
  }

  /* ====== Source Filter ====== */
  function renderSourceFilter() {
    const sources = state.sources.length
      ? state.sources
      : [...new Set(state.entries.map((entry) => entry.sourceLabel))];
    els.sourceFilter.innerHTML = "";

    const allButton = buildFilterChip("All", "all", state.settings.source === "all");
    els.sourceFilter.appendChild(allButton);

    for (const source of sources) {
      const active = state.settings.source === source;
      const button = buildFilterChip(source, source, active);
      els.sourceFilter.appendChild(button);
    }

    /* Bookmarks filter chip */
    const bookmarkActive = state.settings.source === "__bookmarks__";
    const bmChip = buildFilterChip("★ Bookmarks", "__bookmarks__", bookmarkActive);
    els.sourceFilter.appendChild(bmChip);

    /* Offline filter chip */
    const offlineActive = state.settings.source === "__offline__";
    const offlineChip = buildFilterChip("↓ Available Offline", "__offline__", offlineActive);
    els.sourceFilter.appendChild(offlineChip);
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

  /* ====== Chapter List ====== */
  function renderChapterList() {
    const query = els.searchInput.value.trim().toLowerCase();
    const sourceFilter = state.settings.source;

    const filtered = state.entries.filter((entry) => {
      const urlPath = new URL(toReaderPath(entry.path), window.location.href).pathname;
      const isOffline = state.cachedUrls.has(urlPath);

      if (sourceFilter === "__bookmarks__") {
        if (!state.bookmarks.includes(entry.id)) return false;
      } else if (sourceFilter === "__offline__") {
        if (!isOffline) return false;
      } else if (sourceFilter !== "all" && entry.sourceLabel !== sourceFilter) {
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
      if (sourceFilter === "__bookmarks__") {
        empty.textContent = "No bookmarked chapters yet.";
      } else if (sourceFilter === "__offline__") {
        empty.textContent = "No downloaded chapters found.";
      } else {
        empty.textContent = "No chapters match this filter.";
      }
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

      const info = document.createElement("div");
      info.className = "chapter-item-info";

      const title = document.createElement("div");
      title.className = "chapter-title";
      title.textContent = entry.title;

      info.appendChild(title);

      const indicators = document.createElement("div");
      indicators.className = "chapter-indicators";

      /* Bookmark indicator */
      if (state.bookmarks.includes(entry.id)) {
        const bmIcon = document.createElement("span");
        bmIcon.className = "bookmark-indicator";
        bmIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        indicators.appendChild(bmIcon);
      }

      /* Offline indicator */
      const urlPath = new URL(toReaderPath(entry.path), window.location.href).pathname;
      if (state.cachedUrls.has(urlPath)) {
        const offlineIcon = document.createElement("span");
        offlineIcon.className = "offline-indicator";
        offlineIcon.title = "Available Offline";
        offlineIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
        indicators.appendChild(offlineIcon);
      }

      /* Read status dot */
      const statusDot = document.createElement("span");
      const readRatio = state.readStatus[entry.id] || 0;
      let statusClass = "unread";
      if (readRatio >= 0.9) statusClass = "completed";
      else if (readRatio > 0.05) statusClass = "in-progress";
      statusDot.className = `status-dot ${statusClass}`;
      indicators.appendChild(statusDot);

      item.appendChild(info);
      item.appendChild(indicators);
      item.addEventListener("click", () => openChapter(entry.id, true));
      els.chapterList.appendChild(item);
    }

    updateNavButtons();
  }

  /* ====== Open Chapter ====== */
  async function openChapter(chapterId, closeSidebarOnMobile) {
    const entry = state.entries.find((item) => item.id === chapterId);
    if (!entry) return;

    flushProgressSave();
    flushReadStatusSave();
    state.currentId = chapterId;
    localStorage.setItem(LAST_CHAPTER_KEY, chapterId);

    renderChapterList();
    updateBookmarkButton();
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
      setChapterMeta(entry);

      requestAnimationFrame(() => {
        const savedTop = Number(state.progress[chapterId] || 0);
        els.readerPanel.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
        updateReadingProgressBar();
        updateBackToTopVisibility(els.readerPanel.scrollTop);
      });

      if (closeSidebarOnMobile) {
        document.body.classList.remove("sidebar-open");
      }
    } catch (error) {
      setChapterMeta(entry, String(error.message || error));
      els.content.innerHTML = `<p class="empty-state">${escapeHtml(String(error.message || error))}</p>`;
    }
  }

  function setChapterMeta(entry) {
    els.chapterTitle.textContent = entry ? entry.title : "Select a chapter";
    els.chapterInfo.textContent = "";
  }

  /* ====== Navigation ====== */
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

  /* ====== Bookmarks ====== */
  function toggleBookmark(chapterId) {
    const index = state.bookmarks.indexOf(chapterId);
    if (index >= 0) {
      state.bookmarks.splice(index, 1);
    } else {
      state.bookmarks.push(chapterId);
    }
    saveBookmarks();
    updateBookmarkButton();
    renderChapterList();
  }

  function updateBookmarkButton() {
    const isBookmarked = state.currentId && state.bookmarks.includes(state.currentId);
    els.bookmarkBtn.setAttribute("aria-pressed", String(Boolean(isBookmarked)));
    els.bookmarkBtn.disabled = !state.currentId;
  }

  function saveBookmarks() {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(state.bookmarks));
  }

  /* ====== Reading Progress Bar ====== */
  function updateReadingProgressBar() {
    const el = els.readerPanel;
    const scrollHeight = el.scrollHeight - el.clientHeight;
    if (scrollHeight <= 0) {
      els.readingProgressBar.style.width = "0%";
      return;
    }
    const percent = Math.min(100, (el.scrollTop / scrollHeight) * 100);
    els.readingProgressBar.style.width = `${percent}%`;
  }

  /* ====== Back to Top ====== */
  function updateBackToTopVisibility(scrollTop) {
    els.backToTopBtn.classList.toggle("visible", scrollTop > 400);
  }

  /* ====== Read Status Tracking ====== */
  function updateReadStatus() {
    if (!state.currentId) return;
    const el = els.readerPanel;
    const scrollHeight = el.scrollHeight - el.clientHeight;
    if (scrollHeight <= 0) return;

    const ratio = Math.min(1, el.scrollTop / scrollHeight);
    const current = state.readStatus[state.currentId] || 0;
    if (ratio > current) {
      state.readStatus[state.currentId] = Math.round(ratio * 100) / 100;
      scheduleReadStatusSave();
    }
  }

  function scheduleReadStatusSave() {
    if (state.statusTimer) return;
    state.statusTimer = window.setTimeout(() => {
      state.statusTimer = null;
      localStorage.setItem(READ_STATUS_KEY, JSON.stringify(state.readStatus));
    }, 800);
  }

  function flushReadStatusSave() {
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    localStorage.setItem(READ_STATUS_KEY, JSON.stringify(state.readStatus));
  }

  /* ====== Settings ====== */
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

  function setSettingsPanelOpen(isOpen) {
    if (els.settingsPanel) {
      els.settingsPanel.classList.toggle("is-open", Boolean(isOpen));
    }
    if (!els.toggleSettingsBtn) return;
    const expanded = Boolean(isOpen);
    els.toggleSettingsBtn.setAttribute("aria-expanded", String(expanded));
  }

  function applyTheme() {
    const theme = state.settings.theme;
    let resolved;
    if (theme === "system") {
      resolved = SYSTEM_THEME_QUERY.matches ? "dark" : "light";
    } else {
      resolved = theme;
    }
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

  /* ====== Scroll Progress Persistence ====== */
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

  /* ====== Utilities ====== */
  function toReaderPath(rootRelativePath) {
    const safePath = rootRelativePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `../${safePath}`;
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

  function readJSONArray(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
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

  function isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable;
  }

  function isMobile() {
    return window.innerWidth <= 980;
  }
})();
