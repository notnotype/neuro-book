/**
 * 修改内容文件夹的清单 `content.xml`（docs/specs/workspace/folder-kinds.md 的“经文件服务的操作同步清单”“清单编辑”）。
 * 纯函数：输入当前文本与一个修改，输出新文本；读写与锁见 `operations.ts`。
 *
 * 改的是有序解析树，注释、XML 声明与条目顺序都保留；输出统一两格缩进。修改前后都按 `parseManifest` 校验：当前清单
 * 不合法时不改（调用方报告部分完成），改完不合法说明修改本身有错，同样不写。
 */

import {XMLBuilder, XMLParser} from "fast-xml-parser";

import {parseManifest} from "./folder-kinds";

const OPTIONS = {
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
    ignoreDeclaration: false,
    commentPropName: "#comment",
} as const;

const parser = new XMLParser(OPTIONS);
const builder = new XMLBuilder({...OPTIONS, format: true, indentBy: "  ", suppressEmptyNode: true});

type OrderedNode = Record<string, unknown>;

/** 一个条目（有序解析树里的 `<item>` 节点）。整棵子树随目录搬时原样带走，展示名与嵌套条目都在里面。 */
export interface ItemNode {
    readonly node: OrderedNode;
}

/** 清单里一层条目的位置：内容根下目录的名字序列，根这一层为空。 */
export type Level = ReadonlyArray<string>;

export type Edit =
    /**
     * 加一个条目；`before` 是同层另一个条目的名字，缺省或不在这一层时放到末尾。已有同名条目时：文件操作不变（清单里本来
     * 就有这个缺失条目），用户的“加入清单”（`strict`）为 `absent`。
     */
    | {readonly kind: "insert"; readonly level: Level; readonly item: ItemNode; readonly before?: string; readonly strict?: boolean}
    | {readonly kind: "remove"; readonly level: Level; readonly name: string}
    | {readonly kind: "rename"; readonly level: Level; readonly from: string; readonly to: string}
    /** `names` 必须恰好是这一层现有条目的一个排列。 */
    | {readonly kind: "reorder"; readonly level: Level; readonly names: ReadonlyArray<string>}
    /** `null` 去掉，`undefined` 不改。 */
    | {readonly kind: "display"; readonly level: Level; readonly name: string; readonly title?: string | null; readonly icon?: string | null};

export type EditOutcome =
    | {readonly status: "changed"; readonly text: string; readonly removed?: ItemNode}
    | {readonly status: "unchanged"; readonly removed?: ItemNode}
    /** 当前清单不合法：不改。 */
    | {readonly status: "invalid"; readonly detail: string}
    /** 修改的对象不在清单里（条目、所在层）或排列不对：只改清单的操作据此拒绝，文件操作据此跳过清单。 */
    | {readonly status: "absent"; readonly detail: string};

/** 只有名字的新条目。 */
export function plainItem(name: string): ItemNode {
    return {node: {"item": [], ":@": {name}}};
}

/** 换了名字的同一个条目（子树、展示名不变）；用于跨内容树移动与复制。 */
export function renamedItem(item: ItemNode, name: string): ItemNode {
    return {node: {...item.node, ":@": {...attributesOf(item.node), name}}};
}

/** 一层的条目名（清单合法时）；层不在清单里为 `null`。 */
export function namesAt(text: string, level: Level): ReadonlyArray<string> | null {
    const parsed = parse(text);
    if (parsed === null) return null;
    const children = childrenAt(parsed, level);
    return children === null ? null : children.filter(isItem).map((node) => attributesOf(node).name as string);
}

/** 从现有子项生成新清单（转为内容文件夹时）。 */
export function generateManifest(names: ReadonlyArray<string>): string {
    const tree = [
        {"?xml": [{"#text": ""}], ":@": {version: "1.0", encoding: "UTF-8"}},
        {content: names.map((name) => plainItem(name).node)},
    ];
    return finish(builder.build(tree) as string);
}

