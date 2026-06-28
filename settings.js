import { PluginSettingTab, Setting } from 'obsidian';
export const DEFAULT_SETTINGS = {
    zoomSensitivity: 5,
    defaultSplitView: true,
    mermaidTheme: 'default',
};
export class MermaidCanvasSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Mermaid Canvas Settings' });
        // ── Zoom Sensitivity ──
        new Setting(containerEl)
            .setName('Zoom sensitivity')
            .setDesc('Controls how fast zoom responds to the mouse wheel. Lower = smoother but slower.')
            .addSlider((slider) => slider
            .setLimits(1, 10, 1)
            .setValue(this.plugin.settings.zoomSensitivity)
            .setDynamicTooltip()
            .onChange(async (value) => {
            this.plugin.settings.zoomSensitivity = value;
            await this.plugin.saveSettings();
        }));
        // ── Default view mode ──
        new Setting(containerEl)
            .setName('Default split view')
            .setDesc('When enabled, opening a mermaid block shows code + preview side by side.')
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.defaultSplitView)
            .onChange(async (value) => {
            this.plugin.settings.defaultSplitView = value;
            await this.plugin.saveSettings();
        }));
        // ── Mermaid theme ──
        new Setting(containerEl)
            .setName('Mermaid theme')
            .setDesc('The color theme used for rendered diagrams.')
            .addDropdown((dropdown) => dropdown
            .addOption('default', 'Default')
            .addOption('forest', 'Forest')
            .addOption('dark', 'Dark')
            .addOption('neutral', 'Neutral')
            .addOption('base', 'Base')
            .setValue(this.plugin.settings.mermaidTheme)
            .onChange(async (value) => {
            this.plugin.settings.mermaidTheme = value;
            await this.plugin.saveSettings();
        }));
    }
}
