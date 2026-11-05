/**
 * 作品封面（docs/specs/runtime/projects.md 输出第 13、21 条）：封面文件放在作品文件夹里，身份文件的 `cover` 记它相对作品目录的路径。
 * 两端共用：服务端校验与写入，页面拼地址。不碰 DOM、Bun 与 Node API。
 */

/** 封面文件至多 5 MB。 */
export const PROJECT_COVER_MAX_BYTES = 5 * 1024 * 1024;

export type ProjectCoverType = "image/png" | "image/jpeg" | "image/webp";

const EXTENSIONS: Readonly<Record<ProjectCoverType, string>> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"};
const ACCEPTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const PORTABLE_NAME = /^[^<>:"|?*\u0000-\u001F\u007F]+$/u;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/** 服务端存封面用的文件名：`cover.<扩展名>`，放在作品目录根下。 */
export function coverFileName(type: ProjectCoverType): string {
    return `cover.${EXTENSIONS[type]}`;
}

/**
 * 把身份文件里的封面地址收窄为可携带的作品目录相对路径：不许指向 `.nbook`、`.git`、绝对路径、上级目录或 URL，
 * 扩展名只认 png、jpg、jpeg、webp。非法值为 null，调用方按“没有封面”处理，不能因此隐藏整部作品。
 */
export function normalizeProjectCoverPath(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (normalized === "" || normalized.length > 512 || normalized.includes("\\")) return null;
    const segments = normalized.split("/");
    if (
        normalized.startsWith("/")
        || segments.some((segment) => segment === "" || segment === "." || segment === "..")
        || [".nbook", ".git"].includes((segments[0] ?? "").toLowerCase())
        || segments.some((segment) => !PORTABLE_NAME.test(segment))
        || segments.some((segment) => /[. ]$/u.test(segment) || WINDOWS_DEVICE_NAME.test(segment))
    ) {
        return null;
    }
    const fileName = segments.at(-1) ?? "";
    const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
    return ACCEPTED_EXTENSIONS.has(extension) ? normalized : null;
}

/** 按扩展名给出响应的内容类型。 */
export function coverContentType(path: string): ProjectCoverType | null {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    return null;
}

/** 按文件开头的字节判定格式：上传时不信客户端给的类型。 */
export function sniffCoverType(bytes: Uint8Array): ProjectCoverType | null {
    const starts = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
}

/** 封面的 HTTP 地址（`nbook.projects` 服务端入口的路由）；`version` 变了浏览器才重新取。 */
export function projectCoverUrl(id: string, version: string): string {
    return `/api/nbook.projects/cover/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}`;
}
