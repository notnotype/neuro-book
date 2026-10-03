const PROJECT_COVER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const PROJECT_COVER_PORTABLE_NAME_PATTERN = /^[^<>:"|?*\u0000-\u001F\u007F]+$/u;
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\..*)?$/iu;

/**
 * 将 project.yaml 中的封面地址收窄为可携带的 Project Workspace 相对路径。
 *
 * 封面属于 Project 内容，不允许指向 .nbook、绝对路径、URL 或父目录。非法值
 * 返回 undefined；调用方应把它解释为“未设置封面”，不能因此隐藏整个 Project。
 */
export function normalizeProjectCoverPath(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 512 || normalized.includes("\\")) {
        return undefined;
    }
    const segments = normalized.split("/");
    if (
        normalized.startsWith("/")
        || segments.some((segment) => !segment || segment === "." || segment === "..")
        || [".nbook", ".git"].includes(segments[0]?.toLocaleLowerCase("en-US") ?? "")
        || segments.some((segment) => !PROJECT_COVER_PORTABLE_NAME_PATTERN.test(segment))
        || segments.some((segment) => /[. ]$/u.test(segment) || WINDOWS_DEVICE_NAME_PATTERN.test(segment))
    ) {
        return undefined;
    }
    const fileName = segments.at(-1) ?? "";
    const extension = fileName.includes(".")
        ? fileName.slice(fileName.lastIndexOf(".") + 1).toLocaleLowerCase("en-US")
        : "";
    return PROJECT_COVER_EXTENSIONS.has(extension) ? normalized : undefined;
}

/** 判断外部字符串是否已经是规范的 Project 封面相对路径。 */
export function isProjectCoverPath(value: string): boolean {
    return normalizeProjectCoverPath(value) === value;
}
