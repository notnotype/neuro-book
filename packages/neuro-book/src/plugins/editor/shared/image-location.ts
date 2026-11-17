/**
 * 图片存进作品的哪个目录（docs/specs/workbench/markdown-editing.md 输出 56）：设置 `nbook.editor/imageLocation` 与 `imageFolder`
 * 在这里合成目录。纯函数，设置与地址都由调用方读好交进来；插图卡片、粘贴与上传共用同一份。
 */

/** 四种存放位置：作品根下的指定目录（缺省）、作品根、当前文件所在的目录、当前文件所在目录下的指定子目录。 */
export type ImageLocation = "folder" | "root" | "same" | "sibling";

/** `imageFolder` 的缺省值，也是不合规时退回的值。 */
export const IMAGE_FOLDER_DEFAULT = "插图";

/** 控制目录：作品里不放用户的图（写入链也拒绝）。 */
const CONTROL_DIRECTORY = ".nbook";

/**
 * 把设置里的目录名收成可用的相对目录（段之间用 `/`）：不能以 `/` 开头、不含 `..`、不在控制目录下、没有空段，不合规的（设置窗口里
 * 也能存下不合规的值，所以用到时才判断）退回 `插图`。多余的首尾空白与末尾的 `/` 去掉。
 */
export function normalizeImageFolder(value: string): string {
    const text = value.trim().replace(/\/+$/u, "");
    if (text === "" || text.startsWith("/") || text.includes("\\")) return IMAGE_FOLDER_DEFAULT;
    const segments = text.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return IMAGE_FOLDER_DEFAULT;
    if (segments[0]?.toLowerCase() === CONTROL_DIRECTORY) return IMAGE_FOLDER_DEFAULT;
    return text;
}

/** `project://` 地址里项目内的路径；不是作品里的地址为 null。 */
export function projectPathOf(address: string | null): string | null {
    return address !== null && address.startsWith("project://") ? address.slice("project://".length) : null;
}

/**
 * 存放目录在作品里的路径（作品根是空串）。`currentAddress` 是正在编辑的文件：`same`、`sibling` 要它所在的目录；当前文件不在作品里
 * （`user://` 下、没有地址）时没有存放目录，为 null。
 */
export function imageDirectory(location: ImageLocation, folder: string, currentAddress: string | null): string | null {
    const path = projectPathOf(currentAddress);
    if (path === null) return null;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    switch (location) {
        case "root":
            return "";
        case "folder":
            return normalizeImageFolder(folder);
        case "same":
            return parent;
        case "sibling":
            return parent === "" ? normalizeImageFolder(folder) : `${parent}/${normalizeImageFolder(folder)}`;
    }
}
