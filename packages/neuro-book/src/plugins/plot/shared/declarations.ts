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

export const MARK_IDS = {reveal: `${PLOT_PLUGIN_ID}.reveal`, presentLearns: `${PLOT_PLUGIN_ID}.presentLearns`, node: `${PLOT_PLUGIN_ID}.node`, guardAddress: `${PLOT_PLUGIN_ID}.guard.address`, guardReader: `${PLOT_PLUGIN_ID}.guard.reader`, scene: `${PLOT_PLUGIN_ID}.scene`} as const;

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
    {
        // 地址守卫（decisions.md）：某个地址在章的范围里不准取某些值；`lines` 没给时是所有存在的世界线。
        id: MARK_IDS.guardAddress,
        version: 1,
        label: "地址守卫",
        attachTo: ["decision"],
        schema: {
            type: "object",
            properties: {
                at: {type: "object", properties: {entry: {type: "string"}, path: {type: "string"}}, required: ["entry", "path"], additionalProperties: false},
                notIn: {type: "array", items: {anyOf: [{type: "string"}, {type: "number"}, {type: "boolean"}, {type: "null"}]}},
                from: {type: "string"},
                to: {type: "string"},
                lines: {type: "array", items: {type: "string"}},
            },
            required: ["at", "notIn"],
            additionalProperties: false,
        },
        refs: [{path: "at.entry"}, {path: "lines[]", kind: "line"}],
    },
    {
        // 读者守卫：`until` 这一章之前（不含），读者对这个知识点的程度不超过 `atMost`。
        id: MARK_IDS.guardReader,
        version: 1,
        label: "读者守卫",
        attachTo: ["decision"],
        schema: {type: "object", properties: {point: {type: "string"}, atMost: {enum: ["unaware", "suspects"]}, until: {type: "string"}}, required: ["point", "atMost", "until"], additionalProperties: false},
        refs: [{path: "point", targets: [ENTRY_TYPES.point]}],
    },
    {
        // 场景条件（brief.md）：细纲或计划写的时间、光线、谁在哪、先后。
        id: MARK_IDS.scene,
        version: 1,
        label: "场景条件",
        attachTo: ["change"],
        schema: {type: "object", properties: {lines: {type: "array", items: {type: "string"}}}, required: ["lines"], additionalProperties: false},
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
    objectTouchedInText: `${PLOT_PLUGIN_ID}.fs.objectTouchedInText`,
} as const;

/** 目标的诊断（goals.md 的诊断表）。 */
export const GOAL_DIAGNOSTIC_IDS = {
    premiseChanged: `${PLOT_PLUGIN_ID}.goal.premiseChanged`,
    stalled: `${PLOT_PLUGIN_ID}.goal.stalled`,
    skippedStep: `${PLOT_PLUGIN_ID}.goal.skippedStep`,
} as const;

/** 决策的诊断（decisions.md 的诊断表）。`constraintViolated`、`decidedInText` 要窄问题，随阶段 F。 */
export const DECISION_DIAGNOSTIC_IDS = {
    addressGuardViolated: `${PLOT_PLUGIN_ID}.decision.addressGuardViolated`,
    readerGuardViolated: `${PLOT_PLUGIN_ID}.decision.readerGuardViolated`,
    overdue: `${PLOT_PLUGIN_ID}.decision.overdue`,
    dangling: `${PLOT_PLUGIN_ID}.decision.dangling`,
    constraintViolated: `${PLOT_PLUGIN_ID}.decision.constraintViolated`,
    decidedInText: `${PLOT_PLUGIN_ID}.decision.decidedInText`,
} as const;

/** 写完以后的检查的诊断（checks.md 的诊断表）。 */
export const CHECK_DIAGNOSTIC_IDS = {
    possibleSlip: `${PLOT_PLUGIN_ID}.check.possibleSlip`,
    earlyReveal: `${PLOT_PLUGIN_ID}.check.earlyReveal`,
    unrecordedKnowing: `${PLOT_PLUGIN_ID}.check.unrecordedKnowing`,
    unreportedInvention: `${PLOT_PLUGIN_ID}.check.unreportedInvention`,
    instructionViolated: `${PLOT_PLUGIN_ID}.check.instructionViolated`,
    forkSuspected: `${PLOT_PLUGIN_ID}.check.forkSuspected`,
    unasked: `${PLOT_PLUGIN_ID}.check.unasked`,
    noSuspense: `${PLOT_PLUGIN_ID}.check.noSuspense`,
    noReaderQuestion: `${PLOT_PLUGIN_ID}.check.noReaderQuestion`,
    badQuote: `${PLOT_PLUGIN_ID}.check.badQuote`,
    stale: `${PLOT_PLUGIN_ID}.check.stale`,
} as const;

/** 章的写作指示的检查（decisions.md 输出 8，提示）。 */
export const INSTRUCTION_DIAGNOSTIC_IDS = {
    povAbsent: `${PLOT_PLUGIN_ID}.instruction.povAbsent`,
    flashbackMismatch: `${PLOT_PLUGIN_ID}.instruction.flashbackMismatch`,
    repeated: `${PLOT_PLUGIN_ID}.instruction.repeated`,
} as const;