export function applyEdit(text: string, edit: Edit): EditOutcome {
    const checked = parseManifest(text);
    if (!checked.ok) return {status: "invalid", detail: checked.detail};
    const tree = parse(text);
    if (tree === null) return {status: "invalid", detail: "XML 无法解析"};
    const children = childrenAt(tree, edit.level);
    if (children === null) return {status: "absent", detail: `${edit.level.join("/") || "根"} 这一层不在清单里`};
    const at = (name: string): number => children.findIndex((node) => isItem(node) && attributesOf(node).name === name);
    let removed: ItemNode | undefined;
    switch (edit.kind) {
        case "insert": {
            const name = attributesOf(edit.item.node).name as string;
            if (at(name) >= 0) return edit.strict === true ? {status: "absent", detail: `${name} 已在清单里`} : {status: "unchanged"};
            const before = edit.before === undefined ? -1 : at(edit.before);
            children.splice(before < 0 ? children.length : before, 0, edit.item.node);
            break;
        }
        case "remove": {
            const index = at(edit.name);
            if (index < 0) return {status: "absent", detail: `${edit.name} 不在清单里`};
            removed = {node: children.splice(index, 1)[0] as OrderedNode};
            break;
        }
        case "rename": {
            const index = at(edit.from);
            if (index < 0) return {status: "absent", detail: `${edit.from} 不在清单里`};
            if (at(edit.to) >= 0) return {status: "absent", detail: `清单里已有 ${edit.to}`};
            const node = children[index] as OrderedNode;
            children[index] = {...node, ":@": {...attributesOf(node), name: edit.to}};
            break;
        }
        case "reorder": {
            const items = children.filter(isItem);
            const current = items.map((node) => attributesOf(node).name as string);
            if (edit.names.length !== current.length || new Set(edit.names).size !== edit.names.length || edit.names.some((name) => !current.includes(name))) {
                return {status: "absent", detail: "顺序必须恰好列出这一层清单里的全部条目"};
            }
            // 注释留在原来的槽位上，条目按新顺序填进条目的槽位。
            const byName = new Map(items.map((node) => [attributesOf(node).name as string, node]));
            let next = 0;
            for (let index = 0; index < children.length; index += 1) {
                if (isItem(children[index] as OrderedNode)) children[index] = byName.get(edit.names[next++] as string) as OrderedNode;
            }
            break;
        }
        case "display": {
            const index = at(edit.name);
            if (index < 0) return {status: "absent", detail: `${edit.name} 不在清单里`};
            const node = children[index] as OrderedNode;
            const attributes: Record<string, string> = {...attributesOf(node)};
            for (const key of ["title", "icon"] as const) {
                const value = edit[key];
                if (value === null) delete attributes[key];
                else if (value !== undefined) attributes[key] = value;
            }
            children[index] = {...node, ":@": attributes};
            break;
        }
    }
    const next = finish(builder.build(tree) as string);
    if (next === text) return removed === undefined ? {status: "unchanged"} : {status: "unchanged", removed};
    const valid = parseManifest(next);
    if (!valid.ok) return {status: "invalid", detail: `修改后的清单不合法：${valid.detail}`};
    return removed === undefined ? {status: "changed", text: next} : {status: "changed", text: next, removed};
}

/** 一层里的一个条目（复制时取源条目的子树）。 */
export function itemAt(text: string, level: Level, name: string): ItemNode | null {
    const tree = parse(text);
    const children = tree === null ? null : childrenAt(tree, level);
    const node = children?.find((candidate) => isItem(candidate) && attributesOf(candidate).name === name);
    return node === undefined ? null : {node: structuredClone(node)};
}

function parse(text: string): OrderedNode[] | null {
    try {
        return parser.parse(text) as OrderedNode[];
    } catch {
        // 校验已由 parseManifest 做过并给出原因；这里只需要知道能不能拿到树。
        return null;
    }
}

/** 一层条目所在的子节点数组（可原地修改）；层不在清单里为 `null`。 */
function childrenAt(tree: OrderedNode[], level: Level): OrderedNode[] | null {
    const root = tree.find((node) => Object.hasOwn(node, "content"));
    if (root === undefined) return null;
    let children = root.content as OrderedNode[];
    for (const name of level) {
        const item = children.find((node) => isItem(node) && attributesOf(node).name === name);
        if (item === undefined) return null;
        children = item.item as OrderedNode[];
    }
    return children;
}

function isItem(node: OrderedNode): boolean {
    return Object.hasOwn(node, "item");
}

function attributesOf(node: OrderedNode): Record<string, string> {
    return (node[":@"] ?? {}) as Record<string, string>;
}

/** 没有 XML 声明时构建器在第一个元素前多出空行。 */
function finish(text: string): string {
    const trimmed = text.replace(/^\n+/u, "");
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}
