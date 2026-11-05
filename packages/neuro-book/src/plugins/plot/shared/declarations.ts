/**
 * 剧情插件登记进世界引擎的声明（docs/specs/plot/knowledge.md、foreshadowing.md、goals.md 的“输入与前置条件”）：
 * Component 类型、标注种类与诊断，都是顶层贡献，插件不激活也能读。字段的写法见 canon.components。
 *
 * 诊断随给出计算的那一片声明：声明了却没登记计算的诊断会让每次读待处理都标“不完整”（canon.model 输出 34）。
 */

import type {ComponentDeclaration, DiagnosticDeclaration, MarkDeclaration} from "@notnotype/nb-canon/schema";

export const PLOT_PLUGIN_ID = "nbook.plot";

/** 条目的种类（条目的 `type`）：引用的 `targets` 按它们核对。 */
export const ENTRY_TYPES = {point: "知识点", foreshadow: "伏笔", goal: "目标", person: "人物", organization: "组织"} as const;

export const SECRECY = ["common", "trade", "secret", "topSecret"] as const;
export type Secrecy = (typeof SECRECY)[number];
/** `保密` 没写时按保密算（knowledge.md 输入）。 */
export const DEFAULT_SECRECY: Secrecy = "secret";

export const DEGREES = ["knows", "misbelieves", "suspects", "unaware", "forgot"] as const;
export type Degree = (typeof DEGREES)[number];
export const HOW = ["witnessed", "told", "read", "inferred", "other"] as const;
export type How = (typeof HOW)[number];

export const COMPONENT_IDS = {point: `${PLOT_PLUGIN_ID}.point`, knowing: `${PLOT_PLUGIN_ID}.knowing`, foreshadow: `${PLOT_PLUGIN_ID}.foreshadow`, goal: `${PLOT_PLUGIN_ID}.goal`, attitude: `${PLOT_PLUGIN_ID}.attitude`} as const;

export const PLOT_COMPONENTS: readonly ComponentDeclaration[] = [
    {
        id: COMPONENT_IDS.point,
        label: "知识点",
        namespace: "point",
        version: 1,
        fields: [
            {id: "保密", label: "保密", kind: "enum", options: [...SECRECY]},
            {id: "规则", label: "行内的规则", kind: "text"},
            {id: "表现", label: "持有者在人前的表现", kind: "text"},
            {id: "揭穿", label: "揭穿的马甲", kind: "ref"},
            {id: "读者问题", label: "读者要猜的问题", kind: "text"},
        ],
    },
    {
        id: COMPONENT_IDS.knowing,
        label: "知情",
        namespace: "know",
        version: 1,
        fields: [
            {
                id: "知情", label: "知情", kind: "list", keyedBy: "ref", targets: [ENTRY_TYPES.point], carry: true,
                item: [
                    {id: "程度", label: "程度", kind: "enum", options: [...DEGREES]},
                    {id: "他以为的", label: "他以为的", kind: "text"},
                    {id: "怎么知道", label: "怎么知道", kind: "enum", options: [...HOW]},
                    {id: "谁告诉的", label: "谁告诉的", kind: "ref", targets: [ENTRY_TYPES.person, ENTRY_TYPES.organization]},
                    {id: "备注", label: "备注", kind: "text"},
                ],
            },
            {id: "听过的说法", label: "听过的说法", kind: "text", precision: "semantic"},
        ],
    },
    {
        id: COMPONENT_IDS.foreshadow,
        label: "伏笔",
        namespace: "fs",
        version: 1,
        fields: [
            {id: "种类", label: "种类", kind: "enum", options: ["setupPayoff", "mystery", "prophecy", "motif"]},
            {id: "重要程度", label: "重要程度", kind: "enum", options: ["main", "side", "minor"]},
            {id: "意图", label: "意图", kind: "enum", options: ["active", "dropped"]},
            {id: "答案", label: "答案", kind: "ref", targets: [ENTRY_TYPES.point]},
            {id: "物件", label: "依赖的物件", kind: "list", keyedBy: "ref", item: []},
            {id: "参考间隔", label: "参考间隔（章）", kind: "number"},
        ],
    },
    {
        id: COMPONENT_IDS.goal,
        label: "目标",
        namespace: "goal",
        version: 1,
        fields: [
            {id: "状态", label: "状态", kind: "enum", options: ["active", "blocked", "achieved", "abandoned"]},
            {id: "轻重", label: "轻重", kind: "enum", options: ["major", "minor"]},
            {id: "层次", label: "层次", kind: "enum", options: ["want", "need"]},
            {id: "为什么", label: "为什么", kind: "text", precision: "semantic"},
            {id: "基于", label: "基于", kind: "list", keyedBy: "ref", targets: [ENTRY_TYPES.point], item: []},
            {id: "冲突", label: "冲突", kind: "list", keyedBy: "ref", targets: [ENTRY_TYPES.goal], item: []},
            {id: "后继", label: "后继", kind: "ref", targets: [ENTRY_TYPES.goal]},
            {id: "隐秘", label: "隐秘", kind: "ref", targets: [ENTRY_TYPES.point]},
        ],
    },
    {
        id: COMPONENT_IDS.attitude,
        label: "态度",
        namespace: "att",
        version: 1,
        fields: [
            {
                id: "态度", label: "态度", kind: "list", keyedBy: "ref",
                item: [
                    {id: "态度", label: "态度", kind: "text", precision: "semantic"},
                    {id: "起因", label: "起因", kind: "ref", targets: [ENTRY_TYPES.point]},
                    {id: "称呼", label: "称呼", kind: "text"},
                ],
            },
        ],
    },
];

