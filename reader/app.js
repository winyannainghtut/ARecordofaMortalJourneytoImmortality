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
    myanmarSystem: "var(--reader-font-myanmar-system)",
    myanmarText: "var(--reader-font-myanmar-text)",
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
    readerPanel: document.getElementById("readerPanel"),
    readerHeader: document.getElementById("readerHeader"),
    chapterTitle: document.getElementById("chapterTitle"),
    chapterInfo: document.getElementById("chapterInfo"),
    content: document.getElementById("content"),
    readingProgressBar: document.getElementById("readingProgressBar"),

    /* Modals */
    libraryModal: document.getElementById("libraryModal"),
    settingsModal: document.getElementById("settingsModal"),

    /* Library */
    chapterList: document.getElementById("chapterList"),
    sourceFilter: document.getElementById("sourceFilter"),
    searchInput: document.getElementById("searchInput"),

    /* Settings */
    themeSelect: document.getElementById("themeSelect"),
    fontSelect: document.getElementById("fontSelect"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightRange: document.getElementById("lineHeightRange"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    widthRange: document.getElementById("widthRange"),
    widthValue: document.getElementById("widthValue"),

    /* Controls */
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    bookmarkBtn: document.getElementById("bookmarkBtn"),

    /* Navigation Tabs & Header Buttons */
    tabLibraryBtn: document.getElementById("tabLibraryBtn"),
    tabReaderBtn: document.getElementById("tabReaderBtn"),
    tabSettingsBtn: document.getElementById("tabSettingsBtn"),
    headerLibraryBtn: document.getElementById("headerLibraryBtn"),
    headerSettingsBtn: document.getElementById("headerSettingsBtn"),

    /* Feedback & FAB */
    toastContainer: document.getElementById("toastContainer"),
    scrollTopBtn: document.getElementById("scrollTopBtn"),

    /* Stats */
    statCompleted: document.getElementById("statCompleted"),
    statInProgress: document.getElementById("statInProgress"),
    statTotal: document.getElementById("statTotal")
  };

  /* Modal state */
  const modals = {
    library: false,
    settings: false
  };

  init();

  /* ====== Initialization ====== */
  async function init() {
    document.body.classList.add("js-ready");
    bindEvents();
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
      // Throttle downloads to 5 concurrent requests at a time
      for (let i = 0; i < episodesToDownload.length; i += 5) {
        const chunk = episodesToDownload.slice(i, i + 5);
        const fetchPromises = chunk.map(async (entry) => {
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
      }

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
    /* Modal Dismissal */
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-close-modal');
        closeModal(targetId);
      });
    });

    /* Tab Bar Navigation */
    els.tabLibraryBtn?.addEventListener("click", () => openModal('libraryModal', els.tabLibraryBtn));
    els.tabSettingsBtn?.addEventListener("click", () => {
      openModal('settingsModal', els.tabSettingsBtn);
      renderReadingStats();
    });
    els.tabReaderBtn?.addEventListener("click", () => {
      closeAllModals();
      updateActiveTab(els.tabReaderBtn);
    });

    /* Header Nav Buttons (Mobile Equivalent) */
    els.headerLibraryBtn?.addEventListener("click", () => openModal('libraryModal'));
    els.headerSettingsBtn?.addEventListener("click", () => {
      openModal('settingsModal');
      renderReadingStats();
    });

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

    /* Settings Changes */
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

    /* Bookmark toggle */
    els.bookmarkBtn.addEventListener("click", () => {
      if (!state.currentId) return;
      toggleBookmark(state.currentId);
    });

    /* Immersive Mode Scroll Logic */
    let lastScrollTop = 0;
    const IMMERSIVE_THRESHOLD = 50;
    let scrollDelta = 0;

    /* Content click to toggle immersive mode */
    els.content.addEventListener("click", () => {
      document.body.classList.toggle("immersive-mode");
    });

    /* Scroll – progress bar, read status, immersive header */
    let isScrolling = false;
    els.readerPanel.addEventListener("scroll", () => {
      if (!state.currentId) return;
      if (isScrolling) return;

      isScrolling = true;
      requestAnimationFrame(() => {
        isScrolling = false;
        const scrollTop = Math.max(0, els.readerPanel.scrollTop);
        state.progress[state.currentId] = scrollTop;
        scheduleProgressSave();

        /* Handle immersive mode thresholding */
        const delta = scrollTop - lastScrollTop;
        lastScrollTop = scrollTop;

        if (delta > 0 && scrollTop > 60) {
          // Scrolling down
          scrollDelta += delta;
          if (scrollDelta > IMMERSIVE_THRESHOLD) {
            document.body.classList.add("immersive-mode");
            scrollDelta = 0;
          }
        } else if (delta < 0) {
          // Scrolling up
          scrollDelta += delta;
          if (scrollDelta < -IMMERSIVE_THRESHOLD || scrollTop <= 40) {
            document.body.classList.remove("immersive-mode");
            scrollDelta = 0;
          }
        }

        /* FAB Scroll To Top Toggle */
        if (scrollTop > 800) {
          els.scrollTopBtn.removeAttribute('hidden');
        } else {
          els.scrollTopBtn.setAttribute('hidden', 'true');
        }

        updateReadingProgressBar();
        updateReadStatus();
      });
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
          closeAllModals();
          break;
      }
    });

    /* Scroll to Top FAB click */
    els.scrollTopBtn?.addEventListener("click", () => {
      els.readerPanel.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ====== Modal Management ====== */
  function openModal(modalId, tabBtn) {
    closeAllModals();
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
      modalEl.classList.add('is-open');
      modalEl.setAttribute('aria-hidden', 'false');
    }
    if (tabBtn) updateActiveTab(tabBtn);
  }

  function closeModal(modalId) {
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
      modalEl.classList.remove('is-open');
      modalEl.setAttribute('aria-hidden', 'true');
    }
    updateActiveTab(els.tabReaderBtn);
  }

  function closeAllModals() {
    ['libraryModal', 'settingsModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function updateActiveTab(activeBtn) {
    document.querySelectorAll('.ios-tab-bar .tab-btn').forEach(btn => {
      if (btn.id !== 'bookmarkBtn') { // don't toggle bookmark active state based on view
        btn.classList.remove('active');
      }
    });
    if (activeBtn && activeBtn.id !== 'bookmarkBtn') {
      activeBtn.classList.add('active');
    }
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
      const empty = document.createElement("div");
      empty.className = "welcome-state";
      if (sourceFilter === "__bookmarks__") {
        empty.innerHTML = `<p class="welcome-title">No Bookmarked Chapters</p>`;
      } else if (sourceFilter === "__offline__") {
        empty.innerHTML = `<p class="welcome-title">No Downloaded Chapters</p>`;
      } else {
        empty.innerHTML = `<p class="welcome-title">No Chapters Found</p>`;
      }
      els.chapterList.appendChild(empty);
      updateNavButtons();
      return;
    }

    let lastGroupKey = "";
    let currentGroupContainer = null;
    for (const entry of filtered) {
      const groupLabel = `${entry.sourceLabel} / ${entry.group || "root"}`;
      if (groupLabel !== lastGroupKey) {
        const groupTitle = document.createElement("div");
        groupTitle.className = "list-group-title";
        groupTitle.textContent = groupLabel;
        els.chapterList.appendChild(groupTitle);

        currentGroupContainer = document.createElement("div");
        currentGroupContainer.className = "ios-list-group";
        els.chapterList.appendChild(currentGroupContainer);

        lastGroupKey = groupLabel;
      }

      const item = document.createElement("div");
      item.className = `ios-cell${entry.id === state.currentId ? " active" : ""}`;
      item.dataset.chapterId = entry.id;

      const info = document.createElement("div");
      info.className = "cell-content";

      const title = document.createElement("div");
      title.className = "cell-title truncate";
      title.textContent = entry.title;
      info.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.className = "cell-subtitle truncate";
      subtitle.textContent = entry.path;
      info.appendChild(subtitle);

      const indicators = document.createElement("div");
      indicators.className = "cell-indicators";

      /* Bookmark indicator */
      if (state.bookmarks.includes(entry.id)) {
        const bmIcon = document.createElement("span");
        bmIcon.className = "saved-icon";
        bmIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        indicators.appendChild(bmIcon);
      }

      /* Offline indicator */
      const urlPath = new URL(toReaderPath(entry.path), window.location.href).pathname;
      if (state.cachedUrls.has(urlPath)) {
        const offlineIcon = document.createElement("span");
        offlineIcon.className = "downloaded-icon";
        offlineIcon.title = "Available Offline";
        offlineIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
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

      /* Chevron (iOS 15+ style) */
      const chevron = document.createElement("span");
      chevron.className = "cell-chevron";
      chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
      indicators.appendChild(chevron);

      item.appendChild(info);
      item.appendChild(indicators);

      /* Per-cell reading progress bar */
      if (readRatio > 0.02) {
        const progressBar = document.createElement("div");
        progressBar.className = `cell-progress-bar ${statusClass}`;
        progressBar.style.width = `${(readRatio * 100).toFixed(1)}%`;
        item.appendChild(progressBar);
      }

      item.addEventListener("click", () => {
        openChapter(entry.id);
        closeModal('libraryModal');
      });

      currentGroupContainer.appendChild(item);
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
        headerIds: true,
        smartypants: true
      });

      els.content.style.opacity = '0';
      els.content.innerHTML = DOMPurify.sanitize(rendered);
      setChapterMeta(entry);

      requestAnimationFrame(() => {
        const savedTop = Number(state.progress[chapterId] || 0);
        els.readerPanel.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
        updateReadingProgressBar();

        // Fade in
        requestAnimationFrame(() => {
          els.content.style.transition = 'opacity 300ms ease';
          els.content.style.opacity = '1';
        });
      });
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
    if (isBookmarked) {
      els.bookmarkBtn.classList.add('saved');
    } else {
      els.bookmarkBtn.classList.remove('saved');
    }
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

    /* Update slider fill positions */
    updateSliderFill(els.fontSizeRange, 14, 32);
    updateSliderFill(els.lineHeightRange, 1.35, 2.2);
    updateSliderFill(els.widthRange, 560, 1080);
  }

  function updateSliderFill(slider, min, max) {
    if (!slider) return;
    const val = clamp(Number(slider.value), min, max);
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty("--slider-fill", `${pct.toFixed(1)}%`);
  }

  /* ====== Reading Stats ====== */
  function renderReadingStats() {
    if (!els.statCompleted || !els.statInProgress || !els.statTotal) return;
    const total = state.entries.length;
    let completed = 0;
    let inProgress = 0;
    for (const entry of state.entries) {
      const ratio = state.readStatus[entry.id] || 0;
      if (ratio >= 0.9) completed++;
      else if (ratio > 0.05) inProgress++;
    }
    els.statCompleted.textContent = completed;
    els.statInProgress.textContent = inProgress;
    els.statTotal.textContent = total;
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
