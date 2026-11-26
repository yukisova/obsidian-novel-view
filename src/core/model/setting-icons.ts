export interface SettingIconPreset {
  value: string;
  label: string;
}

export const SETTING_ICON_PRESETS: SettingIconPreset[] = [
  { value: "lucide:user", label: "人物" },
  { value: "lucide:users", label: "群体" },
  { value: "lucide:map-pin", label: "地点" },
  { value: "lucide:building-2", label: "建筑" },
  { value: "lucide:sword", label: "战斗" },
  { value: "lucide:shield", label: "防御" },
  { value: "lucide:crown", label: "身份" },
  { value: "lucide:heart", label: "关系" },
  { value: "lucide:globe", label: "世界" },
  { value: "lucide:book-open", label: "知识" },
  { value: "lucide:flask-conical", label: "技术" },
  { value: "lucide:sparkles", label: "特殊" },
];

export interface ParsedSettingIcon {
  kind: "lucide" | "image";
  value: string;
}

/** 解析图标配置并区分内置图标与图片 */
export function parseSettingIcon(value: string | undefined): ParsedSettingIcon | null {
  const icon = value?.trim() ?? "";
  if (!icon) {
    return null;
  }
  if (icon.startsWith("lucide:")) {
    const name = icon.slice("lucide:".length).trim();
    return name ? { kind: "lucide", value: name } : null;
  }
  if (icon.startsWith("image:")) {
    const path = icon.slice("image:".length).trim();
    return path ? { kind: "image", value: path } : null;
  }
  if (/\.(svg|png|jpe?g|webp)$/iu.test(icon)) {
    return { kind: "image", value: icon };
  }
  return { kind: "lucide", value: icon };
}

/** 判断路径是否指向可用的图标图片 */
export function isSettingIconImageFile(path: string): boolean {
  return /\.(svg|png|jpe?g|webp)$/iu.test(path);
}
