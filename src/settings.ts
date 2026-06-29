import { App, PluginSettingTab, Setting } from 'obsidian';
import type MermaidCanvasPlugin from './main';

export interface PluginSettings {
  zoomSensitivity: number; // 1-10 scale, mapped internally
}

export const DEFAULT_SETTINGS: PluginSettings = {
  zoomSensitivity: 5,
};

export class MermaidCanvasSettingTab extends PluginSettingTab {
  plugin: MermaidCanvasPlugin;

  constructor(app: App, plugin: MermaidCanvasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Mermaid Canvas Settings' });

    new Setting(containerEl)
      .setName('Zoom sensitivity')
      .setDesc('Controls how fast zoom responds to the mouse wheel. Lower = smoother but slower.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.zoomSensitivity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.zoomSensitivity = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
