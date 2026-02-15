(function () {
  "use strict";

  const SETTINGS_KEY = "novel_reader_settings_v1";
  const LAST_CHAPTER_KEY = "novel_reader_last_chapter_v1";
  const PROGRESS_KEY = "novel_reader_scroll_progress_v1";
  const SYSTEM_THEME_QUERY = window.matchMedia("(prefers-color-scheme: dark)");

  const defaultSettings = {
    theme: "system",
    font: "serif",
    mode: "scroll",
    fontSize: 19,
    lineHeight: 1.75,
    width: 780,
    source: "all"
  };

  const fontMap = {
    serif: "'Source Serif 4', Georgia, serif",
    friendly: "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
    classic: "'Alegreya', Georgia, serif",
    myanmarSerif: "'Noto Serif Myanmar', 'Padauk', 'Myanmar Text', 'Pyidaungsu', 'Noto Sans Myanmar', serif",
    myanmarSans: "'Noto Sans Myanmar', 'Padauk', 'Myanmar Text', 'Pyidaungsu', 'Atkinson Hyperlegible', sans-serif",
    myanmarPadauk: "'Padauk', 'Noto Sans Myanmar', 'Myanmar Text', 'Pyidaungsu', sans-serif"
  };

  const state = {
    entries: [],
    visibleEntries: [],
    currentId: null,
    currentHtml: "",
    settings: readJSON(SETTINGS_KEY, defaultSettings),
    progress: readJSON(PROGRESS_KEY, {}),
    saveTimer: null,
    pagingLayoutTimer: null,
    wheelLockUntil: 0
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
    modeSelect: document.getElementById("modeSelect"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightRange: document.getElementById("lineHeightRange"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    widthRange: document.getElementById("widthRange"),
    widthValue: document.getElementById("widthValue"),
    chapterJumpWrap: document.getElementById("chapterJumpWrap"),
    chapterJumpSelect: document.getElementById("chapterJumpSelect"),
    chapterTitle: document.getElementById("chapterTitle"),
    chapterInfo: document.getElementById("chapterInfo"),
    content: document.getElementById("content"),
    contentStage: document.getElementById("contentStage"),
    readerViewport: document.getElementById("readerViewport"),
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

    els.modeSelect.addEventListener("change", () => {
      const previousMode = getReadingMode();
      const previousRatio = getCurrentProgressRatio(previousMode);
      persistCurrentProgress();

      state.settings.mode = normalizeMode(els.modeSelect.value);
      saveSettings();
      applyReadingMode();

      if (state.currentHtml) {
        renderChapterContent({ useSavedPosition: true, fallbackRatio: previousRatio });
      }
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

    els.chapterJumpSelect.addEventListener("change", () => {
      const headingId = els.chapterJumpSelect.value;
      if (!headingId) return;
      jumpToHeading(headingId);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        document.body.classList.remove("sidebar-open");
      }
    });

    els.contentStage.addEventListener("scroll", handleReadProgressScroll, { passive: true });
    els.content.addEventListener("scroll", handleReadProgressScroll, { passive: true });
    els.content.addEventListener("wheel", handlePagingWheel, { passive: false });

    window.addEventListener("resize", () => {
      schedulePagingLayout();
    });

    window.addEventListener("beforeunload", () => {
      persistCurrentProgress();
      flushProgressSave();
    });

    SYSTEM_THEME_QUERY.addEventListener("change", () => {
      if (state.settings.theme === "system") {
        applyTheme();
      }
    });

    if (document.fonts && typeof document.fonts.addEventListener === "function") {
      document.fonts.addEventListener("loadingdone", () => {
        schedulePagingLayout();
      });
    }
  }

  function handleReadProgressScroll() {
    if (!state.currentId) return;

    const mode = getReadingMode();
    const position = mode === "paging"
      ? Math.max(0, els.content.scrollLeft)
      : Math.max(0, els.contentStage.scrollTop);

    setChapterProgress(state.currentId, mode, position);
    scheduleProgressSave();
  }

  function handlePagingWheel(event) {
    if (getReadingMode() !== "paging") return;
    if (event.ctrlKey || event.metaKey) return;

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();

    const now = performance.now();
    if (now < state.wheelLockUntil) {
      return;
    }
    state.wheelLockUntil = now + 190;

    const direction = event.deltaY > 0 ? 1 : -1;
    const pageStep = Math.max(1, els.content.clientWidth);
    els.content.scrollBy({
      left: direction * pageStep,
      behavior: "smooth"
    });
  }

  function schedulePagingLayout() {
    if (getReadingMode() !== "paging" || !state.currentHtml) return;

    if (state.pagingLayoutTimer) {
      clearTimeout(state.pagingLayoutTimer);
    }

    state.pagingLayoutTimer = window.setTimeout(() => {
      state.pagingLayoutTimer = null;
      const ratio = getCurrentProgressRatio("paging");
      renderChapterContent({ useSavedPosition: false, fallbackRatio: ratio });
    }, 120);
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
      state.currentHtml = '<p class="empty-state">Run <code>python reader/generate_manifest.py</code> then reload.</p>';
      renderChapterContent({ suppressChapterJump: true });
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

    persistCurrentProgress();
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

      state.currentHtml = DOMPurify.sanitize(rendered);
      renderChapterContent({ useSavedPosition: true });

      const words = countWords(markdown);
      const minutes = Math.max(1, Math.round(words / 220));
      setChapterMeta(entry, `${words.toLocaleString()} words · ~${minutes} min read`);

      if (closeSidebarOnMobile) {
        document.body.classList.remove("sidebar-open");
      }
    } catch (error) {
      const message = String(error.message || error);
      setChapterMeta(entry, message);
      state.currentHtml = `<p class="empty-state">${escapeHtml(message)}</p>`;
      renderChapterContent({ useSavedPosition: false, suppressChapterJump: true });
      clearChapterJumpOptions();
    }
  }

  function renderChapterContent(options = {}) {
    const {
      useSavedPosition = false,
      suppressChapterJump = false,
      fallbackRatio = null
    } = options;

    const html = state.currentHtml || '<p class="empty-state">Pick any markdown file to start reading.</p>';
    const mode = getReadingMode();

    if (mode === "paging") {
      renderPagingContent(html);
    } else {
      renderScrollContent(html);
    }

    if (suppressChapterJump) {
      clearChapterJumpOptions();
    } else {
      populateChapterJumpOptions();
    }

    requestAnimationFrame(() => {
      if (useSavedPosition && state.currentId) {
        const restored = restoreChapterProgress(state.currentId, mode);
        if (!restored && Number.isFinite(fallbackRatio)) {
          applyProgressRatio(mode, fallbackRatio);
        }
        return;
      }

      if (Number.isFinite(fallbackRatio)) {
        applyProgressRatio(mode, fallbackRatio);
        if (state.currentId) {
          const position = mode === "paging" ? els.content.scrollLeft : els.contentStage.scrollTop;
          setChapterProgress(state.currentId, mode, position);
          scheduleProgressSave();
        }
        return;
      }

      if (mode === "paging") {
        els.content.scrollLeft = 0;
      } else {
        els.contentStage.scrollTop = 0;
      }
    });
  }

  function renderScrollContent(html) {
    els.content.innerHTML = html;
  }

  function renderPagingContent(html) {
    const template = document.createElement("template");
    template.innerHTML = html;

    const nodes = Array.from(template.content.childNodes).filter((node) => {
      return !(node.nodeType === Node.TEXT_NODE && !node.textContent.trim());
    });

    if (!nodes.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nothing to display.";
      nodes.push(empty);
    }

    els.content.innerHTML = "";

    let currentPage = createPagingPage();
    els.content.appendChild(currentPage.page);

    for (const node of nodes) {
      currentPage.inner.appendChild(node);

      if (!pageOverflows(currentPage.inner)) {
        continue;
      }

      currentPage.inner.removeChild(node);

      if (!currentPage.inner.childNodes.length) {
        currentPage.inner.appendChild(node);
        currentPage = createPagingPage();
        els.content.appendChild(currentPage.page);
        continue;
      }

      currentPage = createPagingPage();
      els.content.appendChild(currentPage.page);
      currentPage.inner.appendChild(node);

      while (currentPage.inner.childNodes.length > 1 && pageOverflows(currentPage.inner)) {
        const overflowNode = currentPage.inner.lastChild;
        currentPage.inner.removeChild(overflowNode);

        const nextPage = createPagingPage();
        els.content.appendChild(nextPage.page);
        nextPage.inner.appendChild(overflowNode);
        currentPage = nextPage;
      }
    }

    const lastPage = els.content.lastElementChild;
    if (
      lastPage
      && lastPage.classList.contains("page")
      && lastPage.firstElementChild
      && !lastPage.firstElementChild.childNodes.length
      && els.content.children.length > 1
    ) {
      lastPage.remove();
    }
  }

  function createPagingPage() {
    const page = document.createElement("section");
    page.className = "page";

    const inner = document.createElement("div");
    inner.className = "page-inner";

    page.appendChild(inner);
    return { page, inner };
  }

  function pageOverflows(inner) {
    if (!inner || inner.clientHeight <= 0) return false;
    return inner.scrollHeight > inner.clientHeight + 1;
  }

  function populateChapterJumpOptions() {
    const headings = [...els.content.querySelectorAll("h1[id], h2[id], h3[id], h4[id]")];
    clearChapterJumpOptions();

    if (!headings.length) return;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a section";
    els.chapterJumpSelect.appendChild(placeholder);

    for (const heading of headings) {
      const option = document.createElement("option");
      const level = Number(heading.tagName.replace("H", ""));
      const indent = level > 1 ? " ".repeat((level - 1) * 2) : "";
      option.value = heading.id;
      option.textContent = `${indent}${heading.textContent.trim()}`;
      els.chapterJumpSelect.appendChild(option);
    }

    els.chapterJumpWrap.hidden = false;
    els.chapterJumpSelect.value = "";
  }

  function clearChapterJumpOptions() {
    els.chapterJumpSelect.innerHTML = "";
    els.chapterJumpWrap.hidden = true;
  }

  function jumpToHeading(headingId) {
    const target = els.content.querySelector(`#${escapeCssIdent(headingId)}`);
    if (!target) return;

    if (getReadingMode() === "paging") {
      const page = target.closest(".page") || target;
      page.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start"
      });
      return;
    }

    const stageRect = els.contentStage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const topOffset = targetRect.top - stageRect.top + els.contentStage.scrollTop - 28;
    els.contentStage.scrollTo({
      top: Math.max(0, topOffset),
      behavior: "smooth"
    });
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
    settings.mode = normalizeMode(settings.mode);
    state.settings = settings;

    els.themeSelect.value = settings.theme;
    els.fontSelect.value = settings.font;
    els.modeSelect.value = settings.mode;
    els.fontSizeRange.value = String(settings.fontSize);
    els.lineHeightRange.value = String(settings.lineHeight);
    els.widthRange.value = String(settings.width);
  }

  function applyVisualSettings() {
    applyTheme();
    applyTypography();
    applyReadingMode();
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

    schedulePagingLayout();
  }

  function applyReadingMode() {
    const mode = normalizeMode(state.settings.mode);
    state.settings.mode = mode;
    els.modeSelect.value = mode;
    els.readerPanel.dataset.readingMode = mode;
  }

  function getReadingMode() {
    return normalizeMode(state.settings.mode);
  }

  function normalizeMode(mode) {
    return mode === "paging" ? "paging" : "scroll";
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

  function persistCurrentProgress() {
    if (!state.currentId) return;

    const mode = getReadingMode();
    const position = mode === "paging"
      ? Math.max(0, els.content.scrollLeft)
      : Math.max(0, els.contentStage.scrollTop);

    setChapterProgress(state.currentId, mode, position);
    scheduleProgressSave();
  }

  function setChapterProgress(chapterId, mode, position) {
    const snapshot = getChapterProgress(chapterId);
    const safe = Math.max(0, Number(position) || 0);

    if (mode === "paging") {
      snapshot.paging = safe;
    } else {
      snapshot.scroll = safe;
    }

    state.progress[chapterId] = snapshot;
  }

  function getChapterProgress(chapterId) {
    const raw = state.progress[chapterId];

    if (raw && typeof raw === "object") {
      return {
        scroll: Math.max(0, Number(raw.scroll) || 0),
        paging: Math.max(0, Number(raw.paging) || 0)
      };
    }

    const legacyScroll = Number(raw || 0);
    return {
      scroll: Number.isFinite(legacyScroll) ? Math.max(0, legacyScroll) : 0,
      paging: 0
    };
  }

  function restoreChapterProgress(chapterId, mode) {
    const snapshot = getChapterProgress(chapterId);

    if (mode === "paging") {
      const maxLeft = Math.max(0, els.content.scrollWidth - els.content.clientWidth);
      const left = clamp(snapshot.paging, 0, maxLeft);
      els.content.scrollLeft = left;
      return left > 0;
    }

    const maxTop = Math.max(0, els.contentStage.scrollHeight - els.contentStage.clientHeight);
    const top = clamp(snapshot.scroll, 0, maxTop);
    els.contentStage.scrollTop = top;
    return top > 0;
  }

  function getCurrentProgressRatio(mode) {
    if (mode === "paging") {
      const maxLeft = Math.max(0, els.content.scrollWidth - els.content.clientWidth);
      if (maxLeft <= 0) return 0;
      return clamp(els.content.scrollLeft / maxLeft, 0, 1);
    }

    const maxTop = Math.max(0, els.contentStage.scrollHeight - els.contentStage.clientHeight);
    if (maxTop <= 0) return 0;
    return clamp(els.contentStage.scrollTop / maxTop, 0, 1);
  }

  function applyProgressRatio(mode, ratio) {
    const safeRatio = clamp(Number(ratio), 0, 1);

    if (mode === "paging") {
      const maxLeft = Math.max(0, els.content.scrollWidth - els.content.clientWidth);
      els.content.scrollLeft = maxLeft * safeRatio;
      return;
    }

    const maxTop = Math.max(0, els.contentStage.scrollHeight - els.contentStage.clientHeight);
    els.contentStage.scrollTop = maxTop * safeRatio;
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

  function escapeCssIdent(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
})();
