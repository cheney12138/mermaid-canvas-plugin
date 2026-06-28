import {
  ViewPlugin, ViewUpdate, Decoration, DecorationSet,
  WidgetType, EditorView,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { MarkdownView } from 'obsidian';
import type MermaidCanvasPlugin from './main';
import { SplitModal } from './SplitModal';

/**
 * CodeMirror ViewPlugin that hides mermaid source code in the editor
 * and replaces it with a rendered SVG widget.
 */
export function mermaidCodeBlockPlugin(plugin: MermaidCanvasPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged)
          this.decorations = this.build(update.view);
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        const text = doc.toString();
        const regex = /```mermaid\n([\s\S]*?)```/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) !== null) {
          const from = m.index;
          const to = m.index + m[0].length;
          const code = m[1].trimEnd();
          builder.add(from, to, Decoration.replace({
            widget: new MermaidWidget(code, plugin),
          }));
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

class MermaidWidget extends WidgetType {
  constructor(
    private code: string,
    private plugin: MermaidCanvasPlugin,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'mermaid-cm-widget';
    el.style.display = 'inline-block';
    el.style.width = '100%';
    el.style.minHeight = '80px';
    el.style.cursor = 'pointer';
    el.title = 'Double-click to edit';

    // Render mermaid SVG asynchronously
    this.renderMermaid(el);

    // Double-click → open SplitModal
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openEditor();
    });

    return el;
  }

  private async renderMermaid(el: HTMLElement): Promise<void> {
    try {
      // @ts-ignore — mermaid is a global in Obsidian
      const mermaid = globalThis.mermaid || (window as any).mermaid;
      if (!mermaid) {
        el.textContent = '[Mermaid diagram]';
        return;
      }
      const id = 'mermaid-cm-' + Math.random().toString(36).slice(2);
      const { svg } = await mermaid.render(id, this.code);
      el.innerHTML = svg;
      // Remove width/height constraints
      const svgEl = el.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
      }
    } catch {
      el.textContent = '[Mermaid parse error]';
    }
  }

  private openEditor(): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return;

    new SplitModal(this.plugin.app, {
      initialCode: this.code,
      sourcePath: view.file?.path ?? '',
      zoomSensitivity: this.plugin.getEffectiveSensitivity(),
      onSave: (newCode: string) => {
        const editor = view.editor!;
        const doc = editor.getValue();
        const searchBlock = '```mermaid\n' + this.code + '\n```';
        const idx = doc.indexOf(searchBlock);
        if (idx !== -1) {
          const c = newCode.endsWith('\n') ? newCode : newCode + '\n';
          editor.replaceRange(
            c,
            editor.offsetToPos(idx + '```mermaid\n'.length),
            editor.offsetToPos(idx + searchBlock.length - '\n```'.length),
          );
        }
      },
    }).open();
  }

  eq(other: WidgetType): boolean {
    return other instanceof MermaidWidget && other.code === this.code;
  }
}
