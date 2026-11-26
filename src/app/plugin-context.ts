import type { App } from "obsidian";
import type { NovelViewSettings } from "./settings";

/**
 * 所有 feature 模块共用的宿主基座。
 * 只放「每个模块都可能用到」的两项：Obsidian 应用句柄与插件设置。
 * 具体域的能力由各自的 XxxHost 接口在自己的模块里声明。
 */
export interface PluginBase {
  app: App;
  settings: NovelViewSettings;
}
