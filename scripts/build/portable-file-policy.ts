const EXCLUDED_PORTABLE_PREFIX = ".agent/workspace/runtime-artifact-import-cache/";

/** 判断文件是否可以进入 Windows Portable staging。 */
export function shouldIncludePortableFile(path: string): boolean {
    const normalized = path.replaceAll("\\", "/");
    return !normalized.startsWith(EXCLUDED_PORTABLE_PREFIX);
}
