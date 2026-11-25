import { setIcon, MarkdownRenderer, Component, Keymap } from 'obsidian';
import type { PaneType } from 'obsidian';
import { CLASSES, CANVAS_DEFAULTS } from './constants';

export interface CanvasOptions {
  zoomSensitivity: number;
  onDelete?: () => void;
  onInternalLink?: (linkText: string, newLeaf?: PaneType | boolean) => void;
  readOnly?: boolean;
  // Editor/reading-view scroll position, so entering/exiting fullscreen doesn't
  // let the height change (during the DOM move + refit) drift the viewport.
  getScroll?: () => number | undefined;
  restoreScroll?: (scroll: number) => void;
}

/**
 * CanvasView — wraps a rendered mermaid SVG with adaptive sizing,
 * smooth zoom/pan, a control bar, and fullscreen support.
 *
 * Usage:
 *   const cv = new CanvasView(containerEl, options);
 *   cv.mount(svgElement);
 *   // later: cv.destroy();
 */
export class CanvasView {
  private container: HTMLElement;
  private options: CanvasOptions;

  // DOM
  private wrapper!: HTMLElement;
  private content!: HTMLElement;
  private controlBar!: HTMLElement;
  private exportBar!: HTMLElement;
  private svgEl!: HTMLElement;
  private sourceCode = '';

  // Transform state (kept in memory, not read from DOM)
  private scale = 1;
  private tx = 0;
  private ty = 0;

  // Drag state
  private dragging = false;
  private dragMoved = false;
  private suppressClick = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartTx = 0;
  private dragStartTy = 0;

  // IntersectionObserver for deferred fitToCanvas when block is off-screen at mount time
  private visibilityObserver: IntersectionObserver | null = null;

  // Fullscreen state
  private fullscreenOverlay: HTMLElement | null = null;
  private fullscreenKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private fullscreenOriginalParent: HTMLElement | null = null;
  // Saved inline style values to restore on exit (only ever touches properties
  // we ourselves set below, via setCssStyles — never a class toggle, since the
  // wrapper's height may already carry an inline value from fitToCanvas() and
  // a plain assignment is what reliably overrides that).
  private fsSave: Partial<CSSStyleDeclaration> = {};

  // ─── Fullscreen ───────────────────────────────────────────────
  //
  // Moves the wrapper into a document.body-level overlay without cloning
  // the SVG. Inline styles are saved and restored on exit.

