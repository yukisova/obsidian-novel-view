/** 按文件名自然顺序比较并返回排序值 */
export function compareFilesNaturally(
  left: { basename: string; path: string },
  right: { basename: string; path: string },
): number {
  const byName = left.basename.localeCompare(right.basename, "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
  return byName !== 0 ? byName : left.path.localeCompare(right.path);
}
