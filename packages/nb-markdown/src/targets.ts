/**
 * 链接与引用的目标归哪一类（docs/specs/workspace/markdown-dialect.md 输出 27）：显示成引用小块还是普通链接、小块取什么图标、
 * 点击发 `reference` 还是 `link`。哪些方案指向“文件”、相对地址按什么解析是宿主的事（neuro-book 认 `project://`、`user://`，
 * 见它的 `plugins/markdown/shared/targets.ts`），包里只有接口与不认任何文件方案的缺省规则。
 */

/** `file` 宿主认得的文件；`attachment` 会话附件；`external` 外部链接；`other` 别的方案与解析不了的。 */
export type TargetKind = "file" | "attachment" | "external" | "other";

export interface Target {
    readonly kind: TargetKind;
    /** 细分：写进 `data-reference-link` 与小块的色调类 `nb-chip--<variant>`；没有时用 `kind`。 */
    readonly variant?: string;
    /** 文件名：路径的最后一段（解码后），取文件图标与悬停提示用；带方案的非文件目标与没有路径时为空字符串。 */
    readonly name: string;
}

export interface MarkdownTargets {
    /** `base` 是目标所在文件的地址（编辑器里的文档）；没有所在文件时（Composer、展示器）为 null。 */
    classify(target: string, base: string | null): Target;
    /** 对任何目标调用（插入引用时写进链接的地址）：属于文件的把 `%`、`#`、`?` 按百分号编码，读回仍是同一个文件；别的原样返回。 */
    encodeFile(target: string): string;
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/u;
const EXTERNAL = new Set(["http", "https", "mailto"]);

/** 目标的方案（小写）；不带方案时为 undefined。 */
export const schemeOf = (target: string): string | undefined => SCHEME.exec(target)?.[1]?.toLowerCase();

/** Markdown 链接的地址可能是百分号编码的（`%20`）；解不开的按原样。 */
export function decodeTarget(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/** 去掉 `?查询` 与 `#片段`：它们不是文件的一部分。 */
export const pathPart = (target: string): string => target.replace(/[?#].*$/su, "");

/** 路径的最后一段（解码后）；没有时为空字符串。 */
export const lastSegment = (path: string): string => decodeTarget(path.split("/").filter((segment) => segment !== "").at(-1) ?? "");

/**
 * 缺省规则：`http`、`https`、`mailto` 是外部链接，别的都是 `other`（显示成不带文件图标的引用小块，点击发 `reference`，由宿主
 * 决定打开什么，例如 `paragraph://41.20`）。宿主的规则先用它判外部链接，再叠加自己认的方案。
 */
export function classifyScheme(target: string): Target {
    const scheme = schemeOf(target);
    if (scheme !== undefined) return {kind: EXTERNAL.has(scheme) ? "external" : "other", name: ""};
    return {kind: "other", name: lastSegment(pathPart(target))};
}

/** 这一类目标的链接显示成引用小块：外部链接是普通链接，别的都是小块（输出 27）。 */
export const showsAsChip = (target: Target): boolean => target.kind !== "external";

/** `scheme://路径`（只认这一种带 `://` 的资源地址）拆成方案与路径各段；不是这个形状为 null。 */
function resourceParts(address: string): {readonly scheme: string; readonly segments: readonly string[]} | null {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/su.exec(address);
    if (match === null) return null;
    return {scheme: (match[1] as string).toLowerCase(), segments: (match[2] as string).split("/")};
}

/**
 * 从文档 `from` 指向文件 `to` 的相对路径（资源地址，如 `project://设定/林雪.md`，两个都必须是资源地址，路径各段是原样的名字、没编码）：
 * 同一方案才有相对写法，方案不同或 `to` 没有路径为 null。结果是 `插图/a.png`、`../设定/林雪.md` 这种，不带编码。
 */
export function relativeAddress(from: string, to: string): string | null {
    const source = resourceParts(from);
    const target = resourceParts(to);
    if (source === null || target === null || source.scheme !== target.scheme) return null;
    const directory = source.segments.slice(0, -1);
    const file = target.segments;
    if (file.length === 0 || file.at(-1) === "") return null;
    let common = 0;
    while (common < directory.length && common < file.length - 1 && directory[common] === file[common]) common += 1;
    return [...Array.from({length: directory.length - common}, () => ".."), ...file.slice(common)].join("/");
}

/**
 * 写进链接与图片的地址：文档在 `from`、目标是资源地址 `to` 时写相对地址，经宿主的 `encodeFile` 编码（`%`、`#`、`?`，读回仍是同一个
 * 文件）；第一段含 `:` 的在前面加 `./`，否则它会被当成方案（也过不了链接的地址检查）。写不出相对地址（方案不同、没有所在文件）
 * 时为 null，调用方按原样写。
 */
export function relativeTarget(from: string | null, to: string, targets: MarkdownTargets): string | null {
    if (from === null) return null;
    const relative = relativeAddress(from, to);
    if (relative === null) return null;
    const encoded = targets.encodeFile(relative);
    return (encoded.split("/")[0] as string).includes(":") ? `./${encoded}` : encoded;
}

/** 不认任何文件方案的宿主用的分类：`encodeFile` 原样返回。 */
export const schemeTargets: MarkdownTargets = {
    classify: (target) => classifyScheme(target),
    encodeFile: (target) => target,
};
