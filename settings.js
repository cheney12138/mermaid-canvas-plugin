import { PluginSettingTab, Setting } from 'obsidian';
export const DEFAULT_SETTINGS = {
    zoomSensitivity: 5,
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
    }
}
