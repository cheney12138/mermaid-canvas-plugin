import { Plugin, Editor, MarkdownView } from 'obsidian';
import { SplitModal } from './SplitModal';
import { CanvasView } from './CanvasView';
import {
  MermaidCanvasSettingTab,
  PluginSettings,
  DEFAULT_SETTINGS,
} from './settings';
import { CLASSES, ZOOM_SENSITIVITY_MIN, ZOOM_SENSITIVITY_MAX } from './constants';

export default class MermaidCanvasPlugin extends Plugin {
  settings!: PluginSettings;
  private canvasViews: Set<CanvasView> = new Set();
  private observer: MutationObserver | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MermaidCanvasSettingTab(this.app, this));

    this.addCommand({
      id: 'insert-mermaid-canvas',
      name: 'Mermaid Canvas',
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.insertAndEdit(editor, view);
      },
    });

    this.registerMarkdownPostProcessor((element, context) => {
      if (element.closest('.' + CLASSES.SPLIT_MODAL)) return;
      this.scanElement(element, context.sourcePath);
    });
    this.scheduleRetryScan();
    this.setupObserver();

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        setTimeout(() => { this.setupObserver(); this.scheduleRetryScan(); }, 150);
      })
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.cleanupDetached();
        this.setupObserver();
        this.scheduleRetryScan();
      })
    );

    // Intercept Obsidian's native edit-block button → open our SplitModal instead
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      const target = evt.target as HTMLElement;
      const editBtn = target.closest('.edit-block-button');
      if (!editBtn) return;
      let mermaidEl: HTMLElement | null = editBtn.closest<HTMLElement>(this.LIVE_SELECTORS);
      if (!mermaidEl) {
        const wrapper = editBtn.closest<HTMLElement>('.' + CLASSES.CANVAS_WRAPPER);
        if (wrapper) mermaidEl = wrapper.querySelector<HTMLElement>(this.MERMAID_SELECTORS);
      }
      if (!mermaidEl) return;
      let container: HTMLElement | null;
      if (mermaidEl.matches(this.MERMAID_SELECTORS)) {
        container = mermaidEl;
      } else if (mermaidEl.matches('.cm-lang-mermaid')) {
        container = mermaidEl;
      } else {
        container = mermaidEl.querySelector<HTMLElement>(this.MERMAID_SELECTORS);
      }
      if (!container) return;

      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      let srcCode = container.getAttribute('data-mermaid-src') ?? '';
      let blockIdx = -1;
      if (!srcCode) {
        const all = [...document.querySelectorAll<HTMLElement>(this.LIVE_SELECTORS)]
          .filter(el => !el.closest('.' + CLASSES.CANVAS_WRAPPER));
        all.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const idx = all.indexOf(container);
        const codes = this.readAllEditorBlocks(
          this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? ''
        );
        if (idx >= 0 && idx < codes.length) { srcCode = codes[idx]; blockIdx = idx; }
      }
      const sourcePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? '';
      this.editBySource(srcCode, sourcePath, blockIdx);
    }, true);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
  getEffectiveSensitivity(): number {
    const t = (this.settings.zoomSensitivity - 1) / 9;
    return ZOOM_SENSITIVITY_MIN + t * (ZOOM_SENSITIVITY_MAX - ZOOM_SENSITIVITY_MIN);
  }

  // ─── /mermaid ──────────────────────────────────────────────────

  private insertAndEdit(editor: Editor, view: MarkdownView): void {
    new SplitModal(this.app, {
      initialCode: '',
      sourcePath: view.file?.path ?? '',
      zoomSensitivity: this.getEffectiveSensitivity(),
      onSave: (code: string) => {
        if (!code.trim()) return;
        editor.replaceRange('\n```mermaid\n' + code + '\n```\n', editor.getCursor());
      },
    }).open();
  }

  // ─── Scanning ──────────────────────────────────────────────────

  private readonly MERMAID_SELECTORS = '.mermaid, .block-language-mermaid';
  private readonly LIVE_SELECTORS = '.mermaid, .block-language-mermaid, .cm-lang-mermaid';

  private scanElement(element: HTMLElement, sourcePath: string): void {
    if (element.closest('.' + CLASSES.SPLIT_MODAL)) return;
    const containers = [...element.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS)];
    if (containers.length === 0) return;

    const editorCodes = this.readAllEditorBlocks(sourcePath);
    let pos = 0;
    for (const c of containers) {
      if (c.closest('.' + CLASSES.CANVAS_WRAPPER)) { pos++; continue; }
      if (c.closest('.' + CLASSES.SPLIT_MODAL)) { pos++; continue; }
      if (pos < editorCodes.length) c.setAttribute('data-mermaid-src', editorCodes[pos]);
      this.enhanceBlock(c, sourcePath);
      pos++;
    }
  }

  private readAllEditorBlocks(sourcePath: string): string[] {
    const codes: string[] = [];
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.editor && view.file?.path === sourcePath) {
      const regex = /```mermaid\n([\s\S]*?)```/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(view.editor.getValue())) !== null) codes.push(m[1].trimEnd());
    }
    return codes;
  }

  private scanActiveView(): number {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return 0;
    const sourcePath = view.file?.path ?? '';
    const containers = view.containerEl.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS);
    let count = 0;
    for (const c of containers) {
      if (c.closest('.' + CLASSES.CANVAS_WRAPPER)) continue;
      if (c.closest('.' + CLASSES.SPLIT_MODAL)) continue;
      if (c.querySelector('svg')) { this.enhanceBlock(c, sourcePath); count++; }
    }
    return count;
  }

  private scheduleRetryScan(delay = 200): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const retry = (remaining: number) => {
      this.scanActiveView();
      if (remaining > 0) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const unenhanced = [...view.containerEl.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS)]
            .filter(c => !c.closest('.' + CLASSES.CANVAS_WRAPPER) && !c.querySelector('svg'));
          if (unenhanced.length > 0) this.retryTimer = setTimeout(() => retry(remaining - 1), delay);
        }
      }
    };
    this.retryTimer = setTimeout(() => retry(5), delay);
  }

  // ─── MutationObserver ──────────────────────────────────────────

  private setupObserver(): void {
    this.observer?.disconnect();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.tagName === 'svg' || node.querySelector('svg')) {
            const mc = node.closest?.(this.MERMAID_SELECTORS) as HTMLElement | null;
            if (mc && !mc.closest('.' + CLASSES.CANVAS_WRAPPER) && !mc.closest('.' + CLASSES.SPLIT_MODAL)) {
              this.enhanceBlock(mc, view.file?.path ?? '');
            }
          }
        }
      }
    });
    this.observer.observe(view.containerEl, { childList: true, subtree: true });
  }

  // ─── Enhance ───────────────────────────────────────────────────

  private enhanceBlock(container: HTMLElement, sourcePath: string): void {
    const svg = container.querySelector('svg');
    if (!svg) return;
    const w = parseFloat(svg.getAttribute('width') || '0');
    const h = parseFloat(svg.getAttribute('height') || '0');
    if (w < 10 && h < 10) return;

    // Compute srcCode reliably: use attribute or fallback based on DOM position
    const attrCode = container.getAttribute('data-mermaid-src') ?? '';
    const blockIdx = this.computeIdxForContainer(container);
    const editorCodes = this.readAllEditorBlocks(sourcePath);
    console.log('[MermaidCanvas] enhanceBlock: attrCode=', attrCode, 'blockIdx=', blockIdx, 'editorCodes=', editorCodes);
    const srcCode = attrCode || (blockIdx >= 0 && blockIdx < editorCodes.length ? editorCodes[blockIdx] : '');

    try {
      const cv = new CanvasView(container, {
        zoomSensitivity: this.getEffectiveSensitivity(),
        getSourceCode: async () => srcCode,
      });
      cv.mount(svg);
      if (!cv.getWrapper()) return;
      this.canvasViews.add(cv);
    } catch (err) {
      console.warn('Mermaid Canvas: enhance failed', err);
    }
  }

  /** Find the index of this container among all mermaid blocks (even inside wrappers) */
  private computeIdxForContainer(container: HTMLElement): number {
    // Only count same-type elements. Don't filter out wrapped ones —
    // the wrapper preserves document position, so the DOM order matches source order.
    const sel = container.matches('.cm-lang-mermaid') ? '.cm-lang-mermaid' : this.MERMAID_SELECTORS;
    const all = [...document.querySelectorAll<HTMLElement>(sel)];
    all.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    return all.indexOf(container);
  }

  // ─── Edit via button interception ──────────────────────────────

  private editBySource(srcCode: string, sourcePath: string, blockIdx: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    new SplitModal(this.app, {
      initialCode: srcCode,
      sourcePath,
      zoomSensitivity: this.getEffectiveSensitivity(),
      onSave: (newCode: string) => {
        if (view?.editor) {
          const c = newCode.endsWith('\n') ? newCode : newCode + '\n';
          const regex = /```mermaid\n[\s\S]*?```/g;
          let m: RegExpExecArray | null; let i = 0;
          while ((m = regex.exec(view.editor.getValue())) !== null) {
            if (i === blockIdx) {
              if (!newCode.trim()) {
                view.editor.replaceRange('',
                  view.editor.offsetToPos(m.index),
                  view.editor.offsetToPos(m.index + m[0].length));
              } else {
                view.editor.replaceRange(c,
                  view.editor.offsetToPos(m.index + '```mermaid\n'.length),
                  view.editor.offsetToPos(m.index + m[0].length - '\n```'.length));
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
      },
    }).open();
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  private cleanupDetached(): void {
    const detached = [...this.canvasViews].filter(cv => !cv.getWrapper()?.isConnected);
    for (const cv of detached) { cv.destroy(); this.canvasViews.delete(cv); }
  }

  onunload(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const cv of this.canvasViews) cv.destroy();
    this.canvasViews.clear();
  }
}
