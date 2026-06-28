"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MermaidCanvasPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/SplitModal.ts
var import_obsidian2 = require("obsidian");

// src/CanvasView.ts
var import_obsidian = require("obsidian");

// src/constants.ts
var CLASSES = {
  // Wrapper around the mermaid SVG in reading view
  CANVAS_WRAPPER: "mermaid-canvas-wrapper",
  // The container that gets transform: scale/translate applied
  CANVAS_CONTENT: "mermaid-canvas-content",
  // Control bar overlay
  CONTROL_BAR: "mermaid-canvas-controls",
  CONTROL_BTN: "mermaid-canvas-btn",
  // Fullscreen overlay
  FULLSCREEN_OVERLAY: "mermaid-canvas-fullscreen",
  // Split modal
  SPLIT_MODAL: "mermaid-canvas-split",
  SPLIT_LEFT: "mermaid-canvas-left",
  SPLIT_RIGHT: "mermaid-canvas-right",
  SPLIT_TOOLBAR: "mermaid-canvas-toolbar"
};
var DEFAULT_SETTINGS = {
  zoomSensitivity: 6e-4,
  // scale change per deltaY pixel
  defaultSplitView: true,
  mermaidTheme: "default"
};
var ZOOM_SENSITIVITY_MIN = 1e-3;
var ZOOM_SENSITIVITY_MAX = 0.012;
var RENDER_DEBOUNCE = 300;