  enterFullscreen(): void {
    if (this.fullscreenOverlay || !this.wrapper) return;

    const doc = this.wrapper.ownerDocument;
    const scroll = this.options.getScroll?.();

    const keys: (keyof CSSStyleDeclaration)[] = [
      'display', 'width', 'height', 'maxWidth', 'maxHeight', 'minHeight',
      'alignItems', 'justifyContent', 'borderRadius', 'boxShadow',
    ];
    this.fsSave = {};
    for (const k of keys) (this.fsSave as any)[k] = this.wrapper.style.getPropertyValue(String(k));

    const originalParent = this.wrapper.parentElement;
    this.fullscreenOriginalParent = originalParent;

    this.fullscreenOverlay = doc.createElement('div');
    this.fullscreenOverlay.classList.add(CLASSES.FULLSCREEN_OVERLAY);

    // Move the live wrapper into the overlay (no SVG cloning)
    this.fullscreenOverlay.appendChild(this.wrapper);

    // Expand wrapper to fill viewport
    this.wrapper.setCssStyles({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100vw',
      height: '100vh',
      maxWidth: 'none',
      maxHeight: 'none',
      minHeight: '0',
      borderRadius: '0',
      boxShadow: 'none',
    });

    // Close button
    const closeBtn = this.fullscreenOverlay.createEl('button', {
      cls: 'mermaid-canvas-fs-close',
      title: 'Exit fullscreen (Esc)'
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.exitFullscreen());

    this.fullscreenOverlay.addEventListener('click', (e) => {
      const link = (e.target as Element).closest('.internal-link');
      if (!link) return;
      const linkText = link.getAttribute('href') ?? link.textContent?.trim();
      if (!linkText || !this.options.onInternalLink) return;

      e.preventDefault();
      e.stopPropagation();
      const newLeaf = Keymap.isModEvent(e);
      this.exitFullscreen();
      this.options.onInternalLink(linkText, newLeaf);
    });

    // Click on backdrop to close
    this.fullscreenOverlay.addEventListener('click', (e) => {
      if (e.target === this.fullscreenOverlay) this.exitFullscreen();
    });

    // Escape key
    this.fullscreenKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.exitFullscreen();
    };
    doc.addEventListener('keydown', this.fullscreenKeyDown);

    doc.body.appendChild(this.fullscreenOverlay);

    // Fit diagram after layout. Multiple frames + backup timeout
    // because SVG needs time to relayout inside the new 100vw/100vh container.
    // Pulling the wrapper out of the document flow changes the height of
    // whatever's below it, which can drift the editor/reading-view scroll —
    // re-apply the position we captured above across the same timings.
    const fit = () => {
      this.fitToCanvas();
      if (scroll !== undefined) this.options.restoreScroll?.(scroll);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
    setTimeout(fit, 400);
  }

  exitFullscreen(): void {
    if (this.fullscreenKeyDown) {
      document.removeEventListener('keydown', this.fullscreenKeyDown);
      this.fullscreenKeyDown = null;
    }

    const scroll = this.options.getScroll?.();

    // Remove overlay first (so wrapper can be moved back safely)
    const overlay = this.fullscreenOverlay;
    this.fullscreenOverlay = null;
    if (overlay) overlay.remove();

    const originalParent = this.fullscreenOriginalParent;
    this.fullscreenOriginalParent = null;
    if (!this.wrapper) return;

    if (!originalParent?.isConnected) {
      // In live preview, the editor may have re-rendered this block's slot
      // while this instance was fullscreen — the original parent is gone or
      // replaced. Don't reinsert into a stale node; just drop this orphaned
      // instance instead of leaving it behind as a ghost.
      this.wrapper.remove();
      return;
    }

    // Reset transform to identity before moving back
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();

    // Restore all saved styles
    this.wrapper.setCssStyles(this.fsSave);
    this.fsSave = {};

    // Move wrapper back to original parent
    originalParent.appendChild(this.wrapper);

    // Re-fit after returning to normal size. Needs to wait for browser
    // to relayout the wrapper inside the document flow (CSS may differ).
    // Try at multiple timings to catch the earliest valid layout, re-applying
    // the pre-exit scroll position each time to counter any drift caused by
    // the wrapper's height settling back down.
    const fit = () => {
      if (this.fullscreenOverlay) return;
      this.fitToCanvas();
      if (scroll !== undefined) this.options.restoreScroll?.(scroll);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
    setTimeout(fit, 200);
    setTimeout(fit, 500);
  }

  // Bound handlers (for cleanup)
  private onWheel: (e: WheelEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onClickCapture: (e: MouseEvent) => void;
  private onDragStart: (e: DragEvent) => void;

  // Obsidian component for MarkdownRenderer (used in split modal context)
  private mdComponent: Component | null = null;

  // Render generation counter — prevents stale async renders from overwriting latest
  private renderGen = 0;

  constructor(container: HTMLElement, options?: Partial<CanvasOptions>) {
    this.container = container;
    this.options = { zoomSensitivity: CANVAS_DEFAULTS.zoomSensitivity, ...options };

    this.onWheel = this.handleWheel.bind(this);
    this.onMouseDown = this.handleMouseDown.bind(this);
    this.onMouseMove = this.handleMouseMove.bind(this);
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.onClickCapture = this.handleClickCapture.bind(this);
    this.onDragStart = this.handleDragStart.bind(this);
  }

  /** Wrap an already-rendered SVG element (inline reading-view usage) */
  mount(svgElement: Element): void {
    this.svgEl = svgElement as unknown as HTMLElement;
    const ok = this.buildDOM();
    if (!ok) {
      console.warn('Mermaid Canvas: failed to build DOM — SVG may not be in expected container');
      return;
    }
    this.bindEvents();

    // If the wrapper is already visible, fit immediately; otherwise defer until
    // it scrolls into view (wrapper has zero dimensions when off-screen).
    if (this.wrapper.getBoundingClientRect().width > 0) {
      this.fitToCanvas();
    } else {
      this.visibilityObserver = new IntersectionObserver((entries, observer) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          this.visibilityObserver = null;
          requestAnimationFrame(() => this.fitToCanvas());
        }
      }, { threshold: 0 });
      this.visibilityObserver.observe(this.wrapper);
    }
  }

  /** Render mermaid code to SVG, then mount (split-modal usage) */
  async mountFromCode(code: string, sourcePath: string): Promise<void> {
    this.wrapper = this.container.createDiv({ cls: CLASSES.CANVAS_WRAPPER });
    this.content = this.wrapper.createDiv({ cls: CLASSES.CANVAS_CONTENT });
    this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
    this.buildControlButtons();
    this.buildExportBar();
    this.bindEvents();

    await this.renderCode(code, sourcePath);
    // Default: fit diagram to available canvas width
    this.fitToCanvas();
  }

  /** Re-render with new mermaid code */
  async updateCode(code: string, sourcePath: string): Promise<void> {
    await this.renderCode(code, sourcePath);
    this.fitToCanvas();
  }

  private async renderCode(code: string, sourcePath: string): Promise<void> {
    // Bump generation counter to invalidate any in-flight renders
    const gen = ++this.renderGen;

    // Clean previous content
    this.content.empty();
    const wrapper = this.content.createDiv();
    wrapper.addClass('mermaid-canvas-render-target');

    if (!code.trim()) {
      wrapper.createEl('p', { text: 'Enter Mermaid code on the left...', cls: 'mermaid-canvas-placeholder' });
      return;
    }

    const mermaidBlock = '```mermaid\n' + code + '\n```';
    // Use a fresh component each render
    if (this.mdComponent) {
      this.mdComponent.unload();
    }
    this.mdComponent = new Component();
    this.mdComponent.load();

    try {
      await MarkdownRenderer.renderMarkdown(mermaidBlock, wrapper, sourcePath, this.mdComponent);

      // Discard stale renders
      if (gen !== this.renderGen) return;

      // Mermaid rendering is internally async — SVG may appear a few ticks later.
      // Poll briefly for the SVG to arrive.
      const svg = await this.waitForSvg(wrapper, 2000);

      // Check again — component may have been unloaded during wait
      if (gen !== this.renderGen) return;

      if (svg) {
        this.svgEl = svg as unknown as HTMLElement;
        // Remove any max-width/height constraints that Obsidian might add
        svg.removeAttribute('width');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        this.applyTransform();
      } else {
        wrapper.createEl('p', { text: '⚠️ Rendering failed — check your Mermaid syntax.', cls: 'mermaid-canvas-error' });
      }
    } catch {
      if (gen === this.renderGen) {
        wrapper.createEl('p', { text: '⚠️ Rendering error — invalid Mermaid syntax.', cls: 'mermaid-canvas-error' });
      }
    }
  }

  /** Poll for an SVG to appear inside the container (handles async mermaid rendering) */
  private waitForSvg(el: HTMLElement, timeout: number): Promise<SVGElement | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const svg = el.querySelector('svg');
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
  private buildDOM(): boolean {
    // Find the mermaid container (.block-language-mermaid) that holds the SVG
    const mermaidContainer = (this.svgEl.closest('.mermaid, .block-language-mermaid')
      || this.svgEl.parentElement) as HTMLElement | null;
    if (!mermaidContainer) return false;

    // Find the insertion point: the parent of the mermaid container
    const insertionPoint = mermaidContainer.parentElement;
    if (!insertionPoint) return false;

    // Create wrapper and content divs (not yet in DOM)
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add(CLASSES.CANVAS_WRAPPER);
    this.content = document.createElement('div');
    this.content.classList.add(CLASSES.CANVAS_CONTENT);
    this.wrapper.appendChild(this.content);

    // Hide source code: move SVG out of PRE, hide text via CSS class
    if (mermaidContainer.childNodes.length > 0) {
      if (mermaidContainer.tagName === 'PRE') {
        const svg = mermaidContainer.querySelector('svg');
        if (svg && mermaidContainer.parentElement) {
          mermaidContainer.parentElement.insertBefore(svg, mermaidContainer);
        }
      }
    }
    mermaidContainer.addClass('mermaid-canvas-source-hidden');
    // Insert the wrapper at the same position and move container in
    insertionPoint.insertBefore(this.wrapper, mermaidContainer);
    this.content.appendChild(mermaidContainer);

    // Refresh SVG reference
    const foundSvg = mermaidContainer.querySelector('svg');
    if (foundSvg) this.svgEl = foundSvg as unknown as HTMLElement;

    // Build control bar and export bar
    this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
    this.buildControlButtons();
    this.buildExportBar();

    return true;
  }

  private buildControlButtons(): void {
    this.controlBar.empty();

    const buttons = [
      { icon: 'zoom-in', title: 'Zoom In', action: () => this.zoomIn() },
      { icon: 'zoom-out', title: 'Zoom Out', action: () => this.zoomOut() },
      { icon: 'maximize', title: 'Fullscreen', action: () => this.enterFullscreen() },
      { icon: 'crop', title: 'Fit to canvas', action: () => this.fitToCanvas() },
      { icon: 'copy', title: 'Copy code', action: () => this.copyCode() },
      ...(!this.options.readOnly ? [{ icon: 'trash', title: 'Delete diagram', action: () => this.deleteBlock() }] : []),
    ];

    for (const { icon, title, action } of buttons) {
      const btn = this.controlBar.createEl('button', { cls: CLASSES.CONTROL_BTN, title });
      setIcon(btn, icon);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
    }
  }

  private buildExportBar(): void {
    this.exportBar = this.wrapper.createDiv({ cls: CLASSES.EXPORT_BAR });
    const btns = [
      { icon: 'image',    title: 'Export PNG', action: () => this.exportPng() },
      { icon: 'download', title: 'Export SVG', action: () => this.exportSvg() },
    ];
    for (const { icon, title, action } of btns) {
      const btn = this.exportBar.createEl('button', { cls: CLASSES.CONTROL_BTN, title });
      setIcon(btn, icon);
      btn.addEventListener('click', (e) => { e.stopPropagation(); action(); });
    }
  }

  private bindEvents(): void {
    this.wrapper.addEventListener('wheel', this.onWheel, { passive: false });
    this.wrapper.addEventListener('mousedown', this.onMouseDown);
    this.wrapper.addEventListener('click', this.onClickCapture, true);
    this.wrapper.addEventListener('dragstart', this.onDragStart);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    // keydown only needed for fullscreen — registered on enter, removed on exit
  }

  /** Remove all event listeners */
  destroy(): void {
    this.exitFullscreen();
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.wrapper?.removeEventListener('wheel', this.onWheel);
    this.wrapper?.removeEventListener('mousedown', this.onMouseDown);
    this.wrapper?.removeEventListener('click', this.onClickCapture, true);
    this.wrapper?.removeEventListener('dragstart', this.onDragStart);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    this.mdComponent?.unload();
    this.wrapper?.remove();
  }

  // ─── Wheel → Zoom ────────────────────────────────────────────

  private handleWheel(e: WheelEvent): void {
    // Only zoom with Ctrl/Cmd+Wheel (matches two-finger pinch on trackpad).
    // Normal scroll passes through so the page can scroll, and mouse drag
    // handles panning. This avoids blocking page scroll in inline view.
    if (!e.ctrlKey && !e.metaKey) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = this.wrapper.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);

    // Continuous zoom: scale change proportional to deltaY
    const zoomDelta = -e.deltaY * this.options.zoomSensitivity;
    const newScale = this.scale * (1 + zoomDelta);

    // Clamp scale
    const clampedScale = Math.max(0.1, Math.min(20, newScale));

    // Adjust translation so cursor position stays fixed
    const scaleRatio = clampedScale / this.scale;
    this.tx = this.tx * scaleRatio + offsetX * (1 - scaleRatio);
    this.ty = this.ty * scaleRatio + offsetY * (1 - scaleRatio);
    this.scale = clampedScale;

    this.applyTransform();
  }

