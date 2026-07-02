// CSS class names used across the plugin
export const CLASSES = {
  // Wrapper around the mermaid SVG in reading view
  CANVAS_WRAPPER: 'mermaid-canvas-wrapper',
  // The container that gets transform: scale/translate applied
  CANVAS_CONTENT: 'mermaid-canvas-content',
  // Control bar overlay
  CONTROL_BAR: 'mermaid-canvas-controls',
  CONTROL_BTN: 'mermaid-canvas-btn',
  // Export bar (bottom-center, shown on hover)
  EXPORT_BAR: 'mermaid-canvas-export-bar',
  // Fullscreen overlay
  FULLSCREEN_OVERLAY: 'mermaid-canvas-fullscreen',
  // Applied to the wrapper itself while it's inside the fullscreen overlay
  WRAPPER_FULLSCREEN: 'mermaid-canvas-wrapper-fullscreen',
  // Generic hidden state (source code children hidden behind the rendered SVG)
  HIDDEN: 'mermaid-canvas-hidden',
  // Collapses a <pre> source block's own text so only the moved-out SVG shows
  SOURCE_COLLAPSED: 'mermaid-canvas-source-collapsed',
  // Split modal
  SPLIT_MODAL: 'mermaid-canvas-split',
  SPLIT_LEFT: 'mermaid-canvas-left',
  SPLIT_RIGHT: 'mermaid-canvas-right',
  SPLIT_TOOLBAR: 'mermaid-canvas-toolbar',
} as const;

// CanvasView internal defaults (physical units, not UI slider values)
export const CANVAS_DEFAULTS = {
  zoomSensitivity: 0.0006, // scale change per deltaY pixel
} as const;

// Sensitivity multiplier (user-facing: 1-10 mapped to 0.0002-0.002)
export const ZOOM_SENSITIVITY_MIN = 0.001;
export const ZOOM_SENSITIVITY_MAX = 0.012;

// Debounce delay for live preview (ms)
export const RENDER_DEBOUNCE = 300;