// src/CanvasView.ts
var CanvasView = class {
  constructor(container, options) {
    // Source code of the mermaid diagram (for copy button)
    this.sourceCode = "";
    // Transform state (kept in memory, not read from DOM)
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    // Drag state
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartTx = 0;
    this.dragStartTy = 0;
    // Fullscreen state
    this.fullscreenOverlay = null;
    this.fullscreenKeyDown = null;
    // Saved CSS state (anything we mutate in enterFullscreen)
    this.fsSave = {};
    // Obsidian component for MarkdownRenderer (used in split modal context)
    this.mdComponent = null;
    // Render generation counter — prevents stale async renders from overwriting latest
    this.renderGen = 0;
    this.container = container;
    this.options = { zoomSensitivity: DEFAULT_SETTINGS.zoomSensitivity, ...options };
    this.onWheel = this.handleWheel.bind(this);
    this.onMouseDown = this.handleMouseDown.bind(this);
    this.onMouseMove = this.handleMouseMove.bind(this);
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
  }
  // ─── Fullscreen ───────────────────────────────────────────────
  enterFullscreen() {
    if (this.fullscreenOverlay || !this.wrapper)
      return;
    const doc = this.wrapper.ownerDocument;
    const keys = [
      "display",
      "width",
      "height",
      "maxWidth",
      "maxHeight",
      "minHeight",
      "alignItems",
      "justifyContent",
      "borderRadius",
      "boxShadow"
    ];
    this.fsSave = {};
    for (const k of keys)
      this.fsSave[k] = this.wrapper.style.getPropertyValue(k);
    const originalParent = this.wrapper.parentElement;
    this._fsParent = originalParent;
    this.fullscreenOverlay = doc.createElement("div");
    this.fullscreenOverlay.classList.add(CLASSES.FULLSCREEN_OVERLAY);
    this.fullscreenOverlay.appendChild(this.wrapper);
    this.wrapper.style.display = "flex";
    this.wrapper.style.alignItems = "center";
    this.wrapper.style.justifyContent = "center";
    this.wrapper.style.width = "100vw";
    this.wrapper.style.height = "100vh";
    this.wrapper.style.maxWidth = "none";
    this.wrapper.style.maxHeight = "none";
    this.wrapper.style.minHeight = "0";
    this.wrapper.style.borderRadius = "0";
    this.wrapper.style.boxShadow = "none";
    const closeBtn = this.fullscreenOverlay.createEl("button", {
      cls: "mermaid-canvas-fs-close",
      title: "Exit fullscreen (Esc)"
    });
    (0, import_obsidian.setIcon)(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.exitFullscreen());
    this.fullscreenOverlay.addEventListener("click", (e) => {
      if (e.target === this.fullscreenOverlay)
        this.exitFullscreen();
    });
    this.fullscreenKeyDown = (e) => {
      if (e.key === "Escape")
        this.exitFullscreen();
    };
    doc.addEventListener("keydown", this.fullscreenKeyDown);
    doc.body.appendChild(this.fullscreenOverlay);
    const fit = () => this.fitToCanvas();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
    setTimeout(fit, 400);
  }
  exitFullscreen() {
    if (this.fullscreenKeyDown) {
      document.removeEventListener("keydown", this.fullscreenKeyDown);
      this.fullscreenKeyDown = null;
    }
    const overlay = this.fullscreenOverlay;
    this.fullscreenOverlay = null;
    if (overlay)
      overlay.remove();
    const originalParent = this._fsParent;
    this._fsParent = void 0;
    if (this.wrapper && originalParent) {
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.applyTransform();
      for (const k of Object.keys(this.fsSave)) {
        this.wrapper.style[k] = this.fsSave[k];
      }
      this.fsSave = {};
      originalParent.appendChild(this.wrapper);
      const fit = () => {
        if (!this.fullscreenOverlay)
          this.fitToCanvas();
      };
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
      setTimeout(fit, 200);
      setTimeout(fit, 500);
    }
  }
  /** Wrap an already-rendered SVG element (inline reading-view usage) */
  mount(svgElement) {
    this.svgEl = svgElement;
    const ok = this.buildDOM();
    if (!ok) {
      console.warn("Mermaid Canvas: failed to build DOM \u2014 SVG may not be in expected container");
      return;
    }
    this.bindEvents();
    this.fitToCanvas();
  }
  /** Render mermaid code to SVG, then mount (split-modal usage) */
  async mountFromCode(code, sourcePath) {
    this.sourceCode = code;
    this.wrapper = this.container.createDiv({ cls: CLASSES.CANVAS_WRAPPER });
    this.content = this.wrapper.createDiv({ cls: CLASSES.CANVAS_CONTENT });
    this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
    this.buildControlButtons();
    this.bindEvents();
    await this.renderCode(code, sourcePath);
    this.fitToCanvas();
  }
  /** Re-render with new mermaid code */
  async updateCode(code, sourcePath) {
    await this.renderCode(code, sourcePath);
    this.fitToCanvas();
  }
  async renderCode(code, sourcePath) {
    const gen = ++this.renderGen;
    this.content.empty();
    const wrapper = this.content.createDiv();
    wrapper.addClass("mermaid-canvas-render-target");
    if (!code.trim()) {
      wrapper.createEl("p", { text: "Enter Mermaid code on the left...", cls: "mermaid-canvas-placeholder" });
      return;
    }
    const mermaidBlock = "```mermaid\n" + code + "\n```";
    if (this.mdComponent) {
      this.mdComponent.unload();
    }
    this.mdComponent = new import_obsidian.Component();
    this.mdComponent.load();
    try {
      await import_obsidian.MarkdownRenderer.renderMarkdown(mermaidBlock, wrapper, sourcePath, this.mdComponent);
      if (gen !== this.renderGen)
        return;
      const svg = await this.waitForSvg(wrapper, 2e3);
      if (gen !== this.renderGen)
        return;
      if (svg) {
        this.svgEl = svg;
        svg.removeAttribute("width");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        this.applyTransform();
      } else {
        wrapper.createEl("p", { text: "\u26A0\uFE0F Rendering failed \u2014 check your Mermaid syntax.", cls: "mermaid-canvas-error" });
      }
    } catch {
      if (gen === this.renderGen) {
        wrapper.createEl("p", { text: "\u26A0\uFE0F Rendering error \u2014 invalid Mermaid syntax.", cls: "mermaid-canvas-error" });
      }
    }
  }
  /** Poll for an SVG to appear inside the container (handles async mermaid rendering) */
  waitForSvg(el, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const svg = el.querySelector("svg");
        if (svg) {
          resolve(svg);
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve(null);
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }
  /** @returns true if the DOM was successfully built, false if the SVG is not in a recognizable container */
  buildDOM() {
    const mermaidContainer = this.svgEl.closest(".mermaid, .block-language-mermaid") || this.svgEl.parentElement;
    if (!mermaidContainer)
      return false;
    const insertionPoint = mermaidContainer.parentElement;
    if (!insertionPoint)
      return false;
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add(CLASSES.CANVAS_WRAPPER);
    this.content = document.createElement("div");
    this.content.classList.add(CLASSES.CANVAS_CONTENT);
    this.wrapper.appendChild(this.content);
    if (mermaidContainer.childNodes.length > 0) {
      if (mermaidContainer.tagName === "PRE") {
        const svg = mermaidContainer.querySelector("svg");
        if (svg && mermaidContainer.parentElement) {
          mermaidContainer.parentElement.insertBefore(svg, mermaidContainer);
        }
      }
      for (const child of [...mermaidContainer.children]) {
        if (child.tagName !== "svg" && !child.querySelector?.("svg")) {
          child.style.display = "none";
        }
      }
      if (mermaidContainer.tagName === "PRE") {
        mermaidContainer.style.fontSize = "0";
        mermaidContainer.style.color = "transparent";
        mermaidContainer.style.userSelect = "none";
      }
    }
    insertionPoint.insertBefore(this.wrapper, mermaidContainer);
    this.content.appendChild(mermaidContainer);
    const foundSvg = mermaidContainer.querySelector("svg");
    if (foundSvg)
      this.svgEl = foundSvg;
    this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
    this.buildControlButtons();
    return true;
  }
  buildControlButtons() {
    this.controlBar.empty();
    const buttons = [
      { icon: "zoom-in", title: "Zoom In", action: () => this.zoomIn() },
      { icon: "zoom-out", title: "Zoom Out", action: () => this.zoomOut() },
      { icon: "maximize", title: "Fullscreen", action: () => this.enterFullscreen() },
      { icon: "crop", title: "Fit to canvas", action: () => this.fitToCanvas() },
      { icon: "copy", title: "Copy code (without fences)", action: () => this.copyCode() }
    ];
    for (const { icon, title, action } of buttons) {
      const btn = this.controlBar.createEl("button", { cls: CLASSES.CONTROL_BTN, title });
      (0, import_obsidian.setIcon)(btn, icon);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action();
      });
    }
  }
  bindEvents() {
    this.wrapper.addEventListener("wheel", this.onWheel, { passive: false });
    this.wrapper.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }
  /** Remove all event listeners */
  destroy() {
    this.exitFullscreen();
    this.wrapper?.removeEventListener("wheel", this.onWheel);
    this.wrapper?.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.mdComponent?.unload();
    this.wrapper?.remove();
  }
  // ─── Wheel → Zoom ────────────────────────────────────────────
  handleWheel(e) {
    if (!e.ctrlKey && !e.metaKey)
      return;
    e.preventDefault();
    e.stopPropagation();
    const rect = this.wrapper.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);
    const zoomDelta = -e.deltaY * this.options.zoomSensitivity;
    const newScale = this.scale * (1 + zoomDelta);
    const clampedScale = Math.max(0.1, Math.min(20, newScale));
    const scaleRatio = clampedScale / this.scale;
    this.tx = this.tx * scaleRatio + offsetX * (1 - scaleRatio);
    this.ty = this.ty * scaleRatio + offsetY * (1 - scaleRatio);
    this.scale = clampedScale;
    this.applyTransform();
  }
  // ─── Zoom in/out buttons ──────────────────────────────────────
  zoomIn() {
    const newScale = Math.min(20, this.scale * 1.15);
    const scaleRatio = newScale / this.scale;
    this.tx = this.tx * scaleRatio;
    this.ty = this.ty * scaleRatio;
    this.scale = newScale;
    this.applyTransform();
  }
  zoomOut() {
    const newScale = Math.max(0.1, this.scale / 1.15);
    const scaleRatio = newScale / this.scale;
    this.tx = this.tx * scaleRatio;
    this.ty = this.ty * scaleRatio;
    this.scale = newScale;
    this.applyTransform();
  }
  // ─── Pan ──────────────────────────────────────────────────────
  pan(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this.applyTransform();
  }
  // ─── Mouse drag → Pan ─────────────────────────────────────────
  handleMouseDown(e) {
    if (e.button !== 0)
      return;
    if (e.target.closest("." + CLASSES.CONTROL_BTN))
      return;
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartTx = this.tx;
    this.dragStartTy = this.ty;
    this.wrapper.classList.add("dragging");
    e.preventDefault();
  }
  handleMouseMove(e) {
    if (!this.dragging)
      return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.tx = this.dragStartTx + dx;
    this.ty = this.dragStartTy + dy;
    this.applyTransform();
  }
  handleMouseUp(_e) {
    if (!this.dragging)
      return;
    this.dragging = false;
    this.wrapper.classList.remove("dragging");
  }
  // ─── Fit to canvas ─────────────────────────────────────────────
  /** Scale and center the diagram to fit within the wrapper */
  fitToCanvas() {
    if (!this.wrapper || !this.svgEl)
      return;
    const isFs = !!this.fullscreenOverlay;
    const viewW = isFs ? window.innerWidth : this.wrapper.getBoundingClientRect().width;
    const viewH = isFs ? window.innerHeight : this.wrapper.getBoundingClientRect().height;
    if (viewW <= 0 || viewH <= 0)
      return;
    const prevScale = this.scale;
    const prevTx = this.tx;
    const prevTy = this.ty;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
    const svgRect = this.svgEl.getBoundingClientRect();
    const svgW = svgRect.width || parseFloat(this.svgEl.getAttribute("width") || "0") || 400;
    const svgH = svgRect.height || parseFloat(this.svgEl.getAttribute("height") || "0") || 300;
    if (svgW <= 0 || svgH <= 0) {
      this.scale = prevScale;
      this.tx = prevTx;
      this.ty = prevTy;
      this.applyTransform();
      return;
    }
    const pad = 1;
    const scaleX = viewW * pad / svgW;
    const scaleY = viewH * pad / svgH;
    this.scale = Math.max(0.3, Math.min(scaleX, scaleY, 5));
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
  }
  /** Copy mermaid source code without ``` fences */
  async copyCode() {
    let code = this.sourceCode;
    if (!code && this.options.getSourceCode) {
      code = await this.options.getSourceCode();
    }
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        new import_obsidian.Notice("Mermaid code copied to clipboard");
      }).catch(() => {
        new import_obsidian.Notice("Failed to copy");
      });
    } else {
      new import_obsidian.Notice("No code to copy");
    }
  }
  /** @deprecated Use fitToCanvas() instead */
  reset() {
    this.fitToCanvas();
  }
  // ─── Keyboard handler ─────────────────────────────────────────
  handleKeyDown(_e) {
  }
  // ─── Apply CSS transform ──────────────────────────────────────
  applyTransform() {
    if (!this.content)
      return;
    this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.content.style.transformOrigin = "center center";
  }
  /** Get the underlying SVG element */
  getSvg() {
    return this.svgEl || null;
  }
  /** Get the wrapper element (for embedding) */
  getWrapper() {
    return this.wrapper;
  }
};

