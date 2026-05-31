(function () {
  "use strict";

  /* ─────────────────────────────────────────────────────────────
     CONSTANTS & CONFIGURATION
  ───────────────────────────────────────────────────────────── */
  const repoScope = (() => {
    const first = window.location.pathname.split("/").filter(Boolean)[0];
    return first || "local";
  })();

  const SETTINGS_KEY = `novel_reader_settings_${repoScope}_v2`;
  const LAST_CHAPTER_KEY = `novel_reader_last_chapter_${repoScope}_v2`;
  const PROGRESS_KEY = `novel_reader_scroll_progress_${repoScope}_v2`;
  const BOOKMARKS_KEY = `novel_reader_bookmarks_${repoScope}_v2`;
  const OFFLINE_CHAPTERS_KEY = `novel_reader_offline_chapters_${repoScope}_v2`;
  const SW_RELOAD_KEY = `novel_reader_sw_reload_once_${repoScope}_v1`;

  /* Legacy keys for migration */
  const LEGACY_SETTINGS_KEY = "novel_reader_settings_v1";
  const LEGACY_LAST_KEY = "novel_reader_last_chapter_v1";
  const LEGACY_PROGRESS_KEY = "novel_reader_scroll_progress_v1";

  const MOBILE_QUERY = window.matchMedia("(max-width: 979px)");
  const FONT_SIZE_MIN = 14;
  const FONT_SIZE_MAX = 32;
  const FONT_SIZE_STEP = 1;
  const SEARCH_DEBOUNCE_MS = 120;
  const CHAPTER_LIST_BATCH_SIZE = 200;
  const CHAPTER_LIST_SCROLL_THRESHOLD = 240;
  const SCROLL_SHOW_THRESHOLD = 280;
  const AUTO_SCROLL_SPEED_MIN = 8;
  const AUTO_SCROLL_SPEED_MAX = 160;
  const AUTO_SCROLL_SPEED_DEFAULT = 32;
  const OFFLINE_WINDOW = 100;
  const OFFLINE_SW_URL = "./sw.js";
  const OFFLINE_SHELL_URLS = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./manifest.json",
    "./app-manifest.json",
    "./vendor/marked.min.js",
    "./vendor/purify.min.js",
    "./icons/icon.svg",
    "./icons/favicon.svg",
    "./icons/maskable.svg",
    OFFLINE_SW_URL,
  ];

  const VALID_THEMES = new Set([
    "light",
    "eink",
    "eink-warm",
    "eink-contrast",
    "eink-night",
    "dark",
    "sepia",
  ]);

  const defaultSettings = {
    theme: "eink",
    fontSize: 19,
    lineHeight: 1.75,
    width: 780,
    autoScrollSpeed: AUTO_SCROLL_SPEED_DEFAULT,
    source: "all",
  };

  /* Source filter special values */
  const FILTER_ALL = "all";
  const FILTER_BOOKMARK = "__bookmarks__";
  const FILTER_OFFLINE = "__offline__";

  /* ─────────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────────── */
  const state = {
    /* Library */
    entries: [],
    entriesById: new Map(),
    entriesBySource: new Map(),
    filteredEntries: [],
    chapterButtonById: new Map(),
    activeChapterButtonId: null,
    chapterRenderLimit: 0,
    chapterRenderKey: "",
    currentId: null,

    /* Settings */
    settings: sanitizeSettings(
      readJSONWithLegacy(SETTINGS_KEY, LEGACY_SETTINGS_KEY, defaultSettings),
    ),

    /* Progress { [chapterId]: { scroll: number } } */
    progress: readProgress(),

    /* Bookmarks: Set<chapterId> */
    bookmarks: loadBookmarks(),

    /* Offline chapters: Set<chapterId> */
    offlineChapters: loadOfflineChapters(),

    /* UI state */
    isLoadingChapter: false,
    settingsOpen: false,
    sidebarReturnFocusEl: null,
    chromeVisible: true,
    readProgress: 0,
    lastContentScrollTop: 0,
    scrollToTopVisible: false,
    scrollButtonRaf: null,
    pendingScrollTop: 0,
    autoScrollActive: false,
    autoScrollRaf: null,
    autoScrollLastTs: 0,
    autoScrollTop: 0,
    autoScrollFallbackTop: 0,
    autoScrollProgrammatic: false,

    /* Timers */
    saveTimer: null,
    searchRenderTimer: null,

    /* Fetch */
    requestSequence: 0,
    activeFetchController: null,

    /* Gestures */
    pressState: null,
    pageSwipeState: null,
    ignoreNextChapterClickUntil: 0,
    ignoreNextReaderTapUntil: 0,

    /* Detail sheet */
    detailChapterId: null,

    /* Offline download */
    offlineSupported: false,
    offlineCaching: false,
    offlineReady: false,
    offlineCachedCount: 0,
    offlineCachedChapterCount: 0,
    offlineTotalCount: 0,
    offlineTargetCount: 0,
    offlineTargetIds: [],
    offlineError: "",
    swRegistration: null,
  };

  /* ─────────────────────────────────────────────────────────────
     ELEMENT REFS
  ───────────────────────────────────────────────────────────── */
  const els = {
    appShell: q("appShell"),
    sidebar: q("sidebar"),
    closeSidebarBtn: q("closeSidebarBtn"),
    openSidebarBtn: q("openSidebarBtn"),
    sidebarScrim: q("sidebarScrim"),
    scrollToTopBtn: q("scrollToTopBtn"),
    chapterList: q("chapterList"),
    sourceFilter: q("sourceFilter"),
    libraryMeta: q("libraryMeta"),
    searchInput: q("searchInput"),
    prevBtn: q("prevBtn"),
    nextBtn: q("nextBtn"),
    toggleSettingsBtn: q("toggleSettingsBtn"),
    settingsPanel: q("settingsPanel"),
    toolbar: q("toolbar"),
    themeSelect: q("themeSelect"),
    decreaseFontSizeBtn: q("decreaseFontSizeBtn"),
    fontSizeRange: q("fontSizeRange"),
    increaseFontSizeBtn: q("increaseFontSizeBtn"),
    fontSizeValue: q("fontSizeValue"),
    lineHeightRange: q("lineHeightRange"),
    lineHeightValue: q("lineHeightValue"),
    widthRange: q("widthRange"),
    widthValue: q("widthValue"),
    autoScrollSpeedRange: q("autoScrollSpeedRange"),
    autoScrollSpeedValue: q("autoScrollSpeedValue"),
    autoScrollToolbarBtn: q("autoScrollToolbarBtn"),
    autoScrollToggleBtn: q("autoScrollToggleBtn"),
    autoScrollControl: q("autoScrollControl"),
    autoScrollLabel: q("autoScrollLabel"),
    autoScrollSpeedPill: q("autoScrollSpeedPill"),
    offlineCacheBtn: q("offlineCacheBtn"),
    offlineStatus: q("offlineStatus"),
    chapterTitle: q("chapterTitle"),
    chapterInfo: q("chapterInfo"),
    chapterMetaBadges: q("chapterMetaBadges"),
    content: q("content"),
    contentStage: q("contentStage"),
    readerPanel: q("readerPanel"),
    ambientGlow: q("ambientGlow"),
    readProgressFill: q("readProgressFill"),
    bottomNav: q("bottomNav"),
    navLibraryBtn: q("navLibraryBtn"),
    navPrevBtn: q("navPrevBtn"),
    navNextBtn: q("navNextBtn"),
    navBookmarkBtn: q("navBookmarkBtn"),
    navSettingsBtn: q("navSettingsBtn"),
    readerViewport: q("readerViewport"),
    bookDetailSheet: q("bookDetailSheet"),
    bookDetailTitle: q("bookDetailTitle"),
    bookDetailPath: q("bookDetailPath"),
    bookDetailSource: q("bookDetailSource"),
    bookDetailExcerpt: q("bookDetailExcerpt"),
    openFromDetailBtn: q("openFromDetailBtn"),
    detailBookmarkBtn: q("detailBookmarkBtn"),
    closeBookDetailBtn: q("closeBookDetailBtn"),
    bookmarkBtn: q("bookmarkBtn"),
    statCompletedNum: q("statCompletedNum"),
    statInProgressNum: q("statInProgressNum"),
    statTotalNum: q("statTotalNum"),
    dlToast: q("dlToast"),
    dlToastLabel: q("dlToastLabel"),
    dlToastBar: q("dlToastBar"),
    dlToastDetail: q("dlToastDetail"),
    dlToastClose: q("dlToastClose"),
    themeColorMeta: document.getElementById("themeColorMeta"),
  };

  function q(id) {
    return document.getElementById(id);
  }

  /* ─────────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────────── */
  init();

  async function init() {
    bindEvents();
    initOfflineMode();
    hydrateSettingsControls();
    applyVisualSettings();
    setSettingsOpen(false);
    syncResponsiveState();
    applyProgressBar(0);
    state.lastContentScrollTop = 0;
    await loadManifest();
  }

  /* ─────────────────────────────────────────────────────────────
     EVENT BINDING
  ───────────────────────────────────────────────────────────── */
  function bindEvents() {
    /* Search */
    els.searchInput.addEventListener("input", scheduleChapterListRender);

    /* Chapter list */
    els.chapterList.addEventListener("click", handleChapterListClick);
    els.chapterList.addEventListener(
      "pointerdown",
      handleChapterListPointerStart,
    );
    els.chapterList.addEventListener(
      "pointermove",
      handleChapterListPointerMove,
    );
    els.chapterList.addEventListener("pointerup", handleChapterListPointerEnd);
    els.chapterList.addEventListener(
      "pointercancel",
      handleChapterListPointerEnd,
    );
    els.chapterList.addEventListener(
      "pointerleave",
      handleChapterListPointerEnd,
    );
    els.chapterList.addEventListener("scroll", handleChapterListScroll, {
      passive: true,
    });

    /* Navigation */
    els.prevBtn.addEventListener("click", () => moveToSibling(-1));
    els.nextBtn.addEventListener("click", () => moveToSibling(1));
    
    if (els.navLibraryBtn) els.navLibraryBtn.addEventListener("click", () => setSidebarOpen(true));
    if (els.navPrevBtn) els.navPrevBtn.addEventListener("click", () => moveToSibling(-1));
    if (els.navNextBtn) els.navNextBtn.addEventListener("click", () => moveToSibling(1));

    /* Sidebar */
    els.openSidebarBtn.addEventListener("click", () => setSidebarOpen(true));
    els.closeSidebarBtn.addEventListener("click", () => setSidebarOpen(false));
    els.sidebarScrim.addEventListener("click", () => setSidebarOpen(false));

    /* Settings panel toggle */
    els.toggleSettingsBtn.addEventListener("click", () =>
      setSettingsOpen(!state.settingsOpen),
    );
    if (els.navSettingsBtn) els.navSettingsBtn.addEventListener("click", () =>
      setSettingsOpen(!state.settingsOpen),
    );

    /* Click outside settings to close */
    document.addEventListener("click", (e) => {
      if (!state.settingsOpen) return;
      if (els.toolbar && els.toolbar.contains(e.target)) return;
      if (els.bottomNav && els.bottomNav.contains(e.target)) return;
      setSettingsOpen(false);
    });

    if (els.settingsPanel) {
      els.settingsPanel.addEventListener("pointerdown", (e) =>
        e.stopPropagation(),
      );
      els.settingsPanel.addEventListener("click", (e) => e.stopPropagation());
    }

    /* Theme */
    els.themeSelect.addEventListener("change", () => {
      state.settings.theme = normalizeTheme(els.themeSelect.value);
      saveSettings();
      applyTheme();
    });

    /* Font size */
    const onFontSizeInput = () => setFontSize(els.fontSizeRange.value);
    els.fontSizeRange.addEventListener("input", onFontSizeInput);
    els.fontSizeRange.addEventListener("change", onFontSizeInput);

    on(els.decreaseFontSizeBtn, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFontSize(Number(state.settings.fontSize) - FONT_SIZE_STEP);
    });
    on(els.increaseFontSizeBtn, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFontSize(Number(state.settings.fontSize) + FONT_SIZE_STEP);
    });

    /* Line height & width */
    els.lineHeightRange.addEventListener("input", () => {
      state.settings.lineHeight = clamp(
        Number(els.lineHeightRange.value),
        1.35,
        2.2,
      );
      applyTypography();
      saveSettings();
    });
    els.widthRange.addEventListener("input", () => {
      // Width control is hidden on mobile — skip update to avoid wasted work
      if (MOBILE_QUERY.matches) return;
      state.settings.width = clamp(Number(els.widthRange.value), 560, 1080);
      applyTypography();
      saveSettings();
    });

    const onAutoScrollSpeedInput = () => {
      state.settings.autoScrollSpeed = normalizeAutoScrollSpeed(
        els.autoScrollSpeedRange.value,
      );
      applyAutoScrollSettings();
      saveSettings();
    };
    on(els.autoScrollSpeedRange, "input", onAutoScrollSpeedInput);
    on(els.autoScrollSpeedRange, "change", onAutoScrollSpeedInput);
    on(els.autoScrollToolbarBtn, "click", () => toggleAutoScroll());
    on(els.autoScrollToggleBtn, "click", () => toggleAutoScroll());

    /* Offline cache */
    on(els.offlineCacheBtn, "click", () => startOfflineDownload());

    /* Scroll to top */
    on(els.scrollToTopBtn, "click", scrollToTop);

    /* Bookmarks */
    on(els.bookmarkBtn, "click", () => toggleBookmarkForCurrent());
    on(els.navBookmarkBtn, "click", () => toggleBookmarkForCurrent());

    /* Detail sheet */
    on(els.openFromDetailBtn, "click", () => {
      const id = state.detailChapterId;
      if (!id) return;
      closeBookDetailSheet();
      openChapter(id, { closeSidebarOnMobile: true });
    });
    on(els.detailBookmarkBtn, "click", () => {
      const id = state.detailChapterId;
      if (!id) return;
      toggleBookmark(id);
      updateDetailBookmarkBtn(id);
    });
    on(els.closeBookDetailBtn, "click", closeBookDetailSheet);
    if (els.bookDetailSheet) {
      els.bookDetailSheet.addEventListener("click", (e) => {
        if (e.target === els.bookDetailSheet) closeBookDetailSheet();
      });
    }

    /* Download toast close */
    on(els.dlToastClose, "click", () => hideToast());

    /* Keyboard */
    document.addEventListener("keydown", handleGlobalKeydown);

    /* Scroll */
    els.contentStage.addEventListener("scroll", handleReaderScroll, {
      passive: true,
    });
    els.contentStage.addEventListener("wheel", stopAutoScrollForUserInput, {
      passive: true,
    });
    els.contentStage.addEventListener("touchstart", stopAutoScrollForUserInput, {
      passive: true,
    });
    els.contentStage.addEventListener("pointerdown", stopAutoScrollForUserInput, {
      passive: true,
    });
    window.addEventListener("scroll", handleWindowScroll, { passive: true });

    /* Content link clicks */
    els.content.addEventListener("click", handleContentLinkClick);

    /* Reader surface tap (immersive toggle) */
    if (els.readerViewport) {
      els.readerViewport.addEventListener("click", handleReaderSurfaceTap);
    }

    /* Online/offline */
    window.addEventListener("online", () => updateOfflineUI());
    window.addEventListener("offline", () => updateOfflineUI());

    /* Save on unload */
    window.addEventListener("beforeunload", () => {
      persistCurrentProgress();
      flushProgressSave();
    });

    /* Responsive */
    addMediaQueryListener(MOBILE_QUERY, syncResponsiveState);

    /* Gestures */
    bindReaderGestures();
    bindRippleOnButtons();
  }

  function on(el, event, handler) {
    if (el) el.addEventListener(event, handler);
  }

  function focusElement(el) {
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }
  }

  /* ─────────────────────────────────────────────────────────────
     KEYBOARD
  ───────────────────────────────────────────────────────────── */
  function handleGlobalKeydown(e) {
    if (
      state.autoScrollActive &&
      [" ", "PageDown", "PageUp", "Home", "End", "ArrowUp", "ArrowDown"].includes(
        e.key,
      )
    ) {
      stopAutoScroll();
    }

    if (e.key === "Escape") {
      if (isBookDetailOpen()) {
        closeBookDetailSheet();
        return;
      }
      if (isSidebarOpen()) {
        setSidebarOpen(false);
        return;
      }
      if (state.settingsOpen) {
        setSettingsOpen(false);
        return;
      }
    }

    if (isTypingTarget(e.target)) return;

    if (e.key === "ArrowLeft") moveToSibling(-1);
    if (e.key === "ArrowRight") moveToSibling(1);
    if (e.key === "b" || e.key === "B") toggleBookmarkForCurrent();
  }

  function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return Boolean(
      target.closest("input, textarea, select, [contenteditable='true']"),
    );
  }

  /* ─────────────────────────────────────────────────────────────
     SIDEBAR
  ───────────────────────────────────────────────────────────── */
  function setSidebarOpen(open) {
    const shouldOpen = Boolean(open);
    const wasOpen = isSidebarOpen();
    if (shouldOpen && !wasOpen && document.activeElement instanceof HTMLElement) {
      state.sidebarReturnFocusEl = document.activeElement;
    }
    els.appShell.classList.toggle("sidebar-visible", shouldOpen);
    if (els.sidebar) {
      els.sidebar.toggleAttribute("inert", !shouldOpen);
      els.sidebar.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    }
    if (shouldOpen) {
      setChromeVisible(true);
      requestAnimationFrame(() => focusElement(els.closeSidebarBtn));
    } else if (wasOpen && state.sidebarReturnFocusEl) {
      const returnTarget = state.sidebarReturnFocusEl;
      state.sidebarReturnFocusEl = null;
      requestAnimationFrame(() => focusElement(returnTarget));
    }
  }

  function isSidebarOpen() {
    return els.appShell.classList.contains("sidebar-visible");
  }

  /* ─────────────────────────────────────────────────────────────
     SETTINGS PANEL
  ───────────────────────────────────────────────────────────── */
  function setSettingsOpen(open) {
    const wasOpen = state.settingsOpen;
    state.settingsOpen = Boolean(open);
    if (state.settingsOpen) {
      setChromeVisible(true);
      updateStats();
    }
    if (els.settingsPanel) els.settingsPanel.hidden = !state.settingsOpen;

    const expanded = state.settingsOpen ? "true" : "false";
    const label = state.settingsOpen ? "Close settings" : "Open settings";
    setAriaExpanded(els.toggleSettingsBtn, expanded, label);

    /* Sync mobile nav settings button active state */
    if (els.navSettingsBtn) {
      els.navSettingsBtn.classList.toggle("nav-active", state.settingsOpen);
      setAriaExpanded(els.navSettingsBtn, expanded, label);
    }
    if (state.settingsOpen && !wasOpen) {
      requestAnimationFrame(() => focusElement(els.themeSelect));
    }
  }

  function setAriaExpanded(el, value, label) {
    if (!el) return;
    el.setAttribute("aria-expanded", value);
    el.setAttribute("aria-label", label);
    el.title = label;
  }

  /* ─────────────────────────────────────────────────────────────
     CHROME VISIBILITY (immersive mode)
  ───────────────────────────────────────────────────────────── */
  function setChromeVisible(visible) {
    const next = Boolean(visible);
    state.chromeVisible = next;
    if (els.appShell) {
      els.appShell.classList.toggle("reader-chrome-hidden", !next);
    }
    if (!next && state.settingsOpen) setSettingsOpen(false);
  }

  function handleReaderSurfaceTap(e) {
    if (Date.now() < state.ignoreNextReaderTapUntil) return;
    if (!(e.target instanceof Element)) return;
    if (isBookDetailOpen()) return;
    if (
      e.target.closest(
        "a, button, input, textarea, select, label, summary, [role='button']",
      )
    )
      return;
    const selection = window.getSelection
      ? String(window.getSelection() || "").trim()
      : "";
    if (selection) return;
    setChromeVisible(!state.chromeVisible);
  }

  function syncResponsiveState() {
    state.lastContentScrollTop = Math.max(
      0,
      els.contentStage ? els.contentStage.scrollTop : 0,
    );
    /* Always show chrome on first load; mobile auto-hide kicks in only after scrolling */
    if (!isSidebarOpen() && !state.settingsOpen && !isBookDetailOpen()) {
      setChromeVisible(true);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     OFFLINE / SERVICE WORKER
  ───────────────────────────────────────────────────────────── */
  function initOfflineMode() {
    state.offlineSupported = supportsOfflineMode();
    updateOfflineUI();
    if (!state.offlineSupported) return;

    clearOneTimeServiceWorkerReloadFlag();
    bindServiceWorkerAutoRefresh();

    navigator.serviceWorker.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );
    navigator.serviceWorker
      .register(OFFLINE_SW_URL, { updateViaCache: "none" })
      .then((reg) => {
        state.swRegistration = reg;
        ensureLatestServiceWorker(reg);
        updateOfflineUI();
      })
      .catch((err) => {
        state.offlineError = String(err && err.message ? err.message : err);
        updateOfflineUI();
      });
  }

  function supportsOfflineMode() {
    if (!("serviceWorker" in navigator)) return false;
    if (window.isSecureContext) return true;
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1";
  }

  function ensureLatestServiceWorker(reg) {
    if (!reg) return;

    tryActivateWaitingServiceWorker(reg);
    reg.update().catch(() => { });

    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") {
          tryActivateWaitingServiceWorker(reg);
        }
      });
    });
  }

  function tryActivateWaitingServiceWorker(reg) {
    const waiting = reg && reg.waiting;
    if (!waiting) return;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  function bindServiceWorkerAutoRefresh() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasOneTimeServiceWorkerReloadFlag()) return;
      setOneTimeServiceWorkerReloadFlag();
      window.location.reload();
    });
  }

  function hasOneTimeServiceWorkerReloadFlag() {
    try {
      return sessionStorage.getItem(SW_RELOAD_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setOneTimeServiceWorkerReloadFlag() {
    try {
      sessionStorage.setItem(SW_RELOAD_KEY, "1");
    } catch (_) { }
  }

  function clearOneTimeServiceWorkerReloadFlag() {
    try {
      sessionStorage.removeItem(SW_RELOAD_KEY);
    } catch (_) { }
  }

  async function startOfflineDownload() {
    if (!state.offlineSupported || state.offlineCaching) return;

    const payload = buildOfflineDownloadList();
    if (!payload.urls.length || payload.chapterCount <= 0) {
      state.offlineError = "No chapters indexed yet.";
      updateOfflineUI();
      return;
    }

    state.offlineCaching = true;
    state.offlineReady = false;
    state.offlineError = "";
    state.offlineCachedCount = 0;
    state.offlineCachedChapterCount = 0;
    state.offlineTotalCount = payload.urls.length;
    state.offlineTargetIds = payload.targetIds;
    state.offlineTargetCount = payload.chapterCount;

    showToast(`Downloading ${payload.chapterCount} episodes…`, 0);
    updateOfflineUI();

    try {
      await postMessageToSW({ type: "CACHE_URLS", urls: payload.urls });
    } catch (err) {
      state.offlineCaching = false;
      state.offlineError = String(err && err.message ? err.message : err);
      updateOfflineUI();
      hideToast();
    }
  }

  function buildOfflineDownloadList() {
    const urls = new Set(OFFLINE_SHELL_URLS);
    const targets = getOfflineTargetEntries();
    for (const entry of targets) {
      if (entry && entry.path) urls.add(toReaderPath(entry.path));
    }
    return {
      urls: [...urls],
      chapterCount: targets.length,
      targetIds: targets.map((entry) => entry.id),
    };
  }

  function getOfflineTargetEntries() {
    if (!state.entries.length) return [];
    let start = 0;
    if (state.currentId) {
      const idx = state.entries.findIndex((e) => e.id === state.currentId);
      if (idx >= 0) start = idx;
    }
    return state.entries.slice(start, start + OFFLINE_WINDOW);
  }

  async function postMessageToSW(payload) {
    if (!state.offlineSupported) throw new Error("Offline mode not supported.");
    const reg = state.swRegistration || (await navigator.serviceWorker.ready);
    state.swRegistration = reg;
    const target = reg.active || reg.waiting || reg.installing;
    if (!target)
      throw new Error("Service worker not ready. Reload and try again.");
    target.postMessage(payload);
  }

  function handleServiceWorkerMessage(e) {
    const data = e && e.data && typeof e.data === "object" ? e.data : null;
    if (!data || typeof data.type !== "string") return;

    if (data.type === "OFFLINE_PROGRESS") {
      state.offlineCaching = true;
      state.offlineReady = false;
      state.offlineCachedCount = clamp(
        Number(data.done),
        0,
        Number.MAX_SAFE_INTEGER,
      );
      state.offlineTotalCount = clamp(
        Number(data.total),
        0,
        Number.MAX_SAFE_INTEGER,
      );
      state.offlineError = "";
      const pct =
        state.offlineTotalCount > 0
          ? Math.round(
            (state.offlineCachedCount / state.offlineTotalCount) * 100,
          )
          : 0;
      showToast(
        `Caching ${state.offlineCachedCount}/${state.offlineTotalCount} files`,
        pct,
        `${state.offlineTargetCount} episodes · ${pct}% complete`,
      );
      updateOfflineUI();
      return;
    }

    if (data.type === "OFFLINE_COMPLETE") {
      state.offlineCaching = false;
      state.offlineCachedCount = clamp(
        Number(data.cached),
        0,
        Number.MAX_SAFE_INTEGER,
      );
      state.offlineTotalCount = clamp(
        Number(data.total),
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const failedCount = clamp(Number(data.failed), 0, Number.MAX_SAFE_INTEGER);
      const targetIds = Array.isArray(state.offlineTargetIds)
        ? state.offlineTargetIds
        : [];
      const cachedUrls = Array.isArray(data.cachedUrls)
        ? new Set(data.cachedUrls)
        : null;
      const cachedChapterIds = getCachedChapterIds(targetIds, cachedUrls, failedCount);

      for (const id of cachedChapterIds) state.offlineChapters.add(id);
      saveOfflineChapters();
      state.offlineCachedChapterCount = cachedChapterIds.length;
      state.offlineTargetCount = targetIds.length;
      state.offlineReady = cachedChapterIds.length > 0;

      const allChaptersCached =
        targetIds.length > 0 &&
        cachedChapterIds.length === targetIds.length &&
        failedCount === 0;
      state.offlineError = allChaptersCached
        ? ""
        : `Cached ${cachedChapterIds.length}/${targetIds.length} episodes. ${failedCount} files failed.`;

      showToast(
        allChaptersCached ? "Download complete!" : "Download completed with errors",
        allChaptersCached ? 100 : getOfflineCompletionPercent(cachedChapterIds.length, targetIds.length),
        allChaptersCached
          ? `${cachedChapterIds.length} episodes cached`
          : state.offlineError,
      );
      window.setTimeout(hideToast, 3000);

      updateOfflineUI();
      renderChapterList(); /* re-render to show offline indicators */
      return;
    }

    if (data.type === "OFFLINE_ERROR") {
      state.offlineCaching = false;
      state.offlineReady = false;
      state.offlineError =
        asNonEmpty(data.message) || "Offline caching failed.";
      updateOfflineUI();
      hideToast();
    }
  }

  function getCachedChapterIds(targetIds, cachedUrls, failedCount) {
    if (!Array.isArray(targetIds) || !targetIds.length) return [];
    if (!cachedUrls) return failedCount > 0 ? [] : targetIds.slice();

    return targetIds.filter((id) => {
      const entry = state.entriesById.get(id);
      if (!entry || !entry.path) return false;
      return cachedUrls.has(toAbsoluteUrl(toReaderPath(entry.path)));
    });
  }

  function getOfflineCompletionPercent(done, total) {
    const max = Math.max(0, Number(total) || 0);
    if (!max) return 0;
    return Math.round((Math.max(0, Number(done) || 0) / max) * 100);
  }

  function updateOfflineUI() {
    if (!els.offlineCacheBtn || !els.offlineStatus) return;

    if (!state.offlineSupported) {
      els.offlineCacheBtn.disabled = true;
      els.offlineCacheBtn.textContent = "Offline unavailable";
      els.offlineStatus.textContent = "Needs HTTPS or localhost.";
      return;
    }

    if (state.offlineError) {
      els.offlineCacheBtn.disabled = false;
      els.offlineCacheBtn.textContent = "Retry offline download";
      els.offlineStatus.textContent = state.offlineError;
      return;
    }

    if (state.offlineCaching) {
      const done = Math.max(0, state.offlineCachedCount);
      const total = Math.max(done, state.offlineTotalCount);
      els.offlineCacheBtn.disabled = true;
      els.offlineCacheBtn.textContent = "Downloading…";
      els.offlineStatus.textContent =
        total > 0 ? `Caching ${done}/${total} files` : "Preparing…";
      return;
    }

    if (state.offlineReady) {
      els.offlineCacheBtn.disabled = false;
      els.offlineCacheBtn.textContent = "Refresh offline cache";
      els.offlineStatus.textContent =
        `${state.offlineTargetCount} episodes cached` +
        (navigator.onLine ? "" : " (offline)");
      return;
    }

    els.offlineCacheBtn.disabled = !state.entries.length;
    els.offlineCacheBtn.textContent = "Download next 100 episodes";
    els.offlineStatus.textContent = state.entries.length
      ? "Cache current + next 99 episodes for offline reading."
      : "Load chapter index first.";
  }

  /* ─────────────────────────────────────────────────────────────
     TOAST (download progress)
  ───────────────────────────────────────────────────────────── */
  function showToast(label, percent, detail) {
    if (!els.dlToast) return;
    els.dlToast.hidden = false;
    els.dlToastLabel.textContent = label || "";
    els.dlToastDetail.textContent = detail || "";
    els.dlToastBar.style.width = `${clamp(Number(percent) || 0, 0, 100)}%`;
  }

  function hideToast() {
    if (!els.dlToast) return;
    els.dlToast.hidden = true;
  }

  /* ─────────────────────────────────────────────────────────────
     MANIFEST LOADING
  ───────────────────────────────────────────────────────────── */
  async function loadManifest() {
    try {
      const res = await fetch("./manifest.json", { cache: "default" });
      if (!res.ok) throw new Error(`Unable to load manifest (${res.status})`);

      const payload = await res.json();
      const rawEntries = extractManifestEntries(payload);
      if (!rawEntries) {
        throw new Error("Chapter index format is invalid. Regenerate manifest.");
      }

      state.entries = normalizeEntries(rawEntries);
      if (!state.entries.length && rawEntries.length > 0) {
        throw new Error("Chapter index entries are invalid. Regenerate manifest.");
      }
      state.entriesById = new Map(state.entries.map((e) => [e.id, e]));
      state.entriesBySource = buildEntriesBySource(state.entries);

      normalizeSourceSetting();
      renderSourceFilter();
      renderChapterList();
      updateOfflineUI();
      updateStats();

      if (!state.entries.length) {
        if (els.chapterInfo)
          els.chapterInfo.textContent = "No markdown files indexed.";
        return;
      }

      const lastChapter =
        getStorageItem(LAST_CHAPTER_KEY) || getStorageItem(LEGACY_LAST_KEY);
      const defaultFirst = state.entries[0].id;
      const initial = state.entriesById.has(lastChapter)
        ? lastChapter
        : defaultFirst;

      if (initial)
        await openChapter(initial, {
          closeSidebarOnMobile: false,
          useSavedPosition: true,
        });
    } catch (err) {
      if (els.libraryMeta)
        els.libraryMeta.textContent = "Failed to load chapter index";
      if (els.chapterInfo)
        els.chapterInfo.textContent = String(err.message || err);
      renderChapterContent(
        '<p class="empty-state">Run <code>python3 reader/generate_manifest.py</code> then reload.</p>',
        { useSavedPosition: false },
      );
    }
  }

  /* ─────────────────────────────────────────────────────────────
     ENTRY NORMALIZATION
  ───────────────────────────────────────────────────────────── */
  function extractManifestEntries(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return null;
    if (Array.isArray(payload.entries)) return payload.entries;
    if (Array.isArray(payload.chapters)) return payload.chapters;
    if (Array.isArray(payload.items)) return payload.items;
    return null;
  }
  function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const id =
        asNonEmpty(entry.id) ||
        asNonEmpty(entry.path) ||
        asNonEmpty(entry.file);
      const path =
        asNonEmpty(entry.path) ||
        asNonEmpty(entry.file) ||
        asNonEmpty(entry.url) ||
        id;
      if (!id || !path) continue;

      const sourceLabel =
        asNonEmpty(entry.sourceLabel) || asNonEmpty(entry.source) || "Library";
      const group = asNonEmpty(entry.group) || asNonEmpty(entry.folder) || "";
      const title =
        asNonEmpty(entry.title) || asNonEmpty(entry.name) || titleFromPath(path);

      result.push({
        id,
        path,
        sourceLabel,
        group,
        title,
        groupLabel: `${sourceLabel} / ${group || "root"}`,
        searchText: `${title} ${path} ${group}`.toLowerCase(),
      });
    }
    return result;
  }

  function buildEntriesBySource(entries) {
    const map = new Map();
    for (const entry of entries) {
      const list = map.get(entry.sourceLabel);
      if (list) list.push(entry);
      else map.set(entry.sourceLabel, [entry]);
    }
    return map;
  }

  function titleFromPath(path) {
    const stem = path.split("/").pop() || path;
    return stem.replace(/\.md$/i, "").replace(/[_-]+/g, " ").trim() || path;
  }

  function asNonEmpty(v) {
    if (typeof v !== "string") return "";
    return v.trim();
  }

  /* ─────────────────────────────────────────────────────────────
     SOURCE FILTER
  ───────────────────────────────────────────────────────────── */
  function normalizeSourceSetting() {
    const sources = new Set(state.entries.map((e) => e.sourceLabel));
    const s = state.settings.source;
    if (s === FILTER_BOOKMARK && state.bookmarks.size === 0) {
      state.settings.source = FILTER_ALL;
      saveSettings();
      return;
    }
    if (s === FILTER_OFFLINE && state.offlineChapters.size === 0) {
      state.settings.source = FILTER_ALL;
      saveSettings();
      return;
    }
    if (
      s !== FILTER_ALL &&
      s !== FILTER_BOOKMARK &&
      s !== FILTER_OFFLINE &&
      !sources.has(s)
    ) {
      state.settings.source = FILTER_ALL;
      saveSettings();
    }
  }

  function renderSourceFilter() {
    const sources = [...new Set(state.entries.map((e) => e.sourceLabel))];
    const current = state.settings.source;
    const fragment = document.createDocumentFragment();

    /* All */
    fragment.appendChild(
      buildFilterChip(
        "All",
        FILTER_ALL,
        current === FILTER_ALL,
        bookIcon(false),
      ),
    );

    /* Per-source */
    for (const src of sources) {
      fragment.appendChild(buildFilterChip(src, src, current === src));
    }

    /* Bookmarks */
    fragment.appendChild(
      buildFilterChip(
        "Bookmarks",
        FILTER_BOOKMARK,
        current === FILTER_BOOKMARK,
        bookmarkIcon(),
      ),
    );

    /* Available Offline */
    fragment.appendChild(
      buildFilterChip(
        "Offline",
        FILTER_OFFLINE,
        current === FILTER_OFFLINE,
        offlineIcon(),
      ),
    );

    els.sourceFilter.replaceChildren(fragment);
  }

  function buildFilterChip(label, value, active, iconEl) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-chip${active ? " active" : ""}`;
    btn.setAttribute("aria-pressed", active ? "true" : "false");

    if (iconEl) {
      if (typeof iconEl.setAttribute === "function") {
        iconEl.setAttribute("class", "filter-chip-icon");
      } else {
        iconEl.className = "filter-chip-icon";
      }
      btn.appendChild(iconEl);
    }

    btn.appendChild(document.createTextNode(label));

    btn.addEventListener("click", () => {
      state.settings.source = value;
      saveSettings();
      renderSourceFilter();
      renderChapterList();
    });
    return btn;
  }

  /* Small SVG factories for filter chips */
  function bookmarkIcon() {
    const svg = svgEl("0 0 24 24");
    svg.innerHTML =
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    return svg;
  }
  function offlineIcon() {
    const svg = svgEl("0 0 24 24");
    svg.innerHTML =
      '<path d="M12 3v13M5 14l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    return svg;
  }
  function bookIcon() {
    const svg = svgEl("0 0 24 24");
    svg.innerHTML =
      '<rect x="3" y="4" width="18" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="13" width="18" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>';
    return svg;
  }
  function svgEl(viewBox) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  /* ─────────────────────────────────────────────────────────────
     CHAPTER LIST RENDERING
  ───────────────────────────────────────────────────────────── */
  function scheduleChapterListRender() {
    if (state.searchRenderTimer) clearTimeout(state.searchRenderTimer);
    state.searchRenderTimer = window.setTimeout(() => {
      state.searchRenderTimer = null;
      renderChapterList();
    }, SEARCH_DEBOUNCE_MS);
  }

  function resetChapterRenderLimit(filtered) {
    if (!filtered.length) {
      state.chapterRenderLimit = 0;
      return;
    }
    state.chapterRenderLimit = Math.min(
      filtered.length,
      CHAPTER_LIST_BATCH_SIZE,
    );
  }

  function extendChapterRenderLimit() {
    if (state.chapterRenderLimit >= state.filteredEntries.length) return false;
    state.chapterRenderLimit = Math.min(
      state.filteredEntries.length,
      state.chapterRenderLimit + CHAPTER_LIST_BATCH_SIZE,
    );
    renderChapterList();
    return true;
  }

  function renderChapterList() {
    if (state.searchRenderTimer) {
      clearTimeout(state.searchRenderTimer);
      state.searchRenderTimer = null;
    }

    const query = els.searchInput.value.trim().toLowerCase();
    const filter = state.settings.source;
    const renderKey = `${filter}\u0000${query}`;
    const renderKeyChanged = renderKey !== state.chapterRenderKey;
    const previousScrollTop = els.chapterList.scrollTop;

    /* Resolve base entries for the current source filter */
    let baseEntries;
    if (filter === FILTER_ALL) {
      baseEntries = state.entries;
    } else if (filter === FILTER_BOOKMARK) {
      baseEntries = state.entries.filter((e) => state.bookmarks.has(e.id));
    } else if (filter === FILTER_OFFLINE) {
      baseEntries = state.entries.filter((e) =>
        state.offlineChapters.has(e.id),
      );
    } else {
      baseEntries = state.entriesBySource.get(filter) || [];
    }

    const filtered = query
      ? baseEntries.filter((e) => e.searchText.includes(query))
      : baseEntries;
    state.filteredEntries = filtered;
    state.chapterRenderKey = renderKey;

    if (renderKeyChanged) {
      resetChapterRenderLimit(filtered);
    } else if (!filtered.length) {
      state.chapterRenderLimit = 0;
    } else if (state.chapterRenderLimit <= 0) {
      resetChapterRenderLimit(filtered);
    } else {
      state.chapterRenderLimit = Math.min(
        state.chapterRenderLimit,
        filtered.length,
      );
    }

    const visibleEntries = filtered.slice(0, state.chapterRenderLimit);

    const fragment = document.createDocumentFragment();
    const chapterButtonById = new Map();
    state.activeChapterButtonId = null;

    if (!filtered.length) {
      const empty = document.createElement("li");
      empty.className = "chapter-group-header";
      empty.textContent =
        filter === FILTER_BOOKMARK
          ? "No bookmarks yet — tap the bookmark button while reading."
          : filter === FILTER_OFFLINE
            ? "No chapters cached offline yet."
            : "No chapters match this search.";
      fragment.appendChild(empty);
      els.chapterList.replaceChildren(fragment);
      state.chapterButtonById = chapterButtonById;
      updateLibraryMeta();
      updateNavButtons();
      return;
    }

    let lastGroupKey = "";
    for (const entry of visibleEntries) {
      const groupKey = entry.groupLabel;

      if (groupKey !== lastGroupKey) {
        const groupLi = document.createElement("li");
        const groupHead = document.createElement("div");
        groupHead.className = "chapter-group-header";
        groupHead.textContent = groupKey;
        groupLi.appendChild(groupHead);
        fragment.appendChild(groupLi);
        lastGroupKey = groupKey;
      }

      const rowLi = document.createElement("li");
      rowLi.className = "chapter-row";

      const btn = document.createElement("button");
      const isActive = entry.id === state.currentId;
      btn.type = "button";
      btn.className = `chapter-item${isActive ? " active" : ""}`;
      btn.dataset.chapterId = entry.id;
      if (isActive) btn.setAttribute("aria-current", "page");
      if (isActive) state.activeChapterButtonId = entry.id;

      /* Header row: title + badges */
      const header = document.createElement("div");
      header.className = "chapter-item-header";

      const titleDiv = document.createElement("div");
      titleDiv.className = "chapter-title";
      titleDiv.textContent = entry.title;

      const badges = document.createElement("div");
      badges.className = "chapter-badges";

      /* Bookmark dot */
      if (state.bookmarks.has(entry.id)) {
        const dot = document.createElement("span");
        dot.className = "bookmark-dot";
        dot.title = "Bookmarked";
        badges.appendChild(dot);
      }

      /* Offline dot */
      if (state.offlineChapters.has(entry.id)) {
        const dot = document.createElement("span");
        dot.className = "offline-dot";
        dot.title = "Available offline";
        badges.appendChild(dot);
      }

      /* Read status dot */
      const status = getReadStatus(entry.id);
      const statusDot = document.createElement("span");
      statusDot.className = `status-dot ${status}`;
      statusDot.title = statusLabel(status);
      badges.appendChild(statusDot);

      header.appendChild(titleDiv);
      header.appendChild(badges);

      /* Path (clean breadcrumb) */
      const pathDiv = document.createElement("div");
      pathDiv.className = "chapter-path";
      pathDiv.textContent = entry.group
        ? `${entry.sourceLabel} \u2022 ${entry.group}`
        : entry.sourceLabel;

      /* Progress strip */
      const strip = document.createElement("div");
      strip.className = "chapter-progress-strip";
      const fill = document.createElement("div");
      fill.className = "chapter-progress-fill";
      fill.style.width = `${getProgressPercent(entry.id)}%`;
      strip.appendChild(fill);

      btn.appendChild(header);
      btn.appendChild(pathDiv);
      btn.appendChild(strip);

      rowLi.appendChild(btn);
      fragment.appendChild(rowLi);
      chapterButtonById.set(entry.id, btn);
    }

    if (visibleEntries.length < filtered.length) {
      const loadMoreRow = document.createElement("li");
      loadMoreRow.className = "chapter-row chapter-row-load-more";

      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.type = "button";
      loadMoreBtn.className = "icon-btn chapter-load-more-btn";
      loadMoreBtn.dataset.action = "load-more";
      loadMoreBtn.textContent =
        `Show more chapters (${visibleEntries.length.toLocaleString()} / ` +
        `${filtered.length.toLocaleString()})`;

      loadMoreRow.appendChild(loadMoreBtn);
      fragment.appendChild(loadMoreRow);
    }

    state.chapterButtonById = chapterButtonById;
    els.chapterList.replaceChildren(fragment);
    if (!renderKeyChanged) {
      els.chapterList.scrollTop = previousScrollTop;
    }
    updateLibraryMeta();
    updateNavButtons();
  }

  function handleChapterListScroll() {
    if (!els.chapterList) return;
    if (state.chapterRenderLimit >= state.filteredEntries.length) return;

    const remaining =
      els.chapterList.scrollHeight -
      els.chapterList.scrollTop -
      els.chapterList.clientHeight;
    if (remaining <= CHAPTER_LIST_SCROLL_THRESHOLD) {
      extendChapterRenderLimit();
    }
  }

  function getProgressPercent(chapterId) {
    const snap = state.progress[chapterId];
    if (!snap) return 0;
    /* We store scroll position; use a rough 0-100 mapping based on ratio if available */
    if (snap && typeof snap === "object" && typeof snap.ratio === "number") {
      return clamp(Math.round(snap.ratio * 100), 0, 100);
    }
    /* Can't know max scroll without rendering; return 0 or a stored percent */
    if (snap && typeof snap === "object" && typeof snap.percent === "number") {
      return clamp(Math.round(snap.percent), 0, 100);
    }
    return 0;
  }

  function getReadStatus(chapterId) {
    const pct = getProgressPercent(chapterId);
    if (pct >= 90) return "completed";
    if (pct > 2) return "in-progress";
    return "unread";
  }

  function statusLabel(status) {
    if (status === "completed") return "Completed";
    if (status === "in-progress") return "In progress";
    return "Unread";
  }

  function updateLibraryMeta() {
    const total = state.entries.length;
    const visible = state.filteredEntries.length;
    if (!total) {
      els.libraryMeta.textContent = "No chapters indexed";
      return;
    }
    if (visible === total) {
      els.libraryMeta.textContent = `${total.toLocaleString()} chapters`;
    } else {
      els.libraryMeta.textContent = `${visible.toLocaleString()} of ${total.toLocaleString()} chapters`;
    }
  }

  function setActiveChapterInList(chapterId) {
    if (
      state.activeChapterButtonId &&
      state.activeChapterButtonId !== chapterId
    ) {
      const prev = state.chapterButtonById.get(state.activeChapterButtonId);
      if (prev) {
        prev.classList.remove("active");
        prev.removeAttribute("aria-current");
      }
    }
    const next = state.chapterButtonById.get(chapterId);
    if (!next) {
      state.activeChapterButtonId = null;
      return;
    }
    next.classList.add("active");
    next.setAttribute("aria-current", "page");
    state.activeChapterButtonId = chapterId;
  }

  /* ─────────────────────────────────────────────────────────────
     CHAPTER LIST INTERACTIONS
  ───────────────────────────────────────────────────────────── */
  function handleChapterListClick(e) {
    if (Date.now() < state.ignoreNextChapterClickUntil) {
      e.preventDefault();
      closeBookDetailSheet();
      return;
    }
    const target = e.target;
    if (!(target instanceof Element)) return;
    const loadMoreBtn = target.closest("button[data-action='load-more']");
    if (loadMoreBtn) {
      extendChapterRenderLimit();
      return;
    }
    const btn = target.closest("button.chapter-item[data-chapter-id]");
    if (!btn) return;
    const id = btn.dataset.chapterId;
    if (!id) return;
    openChapter(id, { closeSidebarOnMobile: true });
  }

  /* ─────────────────────────────────────────────────────────────
     OPEN CHAPTER
  ───────────────────────────────────────────────────────────── */
  async function openChapter(chapterId, options = {}) {
    if (isBookDetailOpen()) closeBookDetailSheet();
    stopAutoScroll();
    state.autoScrollFallbackTop = 0;
    clearAutoScrollFallback();

    const entry = state.entriesById.get(chapterId);
    if (!entry) return;

    const closeMobile = Boolean(options.closeSidebarOnMobile);
    const useSavedPos = options.useSavedPosition !== false;

    persistCurrentProgress();
    flushProgressSave();

    state.currentId = chapterId;
    setStorageItem(LAST_CHAPTER_KEY, chapterId);

    setActiveChapterInList(chapterId);
    scrollActiveChapterIntoView();
    setChapterMeta(entry, "Loading…");
    animateReaderTransition();
    setChapterLoading(true);
    els.content.innerHTML = '<p class="empty-state">Loading chapter…</p>';

    updateBookmarkButton(chapterId);

    if (state.activeFetchController) state.activeFetchController.abort();

    const requestId = ++state.requestSequence;
    const controller = new AbortController();
    state.activeFetchController = controller;

    try {
      const chapterUrl = toReaderPath(entry.path);
      let res = null;
      let markdown = null;

      try {
        res = await fetch(chapterUrl, {
          cache: "default",
          signal: controller.signal,
        });
      } catch (networkErr) {
        if (networkErr && networkErr.name === "AbortError") throw networkErr;
        /* Network failed — fall through to cache lookup */
        res = null;
      }

      if (res && res.ok) {
        markdown = await res.text();
      } else {
        /* Try the Cache Storage directly.
           Chapters live outside the service-worker scope on GitHub Pages,
           so the SW can't intercept their fetches, but cacheUrls() did
           store them. Resolve them here so offline mode actually works. */
        const cachedText = await readCachedMarkdown(chapterUrl);
        if (cachedText !== null) {
          markdown = cachedText;
        } else if (res) {
          throw new Error(`Could not open ${entry.path} (${res.status})`);
        } else {
          throw new Error(
            navigator.onLine
              ? `Could not open ${entry.path}`
              : `Offline and this chapter isn't cached yet.`,
          );
        }
      }

      if (!isActiveRequest(requestId, chapterId)) return;

      const html = renderMarkdownToSafeHtml(markdown, entry.path);
      renderChapterContent(html, {
        useSavedPosition: useSavedPos,
        sourceLabel: entry.sourceLabel,
      });
      setChapterMeta(entry, "");
      updateChapterMetaBadges(chapterId);

      if (closeMobile) setSidebarOpen(false);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (!isActiveRequest(requestId, chapterId)) return;
      const msg = String(err.message || err);
      setChapterMeta(entry, "");
      const safeMsg = escapeHtml(msg);
      const retryId = `retry-${Date.now()}`;
      renderChapterContent(
        `<div class="error-card">
        <p class="error-card-title">Failed to load chapter</p>
        <p class="error-card-detail">${safeMsg}</p>
        <button class="error-retry-btn" id="${retryId}" type="button">Retry</button>
      </div>`,
        { useSavedPosition: false },
      );
      /* Bind retry */
      const retryBtn = document.getElementById(retryId);
      if (retryBtn) retryBtn.addEventListener("click", () => openChapter(chapterId, options));
    } finally {
      if (requestId === state.requestSequence) {
        state.activeFetchController = null;
        setChapterLoading(false);
      }
    }
  }

  function isActiveRequest(requestId, chapterId) {
    return requestId === state.requestSequence && chapterId === state.currentId;
  }

  function scrollActiveChapterIntoView() {
    requestAnimationFrame(() => {
      const active = els.chapterList.querySelector(".chapter-item.active");
      if (active)
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     CHAPTER CONTENT RENDERING
  ───────────────────────────────────────────────────────────── */
  function renderChapterContent(html, options = {}) {
    const useSavedPosition = Boolean(options.useSavedPosition);
    const output =
      html ||
      '<p class="empty-state">Pick any markdown file to start reading.</p>';

    els.content.classList.remove("reader-transition-enter");
    void els.content.offsetWidth;
    els.content.classList.add("reader-transition-enter");
    els.content.innerHTML = output;
    applyContentLang(options.sourceLabel);

    requestAnimationFrame(() => {
      applyProgressGlow(0);
      if (
        useSavedPosition &&
        state.currentId &&
        restoreChapterProgress(state.currentId)
      ) {
        scheduleScrollToTopButtonUpdate(els.contentStage.scrollTop);
        updateReadProgressFromScroll();
        applyProgressGlow(state.readProgress / 100);
        return;
      }
      els.contentStage.scrollTop = 0;
      if (state.currentId) {
        setChapterProgress(state.currentId, 0, 0, 0);
        scheduleProgressSave();
      }
      updateReadProgressFromScroll();
      scheduleScrollToTopButtonUpdate(0);
    });
  }

  function renderMarkdownToSafeHtml(markdown, chapterPath) {
    let rendered;
    try {
      if (window.marked && typeof window.marked.parse === "function") {
        rendered = window.marked.parse(markdown, {
          mangle: false,
          headerIds: true,
        });
      } else {
        rendered = `<pre>${escapeHtml(markdown)}</pre>`;
      }
    } catch (_) {
      rendered = `<pre>${escapeHtml(markdown)}</pre>`;
    }

    const sanitized = sanitizeHtml(rendered);
    return rewriteChapterLinks(sanitized, chapterPath);
  }

  function sanitizeHtml(html) {
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
      return window.DOMPurify.sanitize(html);
    }
    return html;
  }

  function rewriteChapterLinks(html, chapterPath) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;

    const targets = [
      { selector: "a[href]", attribute: "href" },
      { selector: "img[src]", attribute: "src" },
      { selector: "source[src]", attribute: "src" },
      { selector: "video[src]", attribute: "src" },
      { selector: "audio[src]", attribute: "src" },
    ];

    for (const { selector, attribute } of targets) {
      for (const el of tpl.content.querySelectorAll(selector)) {
        const raw = el.getAttribute(attribute);
        const resolved = resolveRelativeAssetUrl(chapterPath, raw);
        if (!resolved) continue;
        el.setAttribute(attribute, resolved.href);
        if (el.tagName === "A" && resolved.chapterId) {
          el.dataset.chapterId = resolved.chapterId;
        }
      }
    }

    /* Harden any anchor that still points to an absolute URL (external link)
       so the new tab can't hijack the opener. */
    for (const a of tpl.content.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) && !a.dataset.chapterId) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    }

    return tpl.innerHTML;
  }

  function applyContentLang(sourceLabel) {
    if (!els.content) return;
    const lang =
      sourceLabel === "Burmese" ? "my" : sourceLabel === "English" ? "en" : "";
    if (lang) els.content.setAttribute("lang", lang);
    else els.content.removeAttribute("lang");
  }

  function resolveRelativeAssetUrl(chapterPath, rawValue) {
    if (typeof rawValue !== "string") return null;
    const value = rawValue.trim();
    if (!value || value.startsWith("#")) return null;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return null;
    if (value.startsWith("/")) return null;

    const resolved = resolveRelativePath(chapterPath, value);
    if (!resolved || !resolved.path) return null;

    const href = `${toReaderPath(resolved.path)}${resolved.suffix}`;
    const isMarkdown = /\.md$/i.test(resolved.path);
    const chapterId =
      isMarkdown && state.entriesById.has(resolved.path) ? resolved.path : null;

    return { href, chapterId };
  }

  function resolveRelativePath(baseFilePath, relativePath) {
    try {
      const parts = baseFilePath.split("/");
      parts.pop();
      const baseDir = parts.join("/");
      const baseUrl = new URL(
        `https://reader.local/${baseDir ? `${baseDir}/` : ""}`,
      );
      const resUrl = new URL(relativePath, baseUrl);
      const normPath = resUrl.pathname
        .replace(/^\/+/, "")
        .split("/")
        .map((s) => {
          try {
            return decodeURIComponent(s);
          } catch (_) {
            return s;
          }
        })
        .join("/");
      return { path: normPath, suffix: `${resUrl.search}${resUrl.hash}` };
    } catch (_) {
      return null;
    }
  }

  function handleContentLinkClick(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[data-chapter-id]");
    if (!anchor) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = anchor.dataset.chapterId;
    if (!id) return;
    e.preventDefault();
    openChapter(id, { closeSidebarOnMobile: true });
  }

  /* ─────────────────────────────────────────────────────────────
     CHAPTER META / HEADER
  ───────────────────────────────────────────────────────────── */
  function setChapterMeta(entry, detail) {
    els.chapterTitle.textContent = entry ? entry.title : "Select a chapter";
    if (els.chapterInfo) els.chapterInfo.textContent = detail || "";
  }

  function setChapterLoading(loading) {
    state.isLoadingChapter = Boolean(loading);
    updateNavButtons();
    updateAutoScrollUI();
  }

  function updateChapterMetaBadges(chapterId) {
    if (!els.chapterMetaBadges) return;
    const status = getReadStatus(chapterId);
    const isBookmarked = state.bookmarks.has(chapterId);

    els.chapterMetaBadges.innerHTML = "";

    if (isBookmarked) {
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.style.color = "var(--bookmark-active)";
      badge.style.borderColor = "var(--bookmark-active)";
      badge.style.background =
        "color-mix(in srgb, var(--bookmark-active) 12%, transparent)";
      badge.textContent = "Bookmarked";
      els.chapterMetaBadges.appendChild(badge);
    }

    if (status !== "unread") {
      const badge = document.createElement("span");
      badge.className = `status-badge ${status}`;
      badge.textContent = statusLabel(status);
      els.chapterMetaBadges.appendChild(badge);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     NAVIGATION
  ───────────────────────────────────────────────────────────── */
  function moveToSibling(direction) {
    if (!state.currentId) return;
    const navEntries = getNavigationEntries();
    if (!navEntries.length) return;
    const idx = navEntries.findIndex((e) => e.id === state.currentId);
    if (idx < 0) return;
    const next = navEntries[idx + direction];
    if (next) openChapter(next.id, { closeSidebarOnMobile: false });
  }

  function getNavigationEntries() {
    const filter = state.settings.source;
    if (filter === FILTER_ALL) return state.entries;
    if (filter === FILTER_BOOKMARK)
      return state.entries.filter((e) => state.bookmarks.has(e.id));
    if (filter === FILTER_OFFLINE)
      return state.entries.filter((e) => state.offlineChapters.has(e.id));
    return state.entriesBySource.get(filter) || state.entries;
  }

  function updateNavButtons() {
    const disabled = !state.currentId || state.isLoadingChapter;
    if (disabled) {
      [els.prevBtn, els.nextBtn, els.navPrevBtn, els.navNextBtn].forEach(
        (b) => {
          if (b) b.disabled = true;
        },
      );
      return;
    }

    const navEntries = getNavigationEntries();
    const idx = navEntries.findIndex((e) => e.id === state.currentId);

    const prevDisabled = idx <= 0;
    const nextDisabled = idx < 0 || idx >= navEntries.length - 1;

    [els.prevBtn, els.navPrevBtn].forEach((b) => {
      if (b) b.disabled = prevDisabled;
    });
    [els.nextBtn, els.navNextBtn].forEach((b) => {
      if (b) b.disabled = nextDisabled;
    });
  }

  /* ─────────────────────────────────────────────────────────────
     BOOKMARKS
  ───────────────────────────────────────────────────────────── */
  function loadBookmarks() {
    try {
      const raw = getStorageItem(BOOKMARKS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveBookmarks() {
    setStorageItem(BOOKMARKS_KEY, JSON.stringify([...state.bookmarks]));
  }

  function toggleBookmarkForCurrent() {
    if (!state.currentId) return;
    toggleBookmark(state.currentId);
    updateBookmarkButton(state.currentId);
    updateChapterMetaBadges(state.currentId);
    /* Update the list row if visible */
    const btn = state.chapterButtonById.get(state.currentId);
    if (btn) refreshChapterItemBadges(state.currentId, btn);
    updateStats();
  }

  function toggleBookmark(chapterId) {
    if (state.bookmarks.has(chapterId)) {
      state.bookmarks.delete(chapterId);
    } else {
      state.bookmarks.add(chapterId);
    }
    saveBookmarks();

    /* If current filter is Bookmarks, re-render the list */
    if (state.settings.source === FILTER_BOOKMARK) renderChapterList();
  }

  function updateBookmarkButton(chapterId) {
    const isBookmarked = state.bookmarks.has(chapterId);
    [els.bookmarkBtn, els.navBookmarkBtn].forEach((btn) => {
      if (!btn) return;
      btn.setAttribute("aria-pressed", isBookmarked ? "true" : "false");
      btn.title = isBookmarked ? "Remove bookmark" : "Bookmark this chapter";
      btn.setAttribute("aria-label", btn.title);
    });
  }

  function updateDetailBookmarkBtn(chapterId) {
    if (!els.detailBookmarkBtn) return;
    const isBookmarked = state.bookmarks.has(chapterId);
    els.detailBookmarkBtn.setAttribute(
      "aria-pressed",
      isBookmarked ? "true" : "false",
    );
    els.detailBookmarkBtn.textContent = isBookmarked
      ? "Remove bookmark"
      : "Bookmark";
  }

  function refreshChapterItemBadges(chapterId, btn) {
    /* Remove & re-add badge container */
    const oldBadges = btn.querySelector(".chapter-badges");
    if (oldBadges) oldBadges.remove();

    const badges = document.createElement("div");
    badges.className = "chapter-badges";

    if (state.bookmarks.has(chapterId)) {
      const d = document.createElement("span");
      d.className = "bookmark-dot";
      d.title = "Bookmarked";
      badges.appendChild(d);
    }
    if (state.offlineChapters.has(chapterId)) {
      const d = document.createElement("span");
      d.className = "offline-dot";
      d.title = "Available offline";
      badges.appendChild(d);
    }
    const status = getReadStatus(chapterId);
    const d = document.createElement("span");
    d.className = `status-dot ${status}`;
    d.title = statusLabel(status);
    badges.appendChild(d);

    const header = btn.querySelector(".chapter-item-header");
    if (header) header.appendChild(badges);
  }

  /* ─────────────────────────────────────────────────────────────
     READING STATS
  ───────────────────────────────────────────────────────────── */
  function updateStats() {
    if (!els.statCompletedNum || !els.statInProgressNum || !els.statTotalNum)
      return;

    const total = state.entries.length;
    let completed = 0;
    let inProgress = 0;

    for (const entry of state.entries) {
      const s = getReadStatus(entry.id);
      if (s === "completed") completed++;
      if (s === "in-progress") inProgress++;
    }

    els.statCompletedNum.textContent = completed.toLocaleString();
    els.statInProgressNum.textContent = inProgress.toLocaleString();
    els.statTotalNum.textContent = total.toLocaleString();
  }

  /* ─────────────────────────────────────────────────────────────
     SETTINGS: HYDRATE & APPLY
  ───────────────────────────────────────────────────────────── */
  function hydrateSettingsControls() {
    const s = sanitizeSettings(state.settings);
    state.settings = s;

    els.themeSelect.value = s.theme;
    els.fontSizeRange.value = String(s.fontSize);
    els.lineHeightRange.value = String(s.lineHeight);
    els.widthRange.value = String(s.width);
    if (els.autoScrollSpeedRange) {
      els.autoScrollSpeedRange.value = String(s.autoScrollSpeed);
    }
  }

  function applyVisualSettings() {
    applyTheme();
    applyTypography();
    applyAutoScrollSettings();
  }

  /* ─────────────────────────────────────────────────────────────
     THEMES
  ───────────────────────────────────────────────────────────── */
  function applyTheme() {
    const theme = state.settings.theme;
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute("data-theme", resolved);
    updateThemeColor(resolved);
    updateReaderSurface(resolved);
  }

  function resolveTheme(theme) {
    return VALID_THEMES.has(theme) ? theme : defaultSettings.theme;
  }

  function updateThemeColor(resolved) {
    const themeColors = {
      light: "#f4f4ef",
      eink: "#f4f4ef",
      "eink-warm": "#f3efe4",
      "eink-contrast": "#ffffff",
      "eink-night": "#12130f",
      dark: "#12130f",
      sepia: "#f3efe4",
    };
    const color = themeColors[resolved] || themeColors.eink;
    if (els.themeColorMeta) els.themeColorMeta.content = color;
    try {
      const existing = document.querySelector(
        'meta[name="theme-color"]:not(#themeColorMeta)',
      );
      if (existing) existing.remove();
    } catch (_) { }
  }

  function updateReaderSurface(resolved) {
    const root = document.documentElement;
    const isDark = resolved === "dark" || resolved === "eink-night";

    /* Reset to CSS defaults first — only override inline if needed */
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--accent-a");
    root.style.removeProperty("--accent-b");
    root.style.removeProperty("--accent-c");
    root.style.removeProperty("--neon");

    if (els.ambientGlow) {
      if (isDark) {
        els.ambientGlow.style.background =
          "linear-gradient(90deg, color-mix(in srgb, var(--text) 5%, transparent), transparent 22%, transparent 78%, color-mix(in srgb, var(--text) 5%, transparent))";
        els.ambientGlow.style.opacity = "0.2";
      } else {
        els.ambientGlow.style.background =
          "linear-gradient(90deg, color-mix(in srgb, var(--text) 3%, transparent), transparent 22%, transparent 78%, color-mix(in srgb, var(--text) 3%, transparent))";
        els.ambientGlow.style.opacity = "0.28";
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────
     TYPOGRAPHY
  ───────────────────────────────────────────────────────────── */
  function normalizeFontSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return FONT_SIZE_MIN;
    const stepped = Math.round(n / FONT_SIZE_STEP) * FONT_SIZE_STEP;
    return clamp(stepped, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  function setFontSize(value) {
    state.settings.fontSize = normalizeFontSize(value);
    applyTypography();
    saveSettings();
  }

  function applyTypography() {
    const fontSize = normalizeFontSize(state.settings.fontSize);
    const lineHeight = clamp(Number(state.settings.lineHeight), 1.35, 2.2);
    const width = clamp(Number(state.settings.width), 560, 1080);

    state.settings.fontSize = fontSize;

    const root = document.documentElement;
    root.style.setProperty("--reader-font-size", `${fontSize}px`);
    root.style.setProperty("--reader-line-height", `${lineHeight}`);
    root.style.setProperty("--reader-width", `${width}px`);

    els.fontSizeRange.value = String(fontSize);
    els.fontSizeValue.textContent = `${fontSize}px`;
    els.lineHeightValue.textContent = lineHeight.toFixed(2);
    els.widthValue.textContent = `${width}px`;

    updateFontSizeButtons(fontSize);
  }

  function updateFontSizeButtons(fontSize) {
    if (els.decreaseFontSizeBtn)
      els.decreaseFontSizeBtn.disabled = fontSize <= FONT_SIZE_MIN;
    if (els.increaseFontSizeBtn)
      els.increaseFontSizeBtn.disabled = fontSize >= FONT_SIZE_MAX;
  }

  function normalizeAutoScrollSpeed(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return AUTO_SCROLL_SPEED_DEFAULT;
    return clamp(
      Math.round(n / 4) * 4,
      AUTO_SCROLL_SPEED_MIN,
      AUTO_SCROLL_SPEED_MAX,
    );
  }

  function applyAutoScrollSettings() {
    const speed = normalizeAutoScrollSpeed(state.settings.autoScrollSpeed);
    state.settings.autoScrollSpeed = speed;
    if (els.autoScrollSpeedRange) els.autoScrollSpeedRange.value = String(speed);
    if (els.autoScrollSpeedValue) els.autoScrollSpeedValue.textContent = `${speed} px/s`;
    if (els.autoScrollSpeedPill) els.autoScrollSpeedPill.textContent = `${speed} px/s`;
    updateAutoScrollUI();
  }

  function normalizeTheme(value) {
    return VALID_THEMES.has(value) ? value : defaultSettings.theme;
  }

  function sanitizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      theme: normalizeTheme(src.theme),
      fontSize: normalizeFontSize(src.fontSize),
      lineHeight: clamp(Number(src.lineHeight), 1.35, 2.2),
      width: clamp(Number(src.width), 560, 1080),
      autoScrollSpeed: normalizeAutoScrollSpeed(src.autoScrollSpeed),
      source: asNonEmpty(src.source) || FILTER_ALL,
    };
  }

  function saveSettings() {
    state.settings = sanitizeSettings(state.settings);
    setStorageItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  /* ─────────────────────────────────────────────────────────────
     SCROLL / PROGRESS
  ───────────────────────────────────────────────────────────── */
  function toggleAutoScroll(force) {
    const next = typeof force === "boolean" ? force : !state.autoScrollActive;
    if (next) startAutoScroll();
    else stopAutoScroll();
  }

  function startAutoScroll() {
    if (!state.currentId || state.isLoadingChapter || !els.contentStage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const maxTop = getReaderMaxScrollTop();
    if (maxTop <= 0 || els.contentStage.scrollTop >= maxTop - 1) return;

    state.autoScrollActive = true;
    state.autoScrollLastTs = 0;
    state.autoScrollTop = Math.max(
      state.autoScrollFallbackTop,
      els.contentStage.scrollTop,
    );
    els.contentStage.style.scrollBehavior = "auto";
    setChromeVisible(false);
    updateAutoScrollUI();
    if (state.autoScrollRaf === null) {
      state.autoScrollRaf = requestAnimationFrame(stepAutoScroll);
    }
  }

  function stopAutoScroll() {
    state.autoScrollActive = false;
    state.autoScrollLastTs = 0;
    state.autoScrollFallbackTop = Math.max(
      state.autoScrollFallbackTop,
      state.autoScrollTop,
    );
    if (state.autoScrollRaf !== null) {
      cancelAnimationFrame(state.autoScrollRaf);
      state.autoScrollRaf = null;
    }
    state.autoScrollProgrammatic = false;
    els.contentStage.style.removeProperty("scroll-behavior");
    updateAutoScrollUI();
  }

  function stopAutoScrollForUserInput() {
    if (!state.autoScrollActive || state.autoScrollProgrammatic) return;
    stopAutoScroll();
  }

  function stepAutoScroll(ts) {
    if (!state.autoScrollActive || !els.contentStage) {
      state.autoScrollRaf = null;
      return;
    }

    const maxTop = getReaderMaxScrollTop();
    const current = Math.max(
      state.autoScrollFallbackTop,
      els.contentStage.scrollTop,
    );
    if (maxTop <= 0 || current >= maxTop - 1) {
      stopAutoScroll();
      return;
    }

    if (!state.autoScrollLastTs) state.autoScrollLastTs = ts;
    const elapsed = Math.min(64, Math.max(0, ts - state.autoScrollLastTs));
    state.autoScrollLastTs = ts;
    const distance =
      (normalizeAutoScrollSpeed(state.settings.autoScrollSpeed) * elapsed) /
      1000;
    state.autoScrollTop = Math.max(state.autoScrollTop, current) + distance;
    const nextTop = Math.min(maxTop, state.autoScrollTop);

    state.autoScrollProgrammatic = true;
    els.contentStage.scrollTop = nextTop;
    if (els.contentStage.scrollTop < nextTop - 1) {
      state.autoScrollFallbackTop = nextTop;
      els.content.style.transform = `translate3d(0, -${nextTop}px, 0)`;
      els.content.style.willChange = "transform";
      syncAutoScrollProgress(nextTop, maxTop);
    } else {
      state.autoScrollFallbackTop = 0;
      clearAutoScrollFallback();
    }
    requestAnimationFrame(() => {
      state.autoScrollProgrammatic = false;
    });
    state.autoScrollRaf = requestAnimationFrame(stepAutoScroll);
  }

  function syncAutoScrollProgress(scrollTop, maxTop) {
    if (!state.currentId || maxTop <= 0) return;
    const ratio = clamp(Number(scrollTop) / maxTop, 0, 1);
    setChapterProgress(state.currentId, scrollTop, ratio, ratio * 100);
    scheduleProgressSave();
    applyProgressBar(ratio * 100);
  }

  function clearAutoScrollFallback() {
    if (!els.content) return;
    els.content.style.removeProperty("transform");
    els.content.style.removeProperty("will-change");
  }

  function getReaderMaxScrollTop() {
    if (!els.contentStage) return 0;
    return Math.max(
      0,
      els.contentStage.scrollHeight - els.contentStage.clientHeight,
    );
  }

  function updateAutoScrollUI() {
    const active = state.autoScrollActive;
    const label = active ? "Pause auto scroll" : "Start auto scroll";
    const visible = Boolean(state.currentId);
    const controls = [els.autoScrollToolbarBtn, els.autoScrollToggleBtn];

    if (els.appShell) {
      els.appShell.classList.toggle("auto-scroll-active", active);
    }
    if (els.autoScrollControl) {
      els.autoScrollControl.classList.toggle("is-hidden", !visible);
    }
    if (els.autoScrollLabel) {
      els.autoScrollLabel.textContent = active ? "Scrolling" : "Auto";
    }

    controls.forEach((btn) => {
      if (!btn) return;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.disabled = !visible || state.isLoadingChapter;
    });
  }

  function handleReaderScroll() {
    const scrollTop = els.contentStage.scrollTop;

    if (state.currentId) {
      const maxTop = Math.max(
        0,
        els.contentStage.scrollHeight - els.contentStage.clientHeight,
      );
      const ratio = maxTop > 0 ? scrollTop / maxTop : 0;
      const pct = ratio * 100;
      setChapterProgress(state.currentId, scrollTop, ratio, pct);
      scheduleProgressSave();
      updateReadProgressFromScroll();

      /* Update progress strip in list */
      const btn = state.chapterButtonById.get(state.currentId);
      if (btn) {
        const fill = btn.querySelector(".chapter-progress-fill");
        if (fill) fill.style.width = `${clamp(Math.round(pct), 0, 100)}%`;
      }
    }

    scheduleScrollToTopButtonUpdate(Math.max(scrollTop, getWindowScrollTop()));
    handleMobileChromeAutoHide(scrollTop);
  }

  function handleWindowScroll() {
    scheduleScrollToTopButtonUpdate(
      Math.max(getWindowScrollTop(), els.contentStage.scrollTop),
    );
  }

  function handleMobileChromeAutoHide(scrollTop) {
    if (!MOBILE_QUERY.matches) {
      state.lastContentScrollTop = Math.max(0, Number(scrollTop) || 0);
      return;
    }

    const current = Math.max(0, Number(scrollTop) || 0);
    const previous = Math.max(0, Number(state.lastContentScrollTop) || 0);
    state.lastContentScrollTop = current;

    if (isSidebarOpen() || state.settingsOpen || isBookDetailOpen()) {
      if (!state.chromeVisible) setChromeVisible(true);
      return;
    }

    if (current <= 18) {
      if (!state.chromeVisible) setChromeVisible(true);
      return;
    }

    if (state.autoScrollActive) {
      if (state.chromeVisible) setChromeVisible(false);
      return;
    }

    const delta = current - previous;
    if (Math.abs(delta) < 7) return;

    if (delta > 0 && state.chromeVisible) setChromeVisible(false);
    if (delta < 0 && !state.chromeVisible) setChromeVisible(true);
  }

  function updateReadProgressFromScroll() {
    if (!state.currentId) {
      applyProgressBar(0);
      return;
    }
    const max = Math.max(
      0,
      els.contentStage.scrollHeight - els.contentStage.clientHeight,
    );
    if (max === 0) {
      applyProgressBar(0);
      return;
    }
    const pct = (els.contentStage.scrollTop / max) * 100;
    applyProgressBar(pct);
  }

  function applyProgressBar(pct) {
    const value = clamp(Number(pct), 0, 100);
    state.readProgress = value;
    if (els.readProgressFill) els.readProgressFill.style.width = `${value}%`;
    applyProgressGlow(value / 100);
  }

  function applyProgressGlow(ratio) {
    if (els.ambientGlow) {
      els.ambientGlow.style.opacity = `${0.18 + clamp(ratio, 0, 1) * 0.28}`;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     PROGRESS STORAGE
  ───────────────────────────────────────────────────────────── */
  function setChapterProgress(chapterId, scroll, ratio, percent) {
    const s = Math.max(0, Number(scroll) || 0);
    const r = clamp(Number(ratio) || 0, 0, 1);
    const p = clamp(Number(percent) || 0, 0, 100);
    const existing = state.progress[chapterId];
    if (existing && typeof existing === "object") {
      existing.scroll = s;
      existing.ratio = r;
      existing.percent = p;
    } else {
      state.progress[chapterId] = { scroll: s, ratio: r, percent: p };
    }
  }

  function getChapterProgress(chapterId) {
    const raw = state.progress[chapterId];
    if (raw && typeof raw === "object") {
      return {
        scroll: Math.max(0, Number(raw.scroll) || 0),
        ratio: clamp(Number(raw.ratio) || 0, 0, 1),
        percent: clamp(Number(raw.percent) || 0, 0, 100),
      };
    }
    /* Legacy: plain number */
    const legacyScroll = Math.max(0, Number(raw) || 0);
    return { scroll: legacyScroll, ratio: 0, percent: 0 };
  }

  function restoreChapterProgress(chapterId) {
    const snap = getChapterProgress(chapterId);
    const maxTop = Math.max(
      0,
      els.contentStage.scrollHeight - els.contentStage.clientHeight,
    );
    const top = clamp(snap.scroll, 0, maxTop);
    els.contentStage.scrollTop = top;
    return top > 0;
  }

  function persistCurrentProgress() {
    if (!state.currentId) return;
    const maxTop = Math.max(
      0,
      els.contentStage.scrollHeight - els.contentStage.clientHeight,
    );
    const scroll = Math.max(0, els.contentStage.scrollTop);
    const ratio = maxTop > 0 ? scroll / maxTop : 0;
    setChapterProgress(state.currentId, scroll, ratio, ratio * 100);
    scheduleProgressSave();
  }

  function scheduleProgressSave() {
    if (state.saveTimer) return;
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      setStorageItem(PROGRESS_KEY, JSON.stringify(state.progress));
    }, 400);
  }

  function flushProgressSave() {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    setStorageItem(PROGRESS_KEY, JSON.stringify(state.progress));
  }

  function readProgress() {
    const raw = readJSONWithLegacy(PROGRESS_KEY, LEGACY_PROGRESS_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  /* ─────────────────────────────────────────────────────────────
     OFFLINE CHAPTERS STORAGE
  ───────────────────────────────────────────────────────────── */
  function loadOfflineChapters() {
    try {
      const raw = getStorageItem(OFFLINE_CHAPTERS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveOfflineChapters() {
    setStorageItem(
      OFFLINE_CHAPTERS_KEY,
      JSON.stringify([...state.offlineChapters]),
    );
  }

  /* ─────────────────────────────────────────────────────────────
     SCROLL-TO-TOP BUTTON
  ───────────────────────────────────────────────────────────── */
  function scheduleScrollToTopButtonUpdate(scrollTop) {
    state.pendingScrollTop = Math.max(0, Number(scrollTop) || 0);
    if (state.scrollButtonRaf !== null) return;
    state.scrollButtonRaf = requestAnimationFrame(() => {
      state.scrollButtonRaf = null;
      updateScrollToTopButton(state.pendingScrollTop);
    });
  }

  function updateScrollToTopButton(scrollTop) {
    if (!els.scrollToTopBtn) return;
    const shouldShow = scrollTop > SCROLL_SHOW_THRESHOLD;
    if (shouldShow === state.scrollToTopVisible) return;
    state.scrollToTopVisible = shouldShow;
    els.scrollToTopBtn.classList.toggle("is-hidden", !shouldShow);
    if (shouldShow) {
      els.scrollToTopBtn.removeAttribute("tabindex");
      els.scrollToTopBtn.removeAttribute("aria-hidden");
    } else {
      els.scrollToTopBtn.setAttribute("tabindex", "-1");
      els.scrollToTopBtn.setAttribute("aria-hidden", "true");
    }
  }

  function scrollToTop() {
    state.autoScrollFallbackTop = 0;
    clearAutoScrollFallback();
    try {
      els.contentStage.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {
      els.contentStage.scrollTop = 0;
    }
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {
      window.scrollTo(0, 0);
    }
    if (state.scrollButtonRaf !== null) {
      cancelAnimationFrame(state.scrollButtonRaf);
      state.scrollButtonRaf = null;
    }
    state.pendingScrollTop = 0;
    updateScrollToTopButton(0);
    if (MOBILE_QUERY.matches && !state.chromeVisible) setChromeVisible(true);
  }

  function getWindowScrollTop() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  /* ─────────────────────────────────────────────────────────────
     DETAIL SHEET
  ───────────────────────────────────────────────────────────── */
  function isBookDetailOpen() {
    return Boolean(
      els.bookDetailSheet && els.bookDetailSheet.dataset.open === "true",
    );
  }

  function openBookDetailSheet(chapterId) {
    const entry = state.entriesById.get(chapterId);
    if (!entry || !els.bookDetailSheet) return;

    state.detailChapterId = chapterId;
    if (els.bookDetailTitle) els.bookDetailTitle.textContent = entry.title;
    if (els.bookDetailPath) els.bookDetailPath.textContent = entry.path;
    if (els.bookDetailSource)
      els.bookDetailSource.textContent = `${entry.sourceLabel} / ${entry.group || "root"}`;
    if (els.bookDetailExcerpt)
      els.bookDetailExcerpt.textContent = makeEntryExcerpt(entry);

    updateDetailBookmarkBtn(chapterId);
    els.bookDetailSheet.setAttribute("data-open", "true");
    els.bookDetailSheet.removeAttribute("hidden");
    els.bookDetailSheet.removeAttribute("aria-hidden");
    els.bookDetailSheet.removeAttribute("inert");
    requestAnimationFrame(() => focusElement(els.bookDetailSheet));
    cancelLongPress();
  }

  function closeBookDetailSheet() {
    if (!els.bookDetailSheet) return;
    state.detailChapterId = null;
    els.bookDetailSheet.removeAttribute("data-open");
    els.bookDetailSheet.dataset.open = "false";
    els.bookDetailSheet.setAttribute("aria-hidden", "true");
    els.bookDetailSheet.setAttribute("inert", "");
    els.bookDetailSheet.setAttribute("hidden", "");
  }

  function makeEntryExcerpt(entry) {
    return `Open ${entry.title} to start reading. Source: ${entry.sourceLabel}. Location: ${entry.path.replace(/\.md$/i, "").replace(/[_-]+/g, " ")}.`;
  }

  /* ─────────────────────────────────────────────────────────────
     READER GESTURES
  ───────────────────────────────────────────────────────────── */
  function bindReaderGestures() {
    bindEdgeSwipeNavigation();
  }

  function animateReaderTransition() {
    if (!els.content) return;
    els.content.classList.remove("reader-transition-enter");
    void els.content.offsetWidth;
    els.content.classList.add("reader-transition-enter");
    els.content.addEventListener(
      "animationend",
      () => {
        els.content.classList.remove("reader-transition-enter");
      },
      { once: true },
    );
  }

  function bindEdgeSwipeNavigation() {
    const container = els.contentStage || els.readerPanel;
    if (!container) return;
    const getSwipeThreshold = () =>
      Math.min(220, Math.max(118, window.innerWidth * 0.32));
    const verticalCancelDistance = 42;
    const verticalFinalizeLimit = 48;
    const verticalCancelRatio = 1.9;
    const dominanceRatio = 2.25;

    const resetSwipe = () => {
      state.pageSwipeState = null;
    };

    container.addEventListener("pointerdown", (e) => {
      if (
        isBookDetailOpen() ||
        isSidebarOpen() ||
        state.settingsOpen ||
        (e.pointerType === "mouse" && e.button !== 0) ||
        e.button === 1
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          "a, button, input, textarea, select, label, summary, [role='button']",
        )
      )
        return;
      const x = e.clientX,
        y = e.clientY;
      state.pageSwipeState = {
        pointerId: e.pointerId,
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        active: true,
      };
    });

    container.addEventListener("pointermove", (e) => {
      const s = state.pageSwipeState;
      if (!s || !s.active || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX,
        dy = e.clientY - s.startY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      if (
        Math.abs(dy) > verticalCancelDistance &&
        Math.abs(dy) > Math.abs(dx) / verticalCancelRatio
      ) {
        resetSwipe();
      }
    });

    const finalize = (e) => {
      const s = state.pageSwipeState;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      const swipeThreshold = getSwipeThreshold();
      const isHorizontal =
        Math.abs(dx) >= swipeThreshold &&
        Math.abs(dy) <= verticalFinalizeLimit &&
        Math.abs(dx) > Math.abs(dy) * dominanceRatio;
      if (isHorizontal) {
        e.preventDefault();
        state.ignoreNextReaderTapUntil = Date.now() + 450;
        stopAutoScroll();
        moveToSibling(dx < 0 ? 1 : -1);
      }
      resetSwipe();
    };

    container.addEventListener("pointerup", finalize);
    container.addEventListener("pointercancel", resetSwipe);
    container.addEventListener("pointerleave", (e) => {
      if (
        state.pageSwipeState &&
        state.pageSwipeState.pointerId === e.pointerId
      )
        resetSwipe();
    });
  }

  /* ─────────────────────────────────────────────────────────────
     RIPPLE EFFECT
  ───────────────────────────────────────────────────────────── */
  function bindRippleOnButtons() {
    document.addEventListener("pointerdown", (e) => {
      if (isBookDetailOpen()) return;
      const target =
        e.target instanceof Element
          ? e.target.closest(".icon-btn, .filter-chip, .chapter-item")
          : null;
      if (!target) return;
      if (e.button !== undefined && e.button > 0) return;
      createRipple(target, e);
    });
  }

  function createRipple(target, e) {
    if (!target || typeof target.closest !== "function") return;
    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple-layer";
    ripple.style.left = `${e.clientX - rect.left}px`;
    ripple.style.top = `${e.clientY - rect.top}px`;
    target.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), {
      once: true,
    });
  }

  /* ─────────────────────────────────────────────────────────────
     LONG-PRESS DETAIL SHEET
  ───────────────────────────────────────────────────────────── */
  function handleChapterListPointerStart(e) {
    if (
      (e.pointerType && e.pointerType !== "touch" && e.pointerType !== "pen") ||
      e.button > 0 ||
      !e.isPrimary
    )
      return;
    const btn =
      e.target instanceof Element
        ? e.target.closest("button.chapter-item[data-chapter-id]")
        : null;
    if (!btn || isBookDetailOpen()) return;
    const id = btn.dataset.chapterId;
    if (!id) return;

    state.pressState = {
      chapterId: id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      timer: setTimeout(() => {
        state.ignoreNextChapterClickUntil = Date.now() + 650;
        openBookDetailSheet(id);
      }, 520),
    };
    btn.addEventListener("pointerleave", cancelLongPress, { once: true });
  }

  function handleChapterListPointerMove(e) {
    const ps = state.pressState;
    if (!ps || ps.pointerId !== e.pointerId) return;
    if (
      Math.abs(e.clientX - ps.startX) > 8 ||
      Math.abs(e.clientY - ps.startY) > 8
    )
      cancelLongPress();
  }

  function handleChapterListPointerEnd(e) {
    if (!state.pressState || state.pressState.pointerId !== e.pointerId) return;
    cancelLongPress();
  }

  function cancelLongPress() {
    const ps = state.pressState;
    if (!ps) return;
    if (ps.timer) clearTimeout(ps.timer);
    state.pressState = null;
  }

  /* ─────────────────────────────────────────────────────────────
     PATH HELPERS
  ───────────────────────────────────────────────────────────── */
  function toReaderPath(rootRelativePath) {
    return `../${rootRelativePath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/")}`;
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (_) {
      return url;
    }
  }

  /* Walk every open Cache and return the first match as text.
     Used when chapters live outside the service-worker scope
     (the SW never sees the fetch, but cacheUrls() already stored them). */
  async function readCachedMarkdown(url) {
    if (typeof caches === "undefined" || !caches || !caches.match) return null;
    try {
      const match = await caches.match(url, { ignoreVary: true });
      if (match && match.ok) return await match.text();
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  /* ─────────────────────────────────────────────────────────────
     STORAGE
  ───────────────────────────────────────────────────────────── */
  function getStorageItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function setStorageItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_) { }
  }

  function readJSON(key, fallback) {
    try {
      const raw = getStorageItem(key);
      if (!raw) return cloneDefault(fallback);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object")
        return { ...fallback, ...parsed };
      return cloneDefault(fallback);
    } catch (_) {
      return cloneDefault(fallback);
    }
  }

  function readJSONWithLegacy(key, legacyKey, fallback) {
    const scoped = readJSON(key, fallback);
    const hasScoped = getStorageItem(key) !== null;
    if (hasScoped || !legacyKey) return scoped;

    const hasLegacy = getStorageItem(legacyKey) !== null;
    if (!hasLegacy) return scoped;

    const legacyValue = readJSON(legacyKey, fallback);
    setStorageItem(key, JSON.stringify(legacyValue));
    return legacyValue;
  }

  function cloneDefault(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  /* ─────────────────────────────────────────────────────────────
     UTILITIES
  ───────────────────────────────────────────────────────────── */
  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addMediaQueryListener(query, listener) {
    if (typeof query.addEventListener === "function")
      query.addEventListener("change", listener);
    else if (typeof query.addListener === "function")
      query.addListener(listener);
  }
})();
