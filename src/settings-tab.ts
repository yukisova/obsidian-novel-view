import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
} from "obsidian";
import type NovelViewPlugin from "./main";
import type { ParagraphMode } from "./settings";

export class NovelViewSettingTab extends PluginSettingTab {
  private readonly plugin: NovelViewPlugin;

  constructor(app: App, plugin: NovelViewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("首行缩进（字符）")
      .addSlider((slider) => {
        slider
          .setLimits(0, 8, 1)
          .setValue(this.plugin.settings.firstLineIndent)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ firstLineIndent: value });
          });
      });

    new Setting(containerEl)
      .setName("行距（倍）")
      .addSlider((slider) => {
        slider
          .setLimits(1.2, 2.4, 0.1)
          .setValue(this.plugin.settings.lineHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ lineHeight: value });
          });
      });

    new Setting(containerEl)
      .setName("段距（em）")
      .addSlider((slider) => {
        slider
          .setLimits(0, 2, 0.1)
          .setValue(this.plugin.settings.paragraphSpacing)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ paragraphSpacing: value });
          });
      });

    new Setting(containerEl)
      .setName("段落划分")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("line", "按换行（每行一段）")
          .addOption("blank-line", "按空行（标准 Markdown）")
          .setValue(this.plugin.settings.paragraphMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              paragraphMode: value as ParagraphMode,
            });
          });
      });

    new Setting(containerEl)
      .setName("隐藏 Markdown 格式标记")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.hideMarkdownMarkers)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ hideMarkdownMarkers: value });
          });
      });

    new Setting(containerEl)
      .setName("隐藏行号")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.hideLineNumbers)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ hideLineNumbers: value });
          });
      });

    new Setting(containerEl)
      .setName("恢复默认设置")
      .addButton((button) => {
        button
          .setButtonText("恢复默认")
          .onClick(async () => {
            await this.plugin.resetSettings();
            this.display();
            new Notice("NovelView 设置已恢复默认值。");
          });
      });
  }
}
