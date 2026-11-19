/**
 * 剧情侧几张表的页面状态与名字（docs/specs/plot/author-ui.md 输出 1 到 3）：页面组件与入口共用，放在 `.ts` 里（`.vue` 里导出的类型
 * 普通的类型检查看不到）。
 */

import type {LedgerSegment} from "../core/author/ledger";
import type {SecretSegment} from "../core/author/secrets";
import {plotText} from "../shared/text";

export type PlotTable = "secrets" | "ledger" | "goals";

/** 三张表的标题（约定键），侧栏与面包屑共用。 */
export const TABLE_TITLES = {secrets: "editorPages.secrets.title", ledger: "editorPages.ledger.title", goals: "editorPages.goals.title"} as const;
export const tableTitle = (table: PlotTable) => plotText(TABLE_TITLES[table]);

/** “谁知道什么”标签的状态。 */
export interface SecretsPageState {
    /** 位置选择的值；空串是缺省位置。 */
    position: string;
    planned: boolean;
    segment: SecretSegment;
    /** 选的人；null 是还没选过（服务按缺省选）。 */
    people: string[] | null;
}

/** 伏笔账本标签的状态。 */
export interface LedgerPageState {
    position: string;
    planned: boolean;
    segment: LedgerSegment;
}

/** 目标表标签的状态。 */
export interface GoalsPageState {
    position: string;
    planned: boolean;
    /** 只看这个人；null 是所有主要角色。 */
    holder: string | null;
    /** 也列达成与放弃的。 */
    finished: boolean;
    /** 收起的组（持有者 id）。 */
    collapsed: string[];
}