// src/SplitModal.ts
var SplitModal = class extends import_obsidian2.Modal {
  constructor(app, options) {
    super(app);
    this.renderTimer = null;
    this.splitView = true;
    this.dirty = false;
    this.options = options;
  }
  onOpen() {
    const { contentEl, containerEl } = this;
    contentEl.addClass(CLASSES.SPLIT_MODAL);
    if (this.options.startInPreviewOnly) {
      this.splitView = false;
    }
    const modalEl = containerEl.querySelector(".modal");
    if (modalEl) {
      modalEl.style.width = "90vw";
      modalEl.style.height = "85vh";
      modalEl.style.maxWidth = "95vw";
      modalEl.style.maxHeight = "90vh";
    }
    const toolbar = contentEl.createDiv({ cls: CLASSES.SPLIT_TOOLBAR });
    toolbar.createEl("span", { text: "Mermaid Canvas", cls: "mermaid-canvas-title" });
    if (!this.options.startInPreviewOnly) {
      const toggleBtn = toolbar.createEl("button", {
        text: "Preview Only",
        cls: CLASSES.CONTROL_BTN,
        title: "Toggle between split view and preview-only mode"
      });
      toggleBtn.addEventListener("click", () => {
        this.splitView = !this.splitView;
        toggleBtn.textContent = this.splitView ? "Preview Only" : "Split View";
        this.applyViewMode();
      });
    }
    const main = contentEl.createDiv({ cls: "mermaid-canvas-main" });
    const leftPanel = main.createDiv({ cls: CLASSES.SPLIT_LEFT });
    this.textarea = leftPanel.createEl("textarea", { cls: "mermaid-canvas-textarea" });
    this.textarea.value = this.options.initialCode;
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("placeholder", "Enter Mermaid code here...\n\ne.g.\ngraph TD\n    A-->B\n    B-->C");
    this.rightPanel = main.createDiv({ cls: CLASSES.SPLIT_RIGHT });
    this.canvasView = new CanvasView(this.rightPanel, {
      zoomSensitivity: this.options.zoomSensitivity
    });
    this.canvasView.mountFromCode(this.options.initialCode, this.options.sourcePath);
    this.textarea.addEventListener("input", () => {
      this.dirty = true;
      this.scheduleRender();
    });
    this.applyViewMode();
  }
  scheduleRender() {
    if (this.renderTimer)
      clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      const code = this.textarea.value;
      this.canvasView.updateCode(code, this.options.sourcePath);
    }, RENDER_DEBOUNCE);
  }
  applyViewMode() {
    const main = this.contentEl.querySelector(".mermaid-canvas-main");
    if (!main)
      return;
    if (this.splitView) {
      main.classList.remove("preview-only");
      main.classList.add("split-view");
    } else {
      main.classList.remove("split-view");
      main.classList.add("preview-only");
    }
  }
  onClose() {
    if (this.dirty && this.options.onSave) {
      const finalCode = this.textarea?.value ?? this.options.initialCode;
      this.options.onSave(finalCode);
    }
    if (this.renderTimer)
      clearTimeout(this.renderTimer);
    this.canvasView?.destroy();
    this.contentEl.empty();
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var DEFAULT_SETTINGS3 = {
  zoomSensitivity: 5,
  defaultSplitView: true,
  mermaidTheme: "default"
};
var MermaidCanvasSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Mermaid Canvas Settings" });
    new import_obsidian3.Setting(containerEl).setName("Zoom sensitivity").setDesc("Controls how fast zoom responds to the mouse wheel. Lower = smoother but slower.").addSlider(
      (slider) => slider.setLimits(1, 10, 1).setValue(this.plugin.settings.zoomSensitivity).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.zoomSensitivity = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Default split view").setDesc("When enabled, opening a mermaid block shows code + preview side by side.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.defaultSplitView).onChange(async (value) => {
        this.plugin.settings.defaultSplitView = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Mermaid theme").setDesc("The color theme used for rendered diagrams.").addDropdown(
      (dropdown) => dropdown.addOption("default", "Default").addOption("forest", "Forest").addOption("dark", "Dark").addOption("neutral", "Neutral").addOption("base", "Base").setValue(this.plugin.settings.mermaidTheme).onChange(async (value) => {
        this.plugin.settings.mermaidTheme = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var MermaidCanvasPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.canvasViews = /* @__PURE__ */ new Set();
    this.observer = null;
    this.retryTimer = null;
    // ─── Scanning ──────────────────────────────────────────────────
    this.MERMAID_SELECTORS = ".mermaid, .block-language-mermaid";
    this.LIVE_SELECTORS = ".mermaid, .block-language-mermaid, .cm-lang-mermaid";
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MermaidCanvasSettingTab(this.app, this));
    this.addCommand({
      id: "insert-mermaid-canvas",
      name: "Mermaid Canvas",
      editorCallback: (editor, view) => {
        if (view instanceof import_obsidian4.MarkdownView)
          this.insertAndEdit(editor, view);
      }
    });
    this.registerMarkdownPostProcessor((element, context) => {
      if (element.closest("." + CLASSES.SPLIT_MODAL))
        return;
      this.scanElement(element, context.sourcePath);
    });
    this.scheduleRetryScan();
    this.setupObserver();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        setTimeout(() => {
          this.setupObserver();
          this.scheduleRetryScan();
        }, 150);
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.cleanupDetached();
        this.setupObserver();
        this.scheduleRetryScan();
      })
    );
    this.registerDomEvent(document, "click", (evt) => {
      const target = evt.target;
      const editBtn = target.closest(".edit-block-button");
      if (!editBtn)
        return;
      let mermaidEl = editBtn.closest(this.LIVE_SELECTORS);
      if (!mermaidEl) {
        const wrapper = editBtn.closest("." + CLASSES.CANVAS_WRAPPER);
        if (wrapper)
          mermaidEl = wrapper.querySelector(this.MERMAID_SELECTORS);
      }
      if (!mermaidEl)
        return;
      let container;
      if (mermaidEl.matches(this.MERMAID_SELECTORS)) {
        container = mermaidEl;
      } else if (mermaidEl.matches(".cm-lang-mermaid")) {
        container = mermaidEl;
      } else {
        container = mermaidEl.querySelector(this.MERMAID_SELECTORS);
      }
      if (!container)
        return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      let srcCode = container.getAttribute("data-mermaid-src") ?? "";
      let blockIdx = -1;
      if (!srcCode) {
        const all = [...document.querySelectorAll(this.LIVE_SELECTORS)].filter((el) => !el.closest("." + CLASSES.CANVAS_WRAPPER));
        all.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const idx = all.indexOf(container);
        const codes = this.readAllEditorBlocks(
          this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)?.file?.path ?? ""
        );
        if (idx >= 0 && idx < codes.length) {
          srcCode = codes[idx];
          blockIdx = idx;
        }
      }
      const sourcePath = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)?.file?.path ?? "";
      this.editBySource(srcCode, sourcePath, blockIdx);
    }, true);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS3, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getEffectiveSensitivity() {
    const t = (this.settings.zoomSensitivity - 1) / 9;
    return ZOOM_SENSITIVITY_MIN + t * (ZOOM_SENSITIVITY_MAX - ZOOM_SENSITIVITY_MIN);
  }
  // ─── /mermaid ──────────────────────────────────────────────────
  insertAndEdit(editor, view) {
    new SplitModal(this.app, {
      initialCode: "",
      sourcePath: view.file?.path ?? "",
      zoomSensitivity: this.getEffectiveSensitivity(),
      onSave: (code) => {
        if (!code.trim())
          return;
        editor.replaceRange("\n```mermaid\n" + code + "\n```\n", editor.getCursor());
      }
    }).open();
  }
  scanElement(element, sourcePath) {
    if (element.closest("." + CLASSES.SPLIT_MODAL))
      return;
    const containers = [...element.querySelectorAll(this.MERMAID_SELECTORS)];
    if (containers.length === 0)
      return;
    const editorCodes = this.readAllEditorBlocks(sourcePath);
    let pos = 0;
    for (const c of containers) {
      if (c.closest("." + CLASSES.CANVAS_WRAPPER)) {
        pos++;
        continue;
      }
      if (c.closest("." + CLASSES.SPLIT_MODAL)) {
        pos++;
        continue;
      }
      if (pos < editorCodes.length)
        c.setAttribute("data-mermaid-src", editorCodes[pos]);
      this.enhanceBlock(c, sourcePath);
      pos++;
    }
  }
  readAllEditorBlocks(sourcePath) {
    const codes = [];
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (view?.editor && view.file?.path === sourcePath) {
      const regex = /```mermaid\n([\s\S]*?)```/g;
      let m;
      while ((m = regex.exec(view.editor.getValue())) !== null)
        codes.push(m[1].trimEnd());
    }
    return codes;
  }
  scanActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return 0;
    const sourcePath = view.file?.path ?? "";
    const containers = view.containerEl.querySelectorAll(this.MERMAID_SELECTORS);
    let count = 0;
    for (const c of containers) {
      if (c.closest("." + CLASSES.CANVAS_WRAPPER))
        continue;
      if (c.closest("." + CLASSES.SPLIT_MODAL))
        continue;
      if (c.querySelector("svg")) {
        this.enhanceBlock(c, sourcePath);
        count++;
      }
    }
    return count;
  }
  scheduleRetryScan(delay = 200) {
    if (this.retryTimer)
      clearTimeout(this.retryTimer);
    const retry = (remaining) => {
      this.scanActiveView();
      if (remaining > 0) {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
        if (view) {
          const unenhanced = [...view.containerEl.querySelectorAll(this.MERMAID_SELECTORS)].filter((c) => !c.closest("." + CLASSES.CANVAS_WRAPPER) && !c.querySelector("svg"));
          if (unenhanced.length > 0)
            this.retryTimer = setTimeout(() => retry(remaining - 1), delay);
        }
      }
    };
    this.retryTimer = setTimeout(() => retry(5), delay);
  }
  // ─── MutationObserver ──────────────────────────────────────────
  setupObserver() {
    this.observer?.disconnect();
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return;
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement))
            continue;
          if (node.tagName === "svg" || node.querySelector("svg")) {
            const mc = node.closest?.(this.MERMAID_SELECTORS);
            if (mc && !mc.closest("." + CLASSES.CANVAS_WRAPPER) && !mc.closest("." + CLASSES.SPLIT_MODAL)) {
              this.enhanceBlock(mc, view.file?.path ?? "");
            }
          }
        }
      }
    });
    this.observer.observe(view.containerEl, { childList: true, subtree: true });
  }
  // ─── Enhance ───────────────────────────────────────────────────
  enhanceBlock(container, sourcePath) {
    const svg = container.querySelector("svg");
    if (!svg)
      return;
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (w < 10 && h < 10)
      return;
    const attrCode = container.getAttribute("data-mermaid-src") ?? "";
    const blockIdx = this.computeIdxForContainer(container);
    const editorCodes = this.readAllEditorBlocks(sourcePath);
    console.log("[MermaidCanvas] enhanceBlock: attrCode=", attrCode, "blockIdx=", blockIdx, "editorCodes=", editorCodes);
    const srcCode = attrCode || (blockIdx >= 0 && blockIdx < editorCodes.length ? editorCodes[blockIdx] : "");
    try {
      const cv = new CanvasView(container, {
        zoomSensitivity: this.getEffectiveSensitivity(),
        getSourceCode: async () => srcCode
      });
      cv.mount(svg);
      if (!cv.getWrapper())
        return;
      this.canvasViews.add(cv);
    } catch (err) {
      console.warn("Mermaid Canvas: enhance failed", err);
    }
  }
  /** Find the index of this container among all mermaid blocks (even inside wrappers) */
  computeIdxForContainer(container) {
    const sel = container.matches(".cm-lang-mermaid") ? ".cm-lang-mermaid" : this.MERMAID_SELECTORS;
    const all = [...document.querySelectorAll(sel)];
    all.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    return all.indexOf(container);
  }
  // ─── Edit via button interception ──────────────────────────────
  editBySource(srcCode, sourcePath, blockIdx) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    new SplitModal(this.app, {
      initialCode: srcCode,
      sourcePath,
      zoomSensitivity: this.getEffectiveSensitivity(),
      onSave: (newCode) => {
        if (view?.editor) {
          const c = newCode.endsWith("\n") ? newCode : newCode + "\n";
          const regex = /```mermaid\n[\s\S]*?```/g;
          let m;
          let i = 0;
          while ((m = regex.exec(view.editor.getValue())) !== null) {
            if (i === blockIdx) {
              if (!newCode.trim()) {
                view.editor.replaceRange(
                  "",
                  view.editor.offsetToPos(m.index),
                  view.editor.offsetToPos(m.index + m[0].length)
                );
              } else {
                view.editor.replaceRange(
                  c,
                  view.editor.offsetToPos(m.index + "```mermaid\n".length),
                  view.editor.offsetToPos(m.index + m[0].length - "\n```".length)
                );
              }
              break;
            }
            i++;
          }
        }
        setTimeout(() => {
          this.cleanupDetached();
          this.setupObserver();
          this.scheduleRetryScan(300);
        }, 300);
      }
    }).open();
  }
  // ─── Cleanup ───────────────────────────────────────────────────
  cleanupDetached() {
    const detached = [...this.canvasViews].filter((cv) => !cv.getWrapper()?.isConnected);
    for (const cv of detached) {
      cv.destroy();
      this.canvasViews.delete(cv);
    }
  }
  onunload() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.retryTimer)
      clearTimeout(this.retryTimer);
    for (const cv of this.canvasViews)
      cv.destroy();
    this.canvasViews.clear();
  }
};
