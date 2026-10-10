/**
 * 书架上一部作品的样子（docs/proposals/bookshelf.md）：登记项、作品自己的信息与统计摘要。两端共用，不碰 DOM、Bun 与
 * Node API。统计只读缓存，`freshness` 说明它是不是最新的，界面不把旧快照当实时值。
 */

import type {ProjectView} from "./contracts";

export type ShelfFreshness = "fresh" | "stale" | "none";

export interface ShelfLastEdit {
    /** 资源地址，继续写作打开它。 */
    readonly address: string;
    /** 显示用的片段名（文件名去掉扩展名，或清单里的标题）。 */
    readonly label: string;
    /** ISO 时间。 */
    readonly at: string;
    /** 该文件最后一个非空段落的前一百来个字。 */
    readonly excerpt: string;
}

export interface ShelfStats {
    /** fresh：项目正在运行，统计随写入更新；stale：项目没在运行，是某时刻的快照；none：从没统计过。 */
    readonly freshness: ShelfFreshness;
    /** ISO 时间；none 时为 null。 */
    readonly computedAt: string | null;
    readonly words: number;
    /** 计入的文件数（篇）。 */
    readonly files: number;
    /** 今天净增的字数；统计不是今天的为 null。 */
    readonly today: number | null;
    readonly last: ShelfLastEdit | null;
}

export interface ShelfItem {
    readonly id: string;
    /** 登记表的短名：地址栏的句柄，书名缺省时也用它显示。 */
    readonly name: string;
    readonly title: string | null;
    readonly description: string | null;
    /** `#rrggbb`；没有时按 id 在主题色板里取一档。 */
    readonly color: string | null;
    readonly path: string;
    readonly state: ProjectView["state"];
    readonly stats: ShelfStats;
}

/** 作品的显示名：书名优先，没有时用短名。书架、标题栏的项目切换与窗口标题都经它。 */
export function projectDisplayName(project: {readonly name: string; readonly title: string | null}): string {
    return project.title ?? project.name;
}
