import { Plugin } from "obsidian";

declare class LegacyNovelViewPlugin extends Plugin {
  [key: string]: any;
  settings: any;
  constructor(app: unknown, manifest: unknown);
  onload(): Promise<void>;
  onunload(): void;
}
export default LegacyNovelViewPlugin;
