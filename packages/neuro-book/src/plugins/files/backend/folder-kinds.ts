/**
 * 三类文件夹（docs/specs/workspace/folder-kinds.md）：按名字后缀分类、名字排序与内容文件夹清单 `content.xml` 的解析。
 * 纯函数，不碰文件系统；列出时怎样把清单与磁盘合并见 `files-service.ts`。
 */

import {XMLParser, XMLValidator} from "fast-xml-parser";

import type {FolderKind} from "../shared/contracts";

export const MANIFEST_NAME = "content.xml";
export const BODY_NAME = "index.md";

export function folderKindOf(name: string): FolderKind {
    if (name.endsWith(".content")) return "content";
    if (name.endsWith(".binder")) return "binder";
    return "plain";
}

const collator = new Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"});

/** 名字排序：中文自然排序，比较相等时按 UTF-16 码元次序，结果是全序。 */
export function compareNames(left: string, right: string): number {
    return collator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

/** 目录在前，再按名字排序（普通文件夹与内容文件夹的未列入项）。 */
export function compareEntries(left: {readonly name: string; readonly kind: string}, right: {readonly name: string; readonly kind: string}): number {
    const directory = Number(right.kind === "directory") - Number(left.kind === "directory");
    return directory || compareNames(left.name, right.name);
}

export interface ManifestItem {
    readonly name: string;
    readonly title?: string;
    readonly icon?: string;
    readonly children: ReadonlyArray<ManifestItem>;
}

export type ParsedManifest = {readonly ok: true; readonly items: ReadonlyArray<ManifestItem>} | {readonly ok: false; readonly detail: string};

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    ignoreDeclaration: true,
    commentPropName: "#comment",
});

const ATTRIBUTES = new Set(["name", "title", "icon"]);

type OrderedNode = Record<string, unknown>;

/** 解析清单：根是 `content`，下面只有嵌套的 `item`（`name` 必填，`title`、`icon` 可选）。 */
export function parseManifest(text: string): ParsedManifest {
    let roots: OrderedNode[];
    try {
        const valid = XMLValidator.validate(text);
        if (valid !== true) return {ok: false, detail: `第 ${String(valid.err.line)} 行：${valid.err.msg}`};
        roots = elements(parser.parse(text) as OrderedNode[]);
    } catch (error) {
        // 清单是用户文件：解析器对超限实体等输入直接抛错，按清单不合法报告，不让整次列出失败。
        return {ok: false, detail: `XML 无法解析：${error instanceof Error ? error.message : String(error)}`};
    }
    if (roots.length !== 1 || tagOf(roots[0] as OrderedNode) !== "content") return {ok: false, detail: "根元素必须是唯一的 <content>"};
    try {
        return {ok: true, items: itemsOf(roots[0] as OrderedNode, "content")};
    } catch (error) {
        if (error instanceof ManifestError) return {ok: false, detail: error.message};
        throw error;
    }
}

class ManifestError extends Error {}

function itemsOf(node: OrderedNode, where: string): ManifestItem[] {
    if (Object.hasOwn(node, ":@") && where === "content") throw new ManifestError("<content> 不接受属性");
    const children = node[tagOf(node)] as OrderedNode[];
    const items: ManifestItem[] = [];
    const names = new Set<string>();
    for (const child of children) {
        if (Object.hasOwn(child, "#comment")) continue;
        if (Object.hasOwn(child, "#text")) throw new ManifestError(`${where} 里不能有文本`);
        const tag = tagOf(child);
        if (tag !== "item") throw new ManifestError(`${where} 里只能有 <item>，不能有 <${tag}>`);
        const attributes = (child[":@"] ?? {}) as Record<string, string>;
        const unknown = Object.keys(attributes).filter((key) => !ATTRIBUTES.has(key));
        if (unknown.length > 0) throw new ManifestError(`<item> 不接受属性 ${unknown.join("、")}`);
        const name = attributes.name;
        if (name === undefined || name === "" || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
            throw new ManifestError(`${where} 里的 <item> 的 name 必须是单个目录项名：${JSON.stringify(name ?? null)}`);
        }
        if (names.has(name)) throw new ManifestError(`${where} 里有重名的 <item name="${name}">`);
        names.add(name);
        items.push({name, ...(attributes.title === undefined ? {} : {title: attributes.title}), ...(attributes.icon === undefined ? {} : {icon: attributes.icon}), children: itemsOf(child, `${where}/${name}`)});
    }
    return items;
}

/** 有序解析结果里的元素节点（去掉注释）。 */
function elements(nodes: OrderedNode[]): OrderedNode[] {
    return nodes.filter((node) => !Object.hasOwn(node, "#comment") && !Object.hasOwn(node, "#text"));
}

/** 有序解析结果里一个元素节点的标签名：除属性 `:@` 外唯一的键。 */
function tagOf(node: OrderedNode): string {
    return Object.keys(node).find((key) => key !== ":@") ?? "";
}

/** 清单里与内容根下某个目录对应的那一层；路径上任一段不在清单里时为 `null`（整层都是未列入项）。 */
export function itemsAt(items: ReadonlyArray<ManifestItem>, segments: ReadonlyArray<string>): ReadonlyArray<ManifestItem> | null {
    let level: ReadonlyArray<ManifestItem> = items;
    for (const segment of segments) {
        const item = level.find((candidate) => candidate.name === segment);
        if (item === undefined) return null;
        level = item.children;
    }
    return level;
}
