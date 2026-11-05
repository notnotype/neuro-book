import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {CANON_COMPONENTS_POINT, CANON_DIAGNOSTICS_POINT, CANON_MARKS_POINT} from "nbook/plugins/canon/shared/contracts";

import {PLOT_COMPONENTS, PLOT_DIAGNOSTICS, PLOT_MARKS, PLOT_PLUGIN_ID} from "./shared/declarations";

/**
 * 剧情插件（docs/specs/plot/）：知识点与知情、伏笔、角色的目标与态度、决策的守卫、写作指示与写完以后的检查，建在世界引擎的
 * 条目、Component、讲述、标注与在场之上（ADR 0041），不改内核的格式。声明是顶层贡献；项目入口登记诊断的计算、提供读取视图。
 * 阶段 B 只有项目入口（还没有界面）。
 */
export const descriptor: PluginDescriptor = {
    id: PLOT_PLUGIN_ID,
    version: PRODUCT_VERSION,
    locations: ["project"],
    contributions: [
        ...PLOT_COMPONENTS.map(({id, ...declaration}) => ({capability: CANON_COMPONENTS_POINT, id, declaration})),
        ...PLOT_MARKS.map(({id, ...declaration}) => ({capability: CANON_MARKS_POINT, id, declaration})),
        ...PLOT_DIAGNOSTICS.map(({id, ...declaration}) => ({capability: CANON_DIAGNOSTICS_POINT, id, declaration})),
    ],
};