  // ─── Zoom in/out buttons ──────────────────────────────────────

  zoomIn(): void {
    const newScale = Math.min(20, this.scale * 1.15);
    const scaleRatio = newScale / this.scale;
    // Zoom toward center
    this.tx = this.tx * scaleRatio;
    this.ty = this.ty * scaleRatio;
    this.scale = newScale;
    this.applyTransform();
  }

  zoomOut(): void {
    const newScale = Math.max(0.1, this.scale / 1.15);
    const scaleRatio = newScale / this.scale;
    this.tx = this.tx * scaleRatio;
    this.ty = this.ty * scaleRatio;
    this.scale = newScale;
    this.applyTransform();
  }

  // ─── Pan ──────────────────────────────────────────────────────

  private pan(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.applyTransform();
  }

  // ─── Mouse drag → Pan ─────────────────────────────────────────

  private handleMouseDown(e: MouseEvent): void {
    // Only left button
    if (e.button !== 0) return;
    // Don't start drag on control buttons
    if ((e.target as Element).closest('.' + CLASSES.CONTROL_BTN)) return;

    this.dragging = true;
    this.dragMoved = false;
    this.suppressClick = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartTx = this.tx;
    this.dragStartTy = this.ty;
    this.wrapper.classList.add('dragging');

    if (!(e.target as Element).closest('a, .internal-link, .external-link')) e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    if (!this.dragMoved && Math.hypot(dx, dy) < 3) return;
    this.dragMoved = true;
    this.tx = this.dragStartTx + dx;
    this.ty = this.dragStartTy + dy;
    this.applyTransform();
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.dragging) return;
    if (this.dragMoved) {
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
    }
    this.dragging = false;
    this.dragMoved = false;
    this.wrapper.classList.remove('dragging');
  }

  private handleClickCapture(e: MouseEvent): void {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  private handleDragStart(e: DragEvent): void {
    e.preventDefault();
  }

  // ─── Fit to canvas ─────────────────────────────────────────────

  /** Scale and center the diagram to fit within the wrapper */
  fitToCanvas(): void {
    if (!this.wrapper || !this.svgEl) return;

    const isFs = !!this.fullscreenOverlay;
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const viewW = wrapperRect.width;
    const viewH = wrapperRect.height;

    if (viewW <= 0 || viewH <= 0) return;

    // Get SVG natural size (reset scale temporarily to measure accurately)
    const prevScale = this.scale;
    const prevTx = this.tx;
    const prevTy = this.ty;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.applyTransform();

    const svgRect = this.svgEl.getBoundingClientRect();
    const svgW = svgRect.width || parseFloat(this.svgEl.getAttribute('width') || '0') || 400;
    const svgH = svgRect.height || parseFloat(this.svgEl.getAttribute('height') || '0') || 300;

    if (svgW <= 0 || svgH <= 0) {
      this.scale = prevScale; this.tx = prevTx; this.ty = prevTy;
      this.applyTransform();
      return;
    }

    const scaleX = viewW / svgW;
    const scaleY = viewH / svgH;
    this.scale = Math.max(0.3, Math.min(scaleX, scaleY, 5));
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();

    // In inline view, shrink wrapper to the rendered SVG height so there's no dead vertical space.
    // Skip in fullscreen (has its own sizing) and in SplitModal (right panel uses CSS height: 100%).
    const inModal = !!this.wrapper.closest('.' + CLASSES.SPLIT_MODAL);
    if (!isFs && !inModal) {
      this.wrapper.setCssStyles({ height: Math.ceil(svgH * this.scale + 24) + 'px' });
    }
  }

  copyCode(): void {
    if (this.sourceCode) {
      navigator.clipboard.writeText(this.sourceCode)
        .then(() => this.showToast('Mermaid code copied'))
        .catch(() => this.showToast('Copy failed'));
    } else {
      this.showToast('No code to copy');
    }
  }

  exportSvg(): void {
    if (!this.svgEl) { this.showToast('No diagram to export'); return; }
    const rect = this.svgEl.getBoundingClientRect();
    const clone = this.svgEl.cloneNode(true) as SVGElement;
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(rect.width || 800));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(rect.height || 600));
    const svgStr = new XMLSerializer().serializeToString(clone);
    this.download('diagram.svg', svgStr, 'image/svg+xml;charset=utf-8');
    this.showToast('SVG exported');
  }

  exportPng(): void {
    if (!this.svgEl) { this.showToast('No diagram to export'); return; }
    const rect = this.svgEl.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;
    const clone = this.svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) { this.showToast('Export failed'); URL.revokeObjectURL(url); return; }
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(png => {
        if (!png) { this.showToast('Export failed'); return; }
        this.download('diagram.png', png);
        this.showToast('PNG exported');
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.showToast('Export failed'); };
    img.src = url;
  }

  private download(filename: string, content: string | Blob, mimeType?: string): void {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType ?? 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private showToast(message: string, variant?: 'warning'): void {
    const toast = document.createElement('div');
    toast.className = 'mermaid-canvas-toast';
    if (variant) toast.classList.add(`mermaid-canvas-toast-${variant}`);
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('mermaid-canvas-toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, 1700);
  }

  /** @deprecated Use fitToCanvas() instead */
  reset(): void {
    this.fitToCanvas();
  }

  // ─── Apply CSS transform ──────────────────────────────────────

  private applyTransform(): void {
    if (!this.content) return;
    // transform-origin is static and lives in CSS (.mermaid-canvas-content); only the
    // per-frame transform itself needs to be set here.
    this.content.setCssStyles({
      transform: `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`,
    });
  }

  /** Get the underlying SVG element */
  getSvg(): HTMLElement | null {
    return this.svgEl || null;
  }

  /** Get the wrapper element (for embedding) */
  setSourceCode(code: string): void { this.sourceCode = code; }
  setOnDelete(fn: (() => void) | undefined): void { this.options.onDelete = fn; }
  deleteBlock(): void {
    this.showToast('Diagram deleted', 'warning');
    this.options.onDelete?.();
  }
  getWrapper(): HTMLElement {
    return this.wrapper;
  }
}
