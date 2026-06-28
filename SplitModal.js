import { Modal } from 'obsidian';
import { CanvasView } from './CanvasView';
import { CLASSES, RENDER_DEBOUNCE } from './constants';
/**
 * SplitModal — a split-view modal for editing Mermaid code with live preview.
 * Left: textarea for mermaid code. Right: CanvasView with rendered diagram.
 */
export class SplitModal extends Modal {
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
        // Respect the startInPreviewOnly option
        if (this.options.startInPreviewOnly) {
            this.splitView = false;
        }
        // Set modal dimensions via JS for reliable sizing
        const modalEl = containerEl.querySelector('.modal');
        if (modalEl) {
            modalEl.style.width = '90vw';
            modalEl.style.height = '85vh';
            modalEl.style.maxWidth = '95vw';
            modalEl.style.maxHeight = '90vh';
        }
        // ── Toolbar ──
        const toolbar = contentEl.createDiv({ cls: CLASSES.SPLIT_TOOLBAR });
        toolbar.createEl('span', { text: 'Mermaid Canvas', cls: 'mermaid-canvas-title' });
        // Toggle button: hidden when forced preview-only (reading mode)
        if (!this.options.startInPreviewOnly) {
            const toggleBtn = toolbar.createEl('button', {
                text: 'Preview Only',
                cls: CLASSES.CONTROL_BTN,
                title: 'Toggle between split view and preview-only mode',
            });
            toggleBtn.addEventListener('click', () => {
                this.splitView = !this.splitView;
                toggleBtn.textContent = this.splitView ? 'Preview Only' : 'Split View';
                this.applyViewMode();
            });
        }
        // ── Main area ──
        const main = contentEl.createDiv({ cls: 'mermaid-canvas-main' });
        // Left: code editor
        const leftPanel = main.createDiv({ cls: CLASSES.SPLIT_LEFT });
        this.textarea = leftPanel.createEl('textarea', { cls: 'mermaid-canvas-textarea' });
        this.textarea.value = this.options.initialCode;
        this.textarea.setAttribute('spellcheck', 'false');
        this.textarea.setAttribute('placeholder', 'Enter Mermaid code here...\n\ne.g.\ngraph TD\n    A-->B\n    B-->C');
        // Right: preview canvas
        this.rightPanel = main.createDiv({ cls: CLASSES.SPLIT_RIGHT });
        // Initialize CanvasView in preview mode
        this.canvasView = new CanvasView(this.rightPanel, {
            zoomSensitivity: this.options.zoomSensitivity,
        });
        // Initial render
        this.canvasView.mountFromCode(this.options.initialCode, this.options.sourcePath);
        // Live preview on input (only meaningful in split view)
        this.textarea.addEventListener('input', () => {
            this.dirty = true;
            this.scheduleRender();
        });
        // Apply the initial view mode
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
        const main = this.contentEl.querySelector('.mermaid-canvas-main');
        if (!main)
            return;
        if (this.splitView) {
            main.classList.remove('preview-only');
            main.classList.add('split-view');
        }
        else {
            main.classList.remove('split-view');
            main.classList.add('preview-only');
        }
    }
    onClose() {
        // Only save if the user actually modified the code (and onSave is provided)
        if (this.dirty && this.options.onSave) {
            const finalCode = this.textarea?.value ?? this.options.initialCode;
            this.options.onSave(finalCode);
        }
        // Cleanup
        if (this.renderTimer)
            clearTimeout(this.renderTimer);
        this.canvasView?.destroy();
        this.contentEl.empty();
    }
}
