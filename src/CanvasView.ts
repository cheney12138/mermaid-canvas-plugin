import { setIcon, MarkdownRenderer, Component } from 'obsidian';
import { CLASSES, CANVAS_DEFAULTS } from './constants';

export interface CanvasOptions {
  zoomSensitivity: number;
  onDelete?: () => void;
  readOnly?: boolean;
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
  private svgEl!: HTMLElement;
  private sourceCode = '';

  // Transform state (kept in memory, not read from DOM)
  private scale = 1;
  private tx = 0;
  private ty = 0;

  // Drag state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartTx = 0;
  private dragStartTy = 0;

  // IntersectionObserver for deferred fitToCanvas when block is off-screen at mount time
  private visibilityObserver: IntersectionObserver | null = null;

  // Fullscreen state
  private fullscreenOverlay: HTMLElement | null = null;
  private fullscreenKeyDown: ((e: KeyboardEvent) => void) | null = null;
  // Saved CSS state (anything we mutate in enterFullscreen)
  private fsSave: Record<string, string> = {};

  // ─── Fullscreen ───────────────────────────────────────────────

  enterFullscreen(): void {
    if (this.fullscreenOverlay || !this.wrapper) return;

    const doc = this.wrapper.ownerDocument;

    // Save original state
    const keys = ['display','width','height','maxWidth','maxHeight','minHeight',
                  'alignItems','justifyContent','borderRadius','boxShadow'];
    this.fsSave = {};
    for (const k of keys) this.fsSave[k] = this.wrapper.style.getPropertyValue(k);
    const originalParent = this.wrapper.parentElement;
    // Store for exitFullscreen to access
    (this as any)._fsParent = originalParent;

    // Create overlay
    this.fullscreenOverlay = doc.createElement('div');
    this.fullscreenOverlay.classList.add(CLASSES.FULLSCREEN_OVERLAY);

    // Move the live wrapper into the overlay (no SVG cloning)
    this.fullscreenOverlay.appendChild(this.wrapper);

    // Expand wrapper to fill viewport
    this.wrapper.style.display = 'flex';
    this.wrapper.style.alignItems = 'center';
    this.wrapper.style.justifyContent = 'center';
    this.wrapper.style.width = '100vw';
    this.wrapper.style.height = '100vh';
    this.wrapper.style.maxWidth = 'none';
    this.wrapper.style.maxHeight = 'none';
    this.wrapper.style.minHeight = '0';
    this.wrapper.style.borderRadius = '0';
    this.wrapper.style.boxShadow = 'none';

    // Close button
    const closeBtn = this.fullscreenOverlay.createEl('button', {
      cls: 'mermaid-canvas-fs-close',
      title: 'Exit fullscreen (Esc)'
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.exitFullscreen());

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
    const fit = () => this.fitToCanvas();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
    setTimeout(fit, 400);
  }

  exitFullscreen(): void {
    if (this.fullscreenKeyDown) {
      document.removeEventListener('keydown', this.fullscreenKeyDown);
      this.fullscreenKeyDown = null;
    }

    // Remove overlay first (so wrapper can be moved back safely)
    const overlay = this.fullscreenOverlay;
    this.fullscreenOverlay = null;
    if (overlay) overlay.remove();

    const originalParent = (this as any)._fsParent as HTMLElement | null;
    (this as any)._fsParent = undefined;
    if (this.wrapper && originalParent) {
      // Reset transform to identity before moving back
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.applyTransform();

      // Restore all saved styles
      for (const k of Object.keys(this.fsSave)) {
        (this.wrapper.style as any)[k] = this.fsSave[k];
      }
      this.fsSave = {};

      // Move wrapper back to original parent
      originalParent.appendChild(this.wrapper);

      // Re-fit after returning to normal size. Needs to wait for browser
      // to relayout the wrapper inside the document flow (CSS may differ).
      // Try at multiple timings to catch the earliest valid layout.
      const fit = () => { if (!this.fullscreenOverlay) this.fitToCanvas(); };
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fit)));
      setTimeout(fit, 200);
      setTimeout(fit, 500);
    }
  }

  // Bound handlers (for cleanup)
  private onWheel: (e: WheelEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;

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

    // Hide source code: collapse any text content and non-SVG children
    if (mermaidContainer.childNodes.length > 0) {
      // Check if the container itself is a <pre> with text content
      if (mermaidContainer.tagName === 'PRE') {
        // Move SVG out, hide the PRE's text
        const svg = mermaidContainer.querySelector('svg');
        if (svg && mermaidContainer.parentElement) {
          mermaidContainer.parentElement.insertBefore(svg, mermaidContainer);
        }
      }
      // Hide all non-SVG children
      for (const child of [...mermaidContainer.children]) {
        if (child.tagName !== 'svg' && !(child as HTMLElement).querySelector?.('svg')) {
          (child as HTMLElement).style.display = 'none';
        }
      }
      // Also hide text nodes by collapsing the container if it's a PRE
      if (mermaidContainer.tagName === 'PRE') {
        mermaidContainer.style.fontSize = '0';
        mermaidContainer.style.color = 'transparent';
        mermaidContainer.style.userSelect = 'none';
      }
    }
    // Insert the wrapper at the same position and move container in
    insertionPoint.insertBefore(this.wrapper, mermaidContainer);
    this.content.appendChild(mermaidContainer);

    // Refresh SVG reference
    const foundSvg = mermaidContainer.querySelector('svg');
    if (foundSvg) this.svgEl = foundSvg as unknown as HTMLElement;

    // Build control bar
    this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
    this.buildControlButtons();

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

  private bindEvents(): void {
    this.wrapper.addEventListener('wheel', this.onWheel, { passive: false });
    this.wrapper.addEventListener('mousedown', this.onMouseDown);
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
    if ((e.target as HTMLElement).closest('.' + CLASSES.CONTROL_BTN)) return;

    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartTx = this.tx;
    this.dragStartTy = this.ty;
    this.wrapper.classList.add('dragging');

    e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.tx = this.dragStartTx + dx;
    this.ty = this.dragStartTy + dy;
    this.applyTransform();
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.wrapper.classList.remove('dragging');
  }

  // ─── Fit to canvas ─────────────────────────────────────────────

  /** Scale and center the diagram to fit within the wrapper */
  fitToCanvas(): void {
    if (!this.wrapper || !this.svgEl) return;

    // In fullscreen, use window dimensions; otherwise use wrapper dimensions
    const isFs = !!this.fullscreenOverlay;
    const viewW = isFs ? window.innerWidth : this.wrapper.getBoundingClientRect().width;
    const viewH = isFs ? window.innerHeight : this.wrapper.getBoundingClientRect().height;

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
    // Fullscreen keeps its own sizing; height is saved/restored by enterFullscreen/exitFullscreen.
    if (!isFs) {
      this.wrapper.style.height = Math.ceil(svgH * this.scale + 24) + 'px';
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

  private showToast(message: string): void {
    const toast = document.createElement('div');
    toast.className = 'mermaid-canvas-toast';
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
    this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.content.style.transformOrigin = 'center center';
  }

  /** Get the underlying SVG element */
  getSvg(): HTMLElement | null {
    return this.svgEl || null;
  }

  /** Get the wrapper element (for embedding) */
  setSourceCode(code: string): void { this.sourceCode = code; }
  setOnDelete(fn: (() => void) | undefined): void { this.options.onDelete = fn; }
  deleteBlock(): void { this.options.onDelete?.(); }
  getWrapper(): HTMLElement {
    return this.wrapper;
  }
}
