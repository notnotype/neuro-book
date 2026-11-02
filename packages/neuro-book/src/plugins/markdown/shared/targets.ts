/**
 * 引用的目标（docs/specs/workspace/markdown-dialect.md 输出 18、27）：链接、图片与 Composer 里引用的目标归哪一类、指向作品里的
 * 哪个文件。编辑器、展示器与 Composer 都按这里判断显示成什么；写回的地址不变，这里只读。
 */

import {classifyScheme, decodeTarget, lastSegment, pathPart, schemeOf} from "@notnotype/nb-markdown";

import {parseResource} from "nbook/plugins/files/shared/contracts";

/** `work` 作品里的文件；`user` 用户资产；`attachment` Composer 的会话附件；`external` 外部链接；`other` 别的方案与解析不了的。 */
export type TargetKind = "work" | "user" | "attachment" | "external" | "other";

export interface Target {
    readonly kind: TargetKind;
    /** `work`、`user` 时是解析出的资源地址（`project://…`、`user://…`）；解析出根以外或不合法时为 null（不显示，输出 18）。 */
    readonly address: string | null;
    /** 显示与取图标用的文件名：路径的最后一段（解码后）；没有路径时为空字符串。 */
    readonly name: string;
}

/** 按 `/` 拼出的段解析 `.` 与 `..`；越出根时为 null。 */
function normalized(segments: ReadonlyArray<string>): string | null {
    const out: string[] = [];
    for (const segment of segments) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            if (out.length === 0) return null;
            out.pop();
            continue;
        }
        out.push(segment);
    }
    return out.join("/");
}

/** 合法的资源地址，否则为 null。 */
function resource(scheme: "project" | "user", path: string | null): string | null {
    if (path === null) return null;
    const address = `${scheme}://${path}`;
    return parseResource(address).ok ? address : null;
}


/** 会话附件在 `session://` 下的目录（docs/specs/agent/resources.md；Composer 的附件，workspace/markdown-dialect.md）。 */
const ATTACHMENTS_PATH = "attachments/";

/**
 * 归类并解析一个目标。`base` 是目标所在文件的地址（编辑器里的文档）；没有所在文件时（Composer、展示器）为 null，这时以 `/`
 * 开头的按作品根解析，相对地址无从解析，归为 `other`。
 */
export function classifyTarget(target: string, base: string | null): Target {
    const scheme = schemeOf(target);
    const path = pathPart(target);
    if (scheme !== undefined) {
        // 外部链接按包的缺省规则判，两个宿主下同一个链接分类一致；文件与附件的方案是 NeuroBook 的。
        if (classifyScheme(target).kind === "external") return {kind: "external", address: null, name: ""};
        // 方案名不分大小写（与下面的 `project`、`user` 一致），只比较方案之后的部分。
        const rest = path.slice(path.indexOf("://") + 3);
        if (scheme === "session" && rest.startsWith(ATTACHMENTS_PATH)) return {kind: "attachment", address: null, name: lastSegment(rest.slice(ATTACHMENTS_PATH.length))};
        if (scheme === "project" || scheme === "user") {
            const rest = path.slice(`${scheme}://`.length);
            return {kind: scheme === "project" ? "work" : "user", address: resource(scheme, normalized(decodeTarget(rest).split("/"))), name: lastSegment(rest)};
        }
        return {kind: "other", address: null, name: ""};
    }
    // 不带方案：以 `/` 开头的按根，否则按所在文件的目录（输出 18）。根是所在文件的方案：`user://` 下是用户资产根。
    const baseResource = base === null ? null : parseResource(base);
    const root: "project" | "user" = baseResource?.ok === true && baseResource.resource.scheme === "user" ? "user" : "project";
    const kind: TargetKind = root === "user" ? "user" : "work";
    const segments = decodeTarget(path).split("/");
    if (path.startsWith("/")) return {kind, address: resource(root, normalized(segments)), name: lastSegment(path)};
    if (baseResource?.ok !== true) return {kind: "other", address: null, name: lastSegment(path)};
    const directory = baseResource.resource.path.split("/").slice(0, -1);
    return {kind, address: resource(root, normalized([...directory, ...segments])), name: lastSegment(path)};
}

/**
 * 作品里的文件与用户资产写进链接时的地址：路径里的 `%`、`#`、`?` 按百分号编码，读回时（`classifyTarget` 去掉查询与片段、再
 * 解码）仍是同一个文件。别的方案（外部链接）原样：那里的 `#`、`?` 本来就是片段与查询。
 */
export function encodeFileTarget(target: string): string {
    const scheme = schemeOf(target);
    if (scheme !== undefined && scheme !== "project" && scheme !== "user") return target;
    const prefix = scheme === undefined ? "" : `${scheme}://`;
    const path = target.slice(prefix.length === 0 ? 0 : target.indexOf("://") + 3);
    return `${prefix}${path.replace(/[%#?]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
