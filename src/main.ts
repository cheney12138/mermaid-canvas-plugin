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
      console.log('[MermaidCanvas] editBtn: srcCode=', srcCode, 'container=', container.tagName, container.className);
      if (!srcCode) {
        const all = [...document.querySelectorAll<HTMLElement>(this.LIVE_SELECTORS)]
          .filter(el => !el.closest('.' + CLASSES.CANVAS_WRAPPER));
        all.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const idx = all.indexOf(container);
        const codes = this.readAllEditorBlocks(
          this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? ''
        );
        console.log('[MermaidCanvas]   fallback: idx=', idx, 'codesLen=', codes.length, 'allLen=', all.length,
          'allElements=', all.map(e => e.tagName + '.' + e.className.substring(0, 40)));
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

  private readonly MERMAID_SELECTORS = '.mermaid, .block-language-mermaid, .language-mermaid';
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

    // Reading mode: editor is unavailable, need vault fallback
    if (editorCodes.length === 0) this.fillSourceCodes();
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

  /** Read mermaid blocks from vault file (fallback when editor is unavailable, e.g. reading mode) */
  /** Read the mermaid code block whose opening fence is at `lineNum` (0-indexed). */
  private async readBlockFromVaultByLine(sourcePath: string, lineNum: number): Promise<string> {
    try {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!file) return '';
      const content = await this.app.vault.cachedRead(file as import('obsidian').TFile);
      const lines = content.split('\n');
      // lineNum points to the ```mermaid fence; search a few lines around it for safety
      for (let i = Math.max(0, lineNum - 1); i <= Math.min(lineNum + 3, lines.length - 1); i++) {
        if (lines[i].trim() === '```mermaid') {
          const codeLines: string[] = [];
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trimEnd() === '```') return codeLines.join('\n');
            codeLines.push(lines[j]);
          }
        }
      }
    } catch { /* file not readable */ }
    return '';
  }

  private async readBlocksFromVault(sourcePath: string): Promise<string[]> {
    const codes: string[] = [];
    try {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!file) return codes;
      const content = await this.app.vault.cachedRead(file as import('obsidian').TFile);
      const regex = /```mermaid\n([\s\S]*?)```/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) codes.push(m[1].trimEnd());
    } catch { /* file not readable */ }
    return codes;
  }

  /** Ensure all un-enhanced containers in the active view have data-mermaid-src set.
   *  Falls back to vault reading when the editor is unavailable (reading mode). */
  private async fillSourceCodes(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const sourcePath = view.file?.path ?? '';
    // Only count outermost unwrapped containers (same logic as enhanceBlock)
    const containers = [...view.containerEl.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS)]
      .filter(el => !el.closest('.' + CLASSES.CANVAS_WRAPPER) &&
                    !el.parentElement?.closest(this.MERMAID_SELECTORS));
    if (containers.length === 0) return;

    // Try editor first (live preview / source mode), then vault (reading mode)
    let codes = this.readAllEditorBlocks(sourcePath);
    if (codes.length === 0) {
      codes = await this.readBlocksFromVault(sourcePath);
    }
    if (codes.length === 0) return;

    let pos = 0;
    for (const c of containers) {
      if (c.closest('.' + CLASSES.CANVAS_WRAPPER)) { pos++; continue; }
      if (c.closest('.' + CLASSES.SPLIT_MODAL)) { pos++; continue; }
      if (pos < codes.length && !c.getAttribute('data-mermaid-src')) {
        c.setAttribute('data-mermaid-src', codes[pos]);
      }
      pos++;
    }
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
    // Ensure source codes are populated (observer/retry path may miss them)
    if (count > 0) this.fillSourceCodes();
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

    const sp = () => view.file?.path ?? '';
    const excluded = (el: HTMLElement) =>
      !!el.closest('.' + CLASSES.CANVAS_WRAPPER) || !!el.closest('.' + CLASSES.SPLIT_MODAL);

    this.observer = new MutationObserver((mutations) => {
      const pending = new Set<HTMLElement>();

      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (excluded(node)) continue;

          // Case 1: the node itself is a mermaid container
          if (node.matches(this.MERMAID_SELECTORS)) {
            pending.add(node);
          }
          // Case 2: node contains mermaid containers (batch insertion of a section)
          for (const mc of node.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS)) {
            if (!excluded(mc)) pending.add(mc);
          }
          // Case 3: node is an SVG inserted directly into a mermaid container
          if (node.tagName.toLowerCase() === 'svg') {
            const mc = node.closest<HTMLElement>(this.MERMAID_SELECTORS);
            if (mc && !excluded(mc)) pending.add(mc);
          }
        }
      }

      for (const mc of pending) {
        if (mc.querySelector('svg')) {
          this.enhanceBlock(mc, sp());
        } else {
          this.waitAndEnhance(mc, sp());
        }
      }
    });

    this.observer.observe(view.containerEl, { childList: true, subtree: true });
  }

  // Poll for SVG in a mermaid container that was added before mermaid.js finished rendering.
  // Max wait: 20 × 100ms = 2s, after which we give up silently.
  private waitAndEnhance(container: HTMLElement, sourcePath: string, attempts = 0): void {
    if (container.closest('.' + CLASSES.CANVAS_WRAPPER)) return;
    if (container.querySelector('svg')) {
      this.enhanceBlock(container, sourcePath);
      return;
    }
    if (attempts >= 20) return;
    setTimeout(() => this.waitAndEnhance(container, sourcePath, attempts + 1), 100);
  }

  // ─── Enhance ───────────────────────────────────────────────────

  private enhanceBlock(container: HTMLElement, sourcePath: string): void {
    if (!container.isConnected) return;
    if (container.closest('.' + CLASSES.CANVAS_WRAPPER)) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const w = parseFloat(svg.getAttribute('width') || '0');
    const h = parseFloat(svg.getAttribute('height') || '0');
    if (w < 10 && h < 10) return;

    try {
      // blockIdx: count only unwrapped outermost containers in the same document,
      // used for onDelete. Source code is retrieved separately via data-line or editor.
      const searchRoot = container.ownerDocument.body;
      const rawContainers = [...searchRoot.querySelectorAll<HTMLElement>(this.MERMAID_SELECTORS)]
        .filter(el => !el.closest('.' + CLASSES.CANVAS_WRAPPER) &&
                      !el.parentElement?.closest(this.MERMAID_SELECTORS));
      rawContainers.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const blockIdx = rawContainers.indexOf(container);

      // Source code priority:
      // 1. data-mermaid-src (set by fillSourceCodes for live-preview)
      // 2. editor content (live-preview / source mode)
      // 3. data-line → precise vault line lookup (reading mode)
      // 4. index-based vault fallback
      let copyCode = container.getAttribute('data-mermaid-src') ?? '';
      if (!copyCode) {
        const codes = this.readAllEditorBlocks(sourcePath);
        if (blockIdx >= 0 && blockIdx < codes.length) copyCode = codes[blockIdx];
      }

      const readOnly = !!container.closest('.markdown-preview-view');
      const cv = new CanvasView(container, { zoomSensitivity: this.getEffectiveSensitivity(), readOnly });
      cv.mount(svg);
      cv.setSourceCode(copyCode);

      if (!copyCode) {
        // Try data-line first — most reliable in reading mode
        const lineAttr = container.closest('[data-line]')?.getAttribute('data-line');
        const lineNum = lineAttr !== undefined ? parseInt(lineAttr) : -1;
        if (lineNum >= 0) {
          this.readBlockFromVaultByLine(sourcePath, lineNum).then(code => {
            if (code) cv.setSourceCode(code);
          });
        } else {
          this.readBlocksFromVault(sourcePath).then(codes => {
            if (blockIdx >= 0 && blockIdx < codes.length) cv.setSourceCode(codes[blockIdx]);
          });
        }
      }

      (cv as any).options.onDelete = () => {
        if (blockIdx < 0) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.editor) {
          const regex = /```mermaid\n[\s\S]*?```/g;
          let m: RegExpExecArray | null; let i = 0;
          while ((m = regex.exec(view.editor.getValue())) !== null) {
            if (i === blockIdx) {
              view.editor.replaceRange('',
                view.editor.offsetToPos(m.index),
                view.editor.offsetToPos(m.index + m[0].length));
              return;
            }
            i++;
          }
        }
      };
      this.canvasViews.add(cv);
    } catch (err) {
      console.warn('Mermaid Canvas: enhance failed', err);
    }
  }

  /** Find the index of this container among all mermaid blocks (even inside wrappers) */

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
