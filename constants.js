// CSS class names used across the plugin
export const CLASSES = {
    // Wrapper around the mermaid SVG in reading view
    CANVAS_WRAPPER: 'mermaid-canvas-wrapper',
    // The container that gets transform: scale/translate applied
    CANVAS_CONTENT: 'mermaid-canvas-content',
    // Control bar overlay
    CONTROL_BAR: 'mermaid-canvas-controls',
    CONTROL_BTN: 'mermaid-canvas-btn',
    // Fullscreen overlay
    FULLSCREEN_OVERLAY: 'mermaid-canvas-fullscreen',
    // Split modal
    SPLIT_MODAL: 'mermaid-canvas-split',
    SPLIT_LEFT: 'mermaid-canvas-left',
    SPLIT_RIGHT: 'mermaid-canvas-right',
    SPLIT_TOOLBAR: 'mermaid-canvas-toolbar',
    // Reading-mode trigger card (replaces inline rendering)
    READING_TRIGGER: 'mermaid-canvas-reading-trigger',
    READING_TRIGGER_ICON: 'mermaid-canvas-reading-icon',
    READING_TRIGGER_TEXT: 'mermaid-canvas-reading-text',
};
// Default settings
export const DEFAULT_SETTINGS = {
    zoomSensitivity: 0.0006, // scale change per deltaY pixel
    defaultSplitView: true,
    mermaidTheme: 'default',
};
// Sensitivity multiplier (user-facing: 1-10 mapped to 0.0002-0.002)
export const ZOOM_SENSITIVITY_MIN = 0.001;
export const ZOOM_SENSITIVITY_MAX = 0.012;
// Debounce delay for live preview (ms)
export const RENDER_DEBOUNCE = 300;
