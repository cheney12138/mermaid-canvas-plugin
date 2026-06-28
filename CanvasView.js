import { setIcon, MarkdownRenderer, Component } from 'obsidian';
import { CLASSES, DEFAULT_SETTINGS } from './constants';
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
    constructor(container, options) {
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
        this.fullscreenCV = null;
        this.fullscreenKeyDown = null;
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
    /** Wrap an already-rendered SVG element (inline reading-view usage) */
    mount(svgElement) {
        this.svgEl = svgElement;
        const ok = this.buildDOM();
        if (!ok) {
            // buildDOM failed — keep the original rendering, skip canvas enhancement
            console.warn('Mermaid Canvas: failed to build DOM — SVG may not be in expected container');
            return;
        }
        this.bindEvents();
    }
    /** Render mermaid code to SVG, then mount (split-modal usage) */
    async mountFromCode(code, sourcePath) {
        this.wrapper = this.container.createDiv({ cls: CLASSES.CANVAS_WRAPPER });
        this.content = this.wrapper.createDiv({ cls: CLASSES.CANVAS_CONTENT });
        this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
        this.buildControlButtons();
        this.bindEvents();
        await this.renderCode(code, sourcePath);
    }
    /** Re-render with new mermaid code */
    async updateCode(code, sourcePath) {
        await this.renderCode(code, sourcePath);
    }
    async renderCode(code, sourcePath) {
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
            if (gen !== this.renderGen)
                return;
            // Mermaid rendering is internally async — SVG may appear a few ticks later.
            // Poll briefly for the SVG to arrive.
            const svg = await this.waitForSvg(wrapper, 2000);
            // Check again — component may have been unloaded during wait
            if (gen !== this.renderGen)
                return;
            if (svg) {
                this.svgEl = svg;
                // Remove any max-width/height constraints that Obsidian might add
                svg.removeAttribute('width');
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                this.applyTransform();
            }
            else {
                wrapper.createEl('p', { text: '⚠️ Rendering failed — check your Mermaid syntax.', cls: 'mermaid-canvas-error' });
            }
        }
        catch {
            if (gen === this.renderGen) {
                wrapper.createEl('p', { text: '⚠️ Rendering error — invalid Mermaid syntax.', cls: 'mermaid-canvas-error' });
            }
        }
    }
    /** Poll for an SVG to appear inside the container (handles async mermaid rendering) */
    waitForSvg(el, timeout) {
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
    buildDOM() {
        // Find the mermaid container (.block-language-mermaid) that holds the SVG
        const mermaidContainer = (this.svgEl.closest('.block-language-mermaid')
            || this.svgEl.parentElement);
        if (!mermaidContainer)
            return false;
        // Find the insertion point: the parent of the mermaid container
        const insertionPoint = mermaidContainer.parentElement;
        if (!insertionPoint)
            return false;
        // Create wrapper and content divs (not yet in DOM)
        this.wrapper = document.createElement('div');
        this.wrapper.classList.add(CLASSES.CANVAS_WRAPPER);
        this.content = document.createElement('div');
        this.content.classList.add(CLASSES.CANVAS_CONTENT);
        this.wrapper.appendChild(this.content);
        // Insert the wrapper at the same position as the mermaid container,
        // then move the mermaid container into the wrapper's content div
        insertionPoint.insertBefore(this.wrapper, mermaidContainer);
        this.content.appendChild(mermaidContainer);
        // Refresh SVG reference
        const foundSvg = mermaidContainer.querySelector('svg');
        if (foundSvg)
            this.svgEl = foundSvg;
        // Build control bar
        this.controlBar = this.wrapper.createDiv({ cls: CLASSES.CONTROL_BAR });
        this.buildControlButtons();
        return true;
    }
    buildControlButtons() {
        this.controlBar.empty();
        const buttons = [
            { icon: 'zoom-in', title: 'Zoom In', action: () => this.zoomIn() },
            { icon: 'zoom-out', title: 'Zoom Out', action: () => this.zoomOut() },
            { icon: 'maximize', title: 'Fullscreen', action: () => this.enterFullscreen() },
            { icon: 'rotate-ccw', title: 'Reset', action: () => this.reset() },
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
    bindEvents() {
        this.wrapper.addEventListener('wheel', this.onWheel, { passive: false });
        this.wrapper.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
        // keydown only needed for fullscreen — registered on enter, removed on exit
    }
    /** Remove all event listeners */
    destroy() {
        this.wrapper?.removeEventListener('wheel', this.onWheel);
        this.wrapper?.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        this.exitFullscreen();
        this.mdComponent?.unload();
        this.wrapper?.remove();
    }
    // ─── Wheel → Zoom ────────────────────────────────────────────
    handleWheel(e) {
        // Only zoom with Ctrl/Cmd+Wheel (matches two-finger pinch on trackpad).
        // Normal scroll passes through so the page can scroll, and mouse drag
        // handles panning. This avoids blocking page scroll in inline view.
        if (!e.ctrlKey && !e.metaKey)
            return;
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
    zoomIn() {
        const newScale = Math.min(20, this.scale * 1.15);
        const scaleRatio = newScale / this.scale;
        // Zoom toward center
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
        // Only left button
        if (e.button !== 0)
            return;
        // Don't start drag on control buttons
        if (e.target.closest('.' + CLASSES.CONTROL_BTN))
            return;
        this.dragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartTx = this.tx;
        this.dragStartTy = this.ty;
        this.wrapper.classList.add('dragging');
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
        this.wrapper.classList.remove('dragging');
    }
    // ─── Fullscreen ───────────────────────────────────────────────
    enterFullscreen() {
        if (this.fullscreenOverlay)
            return;
        const doc = this.wrapper.doc;
        this.fullscreenOverlay = doc.createElement('div');
        this.fullscreenOverlay.classList.add(CLASSES.FULLSCREEN_OVERLAY);
        // Create a fullscreen canvas container
        const fsContainer = this.fullscreenOverlay.createDiv({ cls: 'mermaid-canvas-fs-inner' });
        // Clone the SVG for fullscreen, preserving viewBox for correct sizing
        const svgClone = this.svgEl.cloneNode(true);
        fsContainer.appendChild(svgClone);
        // Create a new CanvasView inside fullscreen. Since mount() builds fresh
        // DOM from scratch (not relying on .block-language-mermaid), use the
        // fsContainer directly — mount() will call buildDOM() which handles the
        // parentElement fallback path.
        this.fullscreenCV = new CanvasView(fsContainer, this.options);
        this.fullscreenCV.mount(svgClone);
        // Close button
        const closeBtn = this.fullscreenOverlay.createEl('button', { cls: 'mermaid-canvas-fs-close', title: 'Exit fullscreen (Esc)' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.exitFullscreen());
        // Click on backdrop to close
        this.fullscreenOverlay.addEventListener('click', (e) => {
            if (e.target === this.fullscreenOverlay) {
                this.exitFullscreen();
            }
        });
        // Register keydown only while fullscreen is active
        this.fullscreenKeyDown = (e) => {
            if (e.key === 'Escape')
                this.exitFullscreen();
        };
        document.addEventListener('keydown', this.fullscreenKeyDown);
        doc.body.appendChild(this.fullscreenOverlay);
    }
    exitFullscreen() {
        if (this.fullscreenKeyDown) {
            document.removeEventListener('keydown', this.fullscreenKeyDown);
            this.fullscreenKeyDown = null;
        }
        if (this.fullscreenCV) {
            this.fullscreenCV.destroy();
            this.fullscreenCV = null;
        }
        if (this.fullscreenOverlay) {
            this.fullscreenOverlay.remove();
            this.fullscreenOverlay = null;
        }
    }
    // ─── Reset ────────────────────────────────────────────────────
    reset() {
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.applyTransform();
    }
    // ─── Keyboard handler ─────────────────────────────────────────
    handleKeyDown(_e) {
        // Fullscreen escape is handled via fullscreenKeyDown (registered per-instance).
        // Kept as no-op for interface consistency; real key handling is in fullscreenKeyDown.
    }
    // ─── Apply CSS transform ──────────────────────────────────────
    applyTransform() {
        if (!this.content)
            return;
        this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
        this.content.style.transformOrigin = 'center center';
    }
    /** Get the underlying SVG element */
    getSvg() {
        return this.svgEl || null;
    }
    /** Get the wrapper element (for embedding) */
    getWrapper() {
        return this.wrapper;
    }
}
