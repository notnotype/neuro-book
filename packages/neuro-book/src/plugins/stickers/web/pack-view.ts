/**
 * 表情包页的视图模型（docs/specs/agent/stickers.md 输出 25 到 27）：左栏分组、网格分组、选中键与方向键移动。纯函数，不碰 DOM，
 * 组件与测试都用它。
 */

import type {StickerPackDetail, StickerPackSummary} from "../shared/contracts";

export interface RailGroup {
    /** `mine` 或插件 id。 */
    readonly id: string;
    /** 插件的显示名（没有时是插件 id）；“我的”为 null，由界面写文字。 */
    readonly title: string | null;
    readonly user: boolean;
    readonly items: readonly StickerPackSummary[];
}

/** 左栏：“我的”在前，然后每个插件一组，按显示名（再按 id）排；没有包的插件组不画，“我的”照样画（有“新建”）。 */
export function railGroups(packs: readonly StickerPackSummary[]): RailGroup[] {
    const byId = (left: StickerPackSummary, right: StickerPackSummary): number => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const plugins = new Map<string, {title: string; items: StickerPackSummary[]}>();
    for (const pack of packs.filter((item) => item.source === "plugin")) {
        const id = pack.plugin?.id ?? "plugin";
        const group = plugins.get(id) ?? {title: pack.plugin?.title ?? id, items: []};
        group.items.push(pack);
        plugins.set(id, group);
    }
    const mine: RailGroup = {id: "mine", title: null, user: true, items: packs.filter((item) => item.source === "user").sort(byId)};
    const rest = [...plugins].sort(([leftId, left], [rightId, right]) => (left.title < right.title ? -1 : left.title > right.title ? 1 : leftId < rightId ? -1 : 1))
        .map(([id, group]): RailGroup => ({id, title: group.title, user: false, items: group.items.sort(byId)}));
    return [mine, ...rest];
}

/** 第一次打开选中谁：“我的”里的第一个，没有就是第一组的第一个。 */
export function firstPackId(groups: readonly RailGroup[]): string | null {
    for (const group of groups) if (group.items[0] !== undefined) return group.items[0].id;
    return null;
}

export type GridGroupId = "problem" | "common" | "other" | "unlisted";

/** 网格里的一格：表情，或认不出的、没加进来的图。 */
export interface GridItem {
    /** 选中键：表情是文件名加名字，extras 是文件名。 */
    readonly key: string;
    readonly kind: "sticker" | "extra";
    readonly file: string;
    /** 格子下写的字：表情写名字，认不出与没加进来的写文件名。 */
    readonly label: string;
    readonly url: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    /** 名字输入框里的值：表情是现在的名字（省略名字时是文件名推出来的），extras 是清单里写的原样、没写为 null。 */
    readonly name: string | null;
    /** 清单里这一项写的名字原样，没写为 null：写入按它精确定位清单项（同一个文件写了两项时靠它区分）。 */
    readonly raw: string | null;
    readonly common: boolean;
    readonly description?: string;
}

export interface GridGroup {
    readonly id: GridGroupId;
    readonly items: readonly GridItem[];
}

export const stickerKey = (file: string, name: string): string => `s:${file}\u0000${name}`;
export const extraKey = (file: string): string => `e:${file}`;

/** 网格分组：认不出的在最前（要处理），常用、其他，没加进来的在最后；没有的组不画。 */
export function gridGroups(detail: StickerPackDetail): GridGroup[] {
    const stickers = detail.stickers.map((sticker): GridItem => ({
        key: stickerKey(sticker.file, sticker.name),
        kind: "sticker",
        file: sticker.file,
        label: sticker.name,
        url: sticker.url,
        width: sticker.width,
        height: sticker.height,
        bytes: sticker.bytes,
        name: sticker.name,
        raw: sticker.raw ?? null,
        common: sticker.common,
        ...(sticker.description === undefined ? {} : {description: sticker.description}),
    }));
    const extras = detail.extras.map((extra): GridItem => ({
        key: extraKey(extra.file),
        kind: "extra",
        file: extra.file,
        label: extra.file,
        url: extra.url,
        width: extra.width,
        height: extra.height,
        bytes: extra.bytes,
        name: extra.raw,
        raw: extra.raw,
        common: false,
    }));
    const groups: GridGroup[] = [
        {id: "problem", items: extras.filter((item, index) => detail.extras[index]?.reason === "name")},
        {id: "common", items: stickers.filter((item) => item.common)},
        {id: "other", items: stickers.filter((item) => !item.common)},
        {id: "unlisted", items: extras.filter((item, index) => detail.extras[index]?.reason === "unlisted")},
    ];
    return groups.filter((group) => group.items.length > 0);
}

/** “添加”格排在最后一个有表情的组（常用或其他）末尾；一个有表情的组也没有时为 null（单独一行）。 */
export function addCellGroup(groups: readonly GridGroup[]): GridGroupId | null {
    const last = groups.filter((group) => group.id === "common" || group.id === "other").at(-1);
    return last?.id ?? null;
}

export type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * 方向键移动选中（输出 26）：左右按全部表情的顺序跨组接续，Home、End 到头尾；上下按当前组实际的列数（`columns`，布局量出来的）移动，
 * 到组边就进上一组的末行或下一组的首行同列，没有同列取该行最后一格。没有当前选中时从头（或从尾）开始。
 */
export function moveSelection(groups: readonly GridGroup[], current: string | null, key: NavigationKey, columns: number): string | null {
    const flat = groups.flatMap((group) => group.items);
    if (flat.length === 0) return null;
    const first = flat[0]!.key;
    const last = flat[flat.length - 1]!.key;
    if (key === "Home") return first;
    if (key === "End") return last;
    const at = flat.findIndex((item) => item.key === current);
    if (at < 0) return key === "ArrowLeft" || key === "ArrowUp" ? last : first;
    if (key === "ArrowLeft") return flat[Math.max(0, at - 1)]!.key;
    if (key === "ArrowRight") return flat[Math.min(flat.length - 1, at + 1)]!.key;
    const cols = Math.max(1, columns);
    const groupIndex = groups.findIndex((group) => group.items.some((item) => item.key === current));
    const group = groups[groupIndex]!;
    const index = group.items.findIndex((item) => item.key === current);
    const column = index % cols;
    if (key === "ArrowUp") {
        if (index >= cols) return group.items[index - cols]!.key;
        const previous = groups[groupIndex - 1];
        if (previous === undefined) return current;
        return previous.items[Math.min(Math.floor((previous.items.length - 1) / cols) * cols + column, previous.items.length - 1)]!.key;
    }
    const lastRow = Math.floor((group.items.length - 1) / cols);
    if (Math.floor(index / cols) < lastRow) return group.items[Math.min(index + cols, group.items.length - 1)]!.key;
    const next = groups[groupIndex + 1];
    if (next === undefined) return current;
    return next.items[Math.min(column, next.items.length - 1)]!.key;
}

/** 删掉选中的格子之后焦点去哪：下一格，没有就上一格，再没有为 null（回到“添加”格或表情包）。 */
export function afterRemoval(groups: readonly GridGroup[], removed: string): string | null {
    const flat = groups.flatMap((group) => group.items);
    const at = flat.findIndex((item) => item.key === removed);
    if (at < 0) return null;
    return flat[at + 1]?.key ?? flat[at - 1]?.key ?? null;
}

/** 字节数的显示：KB 或 MB，一位小数。 */
export function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