/** 已经给出计算的诊断（knowledge.md 的诊断表）；伏笔、目标、决策、写作指示与检查的随各自的那一片加。 */
const CHECK_INPUTS = "检查记录、世界与正文（记录过期时只报要重跑）";

export const PLOT_DIAGNOSTICS: readonly DiagnosticDeclaration[] = [
    {id: DIAGNOSTIC_IDS.relayBroken, version: 1, level: "pending", label: "传话链断了", key: ["objects", "line"], inputs: "有效的知情（显式的行、在场推出的、隐秘目标推出的）"},
    {id: DIAGNOSTIC_IDS.knowingIncomplete, version: 1, level: "pending", label: "知情行不完整", key: ["objects", "line"], inputs: "知情行与知识点的揭穿"},
    {id: GOAL_DIAGNOSTIC_IDS.premiseChanged, version: 1, level: "pending", label: "前提变了", key: ["objects", "line"], inputs: "目标基于的知识点、持有者的有效知情、目标的改动"},
    {id: GOAL_DIAGNOSTIC_IDS.stalled, version: 1, level: "hint", label: "停滞", key: ["objects", "line"], inputs: "目标最后一次被改所在的章"},
    {id: GOAL_DIAGNOSTIC_IDS.skippedStep, version: 1, level: "hint", label: "缺一步", key: ["objects", "line"], inputs: "目标状态的补丁与涉及它的变更"},
    {id: DECISION_DIAGNOSTIC_IDS.addressGuardViolated, version: 1, level: "pending", label: "违反了地址守卫", key: ["objects", "line", "detail"], inputs: "已定决策的地址守卫、地址的值"},
    {id: DECISION_DIAGNOSTIC_IDS.readerGuardViolated, version: 1, level: "pending", label: "违反了读者守卫", key: ["objects", "telling", "detail"], inputs: "已定决策的读者守卫、读者读过的讲述"},
    {id: INSTRUCTION_DIAGNOSTIC_IDS.povAbsent, version: 1, level: "hint", label: "视角人物不在场", key: ["objects", "range"], inputs: "章的写作指示快照、本章的在场"},
    {id: INSTRUCTION_DIAGNOSTIC_IDS.flashbackMismatch, version: 1, level: "hint", label: "补叙的安放对不上", key: ["range"], inputs: "章的写作指示快照、本章安放的变更"},
    {id: INSTRUCTION_DIAGNOSTIC_IDS.repeated, version: 1, level: "hint", label: "写作指示反复出现", key: ["range"], inputs: "各章的写作指示快照"},
    {id: DECISION_DIAGNOSTIC_IDS.overdue, version: 1, level: "pending", label: "到期没定", key: ["objects"], inputs: "待定决策的到期章与读取位置"},
    {id: DECISION_DIAGNOSTIC_IDS.dangling, version: 1, level: "hint", label: "悬空", key: ["objects"], inputs: "已定决策挂的对象"},
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
    {id: FS_DIAGNOSTIC_IDS.objectTouchedInText, version: 1, level: "hint", label: "正文里动了物件、世界里没记", key: ["objects", "line", "range", "detail"], inputs: CHECK_INPUTS},
    {id: DECISION_DIAGNOSTIC_IDS.constraintViolated, version: 1, level: "pending", label: "违反了已定的约束", key: ["objects", "range"], inputs: CHECK_INPUTS},
    {id: DECISION_DIAGNOSTIC_IDS.decidedInText, version: 1, level: "pending", label: "写死了未定的事", key: ["objects", "range"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.possibleSlip, version: 1, level: "pending", label: "可能穿帮", key: ["objects", "line", "range", "detail"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.earlyReveal, version: 1, level: "pending", label: "提前泄底", key: ["objects", "range"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.unrecordedKnowing, version: 1, level: "pending", label: "正文里有人知道却没有记录", key: ["line", "range", "detail"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.unreportedInvention, version: 1, level: "pending", label: "写手新编了没说", key: ["line", "range", "detail"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.instructionViolated, version: 1, level: "pending", label: "违反写作指示", key: ["range", "detail"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.forkSuspected, version: 1, level: "pending", label: "疑似回溯没记", key: ["line", "range", "detail"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.unasked, version: 1, level: "hint", label: "有没问的", key: ["range"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.noSuspense, version: 1, level: "hint", label: "试读缺材料", key: ["objects"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.noReaderQuestion, version: 1, level: "hint", label: "试读缺问题", key: ["objects"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.badQuote, version: 1, level: "hint", label: "引文对不上", key: ["range"], inputs: CHECK_INPUTS},
    {id: CHECK_DIAGNOSTIC_IDS.stale, version: 1, level: "hint", label: "检查要重跑", key: ["range"], inputs: CHECK_INPUTS},
];