export const MARK_IDS = {reveal: `${PLOT_PLUGIN_ID}.reveal`, presentLearns: `${PLOT_PLUGIN_ID}.presentLearns`, node: `${PLOT_PLUGIN_ID}.node`} as const;

export const PLOT_MARKS: readonly MarkDeclaration[] = [
    {
        id: MARK_IDS.reveal,
        version: 1,
        label: "揭示",
        attachTo: ["telling"],
        schema: {type: "object", properties: {point: {type: "string"}, mode: {enum: ["hint", "explicit"]}}, required: ["point", "mode"], additionalProperties: false},
        refs: [{path: "point", targets: [ENTRY_TYPES.point]}],
    },
    {
        id: MARK_IDS.presentLearns,
        version: 1,
        label: "揭示给在场的人",
        attachTo: ["change"],
        schema: {type: "object", properties: {point: {type: "string"}, degree: {enum: ["knows", "suspects"]}}, required: ["point"], additionalProperties: false},
        refs: [{path: "point", targets: [ENTRY_TYPES.point]}],
    },
    {
        id: MARK_IDS.node,
        version: 1,
        label: "伏笔节点",
        attachTo: ["telling"],
        schema: {type: "object", properties: {foreshadow: {type: "string"}, role: {enum: ["plant", "echo", "mislead", "partial", "payoff"]}, note: {type: "string"}}, required: ["foreshadow", "role"], additionalProperties: false},
        refs: [{path: "foreshadow", targets: [ENTRY_TYPES.foreshadow]}],
    },
];

export const DIAGNOSTIC_IDS = {relayBroken: `${PLOT_PLUGIN_ID}.relayBroken`, knowingIncomplete: `${PLOT_PLUGIN_ID}.knowingIncomplete`} as const;

/** 伏笔的诊断（foreshadowing.md 的诊断表）；`objectTouchedInText` 要窄问题，随阶段 F。 */
export const FS_DIAGNOSTIC_IDS = {
    payoffBeforePlant: `${PLOT_PLUGIN_ID}.fs.payoffBeforePlant`,
    plannedNodeMissing: `${PLOT_PLUGIN_ID}.fs.plannedNodeMissing`,
    replantAfterPayoff: `${PLOT_PLUGIN_ID}.fs.replantAfterPayoff`,
    noPayoffPlanned: `${PLOT_PLUGIN_ID}.fs.noPayoffPlanned`,
    longSilence: `${PLOT_PLUGIN_ID}.fs.longSilence`,
    droppedButPlanted: `${PLOT_PLUGIN_ID}.fs.droppedButPlanted`,
    orphanHint: `${PLOT_PLUGIN_ID}.fs.orphanHint`,
    objectTouched: `${PLOT_PLUGIN_ID}.fs.objectTouched`,
    sharedAnswer: `${PLOT_PLUGIN_ID}.fs.sharedAnswer`,
    nodeWithoutTelling: `${PLOT_PLUGIN_ID}.fs.nodeWithoutTelling`,
    payoffWithoutReveal: `${PLOT_PLUGIN_ID}.fs.payoffWithoutReveal`,
} as const;

/** 已经给出计算的诊断（knowledge.md 的诊断表）；伏笔、目标、决策、写作指示与检查的随各自的那一片加。 */
export const PLOT_DIAGNOSTICS: readonly DiagnosticDeclaration[] = [
    {id: DIAGNOSTIC_IDS.relayBroken, version: 1, level: "pending", label: "传话链断了", key: ["objects", "line"], inputs: "有效的知情（显式的行、在场推出的、隐秘目标推出的）"},
    {id: DIAGNOSTIC_IDS.knowingIncomplete, version: 1, level: "pending", label: "知情行不完整", key: ["objects", "line"], inputs: "知情行与知识点的揭穿"},
    {id: FS_DIAGNOSTIC_IDS.payoffBeforePlant, version: 1, level: "pending", label: "没埋就回收", key: ["objects", "telling"]},
    {id: FS_DIAGNOSTIC_IDS.plannedNodeMissing, version: 1, level: "pending", label: "计划的节点没写", key: ["objects", "line"]},
    {id: FS_DIAGNOSTIC_IDS.replantAfterPayoff, version: 1, level: "pending", label: "回收以后又埋", key: ["objects", "telling"]},
    {id: FS_DIAGNOSTIC_IDS.noPayoffPlanned, version: 1, level: "hint", label: "没排回收", key: ["objects", "line"]},
    {id: FS_DIAGNOSTIC_IDS.longSilence, version: 1, level: "hint", label: "太久没提", key: ["objects"]},
    {id: FS_DIAGNOSTIC_IDS.droppedButPlanted, version: 1, level: "hint", label: "放弃了还留着", key: ["objects"]},
    {id: FS_DIAGNOSTIC_IDS.orphanHint, version: 1, level: "hint", label: "没有悬念认领的暗示", key: ["objects", "telling"]},
    {id: FS_DIAGNOSTIC_IDS.objectTouched, version: 1, level: "hint", label: "物件在回收之前被动过（记了变更）", key: ["objects", "line"]},
    {id: FS_DIAGNOSTIC_IDS.sharedAnswer, version: 1, level: "hint", label: "几个悬念同一个答案", key: ["objects"]},
    {id: FS_DIAGNOSTIC_IDS.nodeWithoutTelling, version: 1, level: "hint", label: "继承的节点没有位置", key: ["objects", "line"]},
    {id: FS_DIAGNOSTIC_IDS.payoffWithoutReveal, version: 1, level: "hint", label: "悬念回收了却没揭示答案", key: ["objects", "telling"]},
];
