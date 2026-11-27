import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {CANON_COMPONENTS_POINT, CANON_DIAGNOSTICS_POINT, CANON_ENTRY_KINDS_POINT, CANON_MARKS_POINT, PERSON_MAIN_PRESET} from "nbook/plugins/canon/shared/contracts";

import {COMPONENT_IDS, ENTRY_TYPES, PLOT_COMPONENTS, PLOT_DIAGNOSTICS, PLOT_MARKS, PLOT_PLUGIN_ID} from "./shared/declarations";

/**
 * 剧情插件（docs/specs/plot/）：知识点与知情、伏笔、角色的目标与态度、决策的守卫、写作指示与写完以后的检查，建在世界引擎的
 * 条目、Component、讲述、标注与在场之上（ADR 0041），不改内核的格式。声明是顶层贡献；项目入口登记诊断的计算、提供读取视图；
 * 服务端入口替项目入口调模型（`modelsKey` 只在服务端进程）。浏览器入口是剧情侧的作者界面（`web/`，docs/specs/plot/author-ui.md）。
 */
export const descriptor: PluginDescriptor = {
    id: PLOT_PLUGIN_ID,
    version: PRODUCT_VERSION,
    locations: ["project", "server", "browser"],
    contributions: [
        ...PLOT_COMPONENTS.map(({id, ...declaration}) => ({capability: CANON_COMPONENTS_POINT, id, declaration})),
        ...PLOT_MARKS.map(({id, ...declaration}) => ({capability: CANON_MARKS_POINT, id, declaration})),
        ...PLOT_DIAGNOSTICS.map(({id, ...declaration}) => ({capability: CANON_DIAGNOSTICS_POINT, id, declaration})),
        // 人物的“主要角色”预设（设定插件内置的，author-ui.md 输入一节）里追加剧情的两组：知道什么、目标与态度。
        {capability: CANON_ENTRY_KINDS_POINT, id: `${PLOT_PLUGIN_ID}.person`, declaration: {kind: ENTRY_TYPES.person, presets: [{id: PERSON_MAIN_PRESET, components: [COMPONENT_IDS.knowing, COMPONENT_IDS.attitude]}]}},
    ],
};
