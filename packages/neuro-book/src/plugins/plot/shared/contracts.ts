/**
 * `nbook.plot` 的远程合同（docs/specs/plot/knowledge.md 输出 3、6 到 9，foreshadowing.md 输出 8，goals.md 输出 2）：剧情的读取视图，项目实例提供。读取结果的形状由
 * `core/` 给出，链路上不逐字段核对（同 canon 的远程合同）。
 *
 * 按视角的视图（输出 9）：`openViewpoint` 给调用方一个句柄，之后的 `viewpoint*` 方法带它读；内核的视图令牌只在项目进程里，
 * 不交给调用方（拿着它直接调 canon 就绕过了这里的过滤）。句柄的寿命不超过申请它的调用方实例，`closeViewpoint` 或调用方
 * 实例失效即失效，之后用它得到 `view-denied`。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {ReadPositionSchema} from "@notnotype/nb-canon/schema";
import {Type} from "typebox";
import type {Static} from "typebox";

const Mode = Type.Union([Type.Literal("actual"), Type.Literal("planned")]);
const TellingPositionSchema = Type.Union([
    Type.Object({chapter: Type.String(), paragraph: Type.Integer({minimum: 1})}),
    Type.Object({chapter: Type.String(), edge: Type.Union([Type.Literal("start"), Type.Literal("end")])}),
]);
const Out = Type.Unknown();
/** 列表的一页（canon.project 输出 18）：游标绑读取输入与查询参数，缺省 50 条；编码后超过单次预算时服务端减半条数重取。 */
const Page = {cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 500}))};
const errors = {plot: Type.Object({code: Type.String()})};

const methods = {
    /** 某人在一个读取位置上的有效知情（输出 3）：给了知识点只给那一行。 */
    knowing: {input: Type.Object({person: Type.String(), point: Type.Optional(Type.String()), position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode), ...Page}), output: Out, effect: "read", errors},
    /** 某人到一个读取位置为止的经历（输出 8）：在场的剧情变更（整条，按先后，分页）与没记参与者的变更数；他的有效知情用 `knowing` 读。 */
    experience: {input: Type.Object({person: Type.String(), position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode), ...Page}), output: Out, effect: "read", errors},
    /** 一个目标在一个读取位置上的冲突（goals.md 输出 2）：自己写的加上写了它的，两边都只列这个位置上在的目标。 */
    conflicts: {input: Type.Object({goal: Type.String(), position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode)}), output: Out, effect: "read", errors},
    /** 读者在一个讲述位置上对一个知识点的程度（输出 6），与读者第一次到怀疑、知道的讲述（输出 7）。 */
    reader: {input: Type.Object({point: Type.String(), at: TellingPositionSchema}), output: Out, effect: "read", errors},
    /** 伏笔的账本（foreshadowing.md 输出 8）：可按阶段、重要程度、意图、章的范围筛。 */
    ledger: {
        input: Type.Object({
            position: Type.Optional(ReadPositionSchema),
            mode: Type.Optional(Mode),
            filter: Type.Optional(Type.Object({
                stage: Type.Optional(Type.Union([Type.Literal("unplanted"), Type.Literal("planted"), Type.Literal("echoing"), Type.Literal("partial"), Type.Literal("paidOff")])),
                importance: Type.Optional(Type.String()),
                intent: Type.Optional(Type.String()),
                from: Type.Optional(Type.String()),
                to: Type.Optional(Type.String()),
            }, {additionalProperties: false})),
            ...Page,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    /** 目标表（goals.md 输出 5）：每个主要角色在一个读取位置上的目标与态度，可按持有者、状态筛。 */
    goals: {input: Type.Object({position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode), filter: Type.Optional(Type.Object({holder: Type.Optional(Type.String()), status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("blocked"), Type.Literal("achieved"), Type.Literal("abandoned")]))}, {additionalProperties: false})), ...Page}), output: Out, effect: "read", errors},
    /** 涉及一章的决策（decisions.md 输出 7）：已定的在前；未写的章按计划模式。 */
    decisionsFor: {input: Type.Object({chapter: Type.String(), mode: Type.Optional(Mode), ...Page}), output: Out, effect: "read", errors},
    /** 开写前的视图（decisions.md 输出 6）：只在这一章讲的线上算。 */
    beforeWriting: {input: Type.Object({chapter: Type.String()}), output: Out, effect: "read", errors},
    /** 写手的上下文（brief.md）：写作指示取项目实例里推进来的快照；细纲、目标字数由调用方给，上一章末尾取自正文快照。插件版本不由调用方给。 */
    brief: {input: Type.Object({chapter: Type.String(), outline: Type.String({maxLength: 200_000}), targetWords: Type.Integer({minimum: 1}), limits: Type.Optional(Type.Record(Type.String(), Type.Integer({minimum: 1})))}), output: Out, effect: "read", errors},
    /** 给看的人开一张视图；`line` 不写时按活页夹上限那一章讲的线（canon.worldlines 输出 12）。 */
    openViewpoint: {input: Type.Object({viewer: Type.Union([Type.String(), Type.Null()]), until: ReadPositionSchema, purpose: Type.String(), line: Type.Optional(Type.String())}), output: Out, effect: "read", errors},
    closeViewpoint: {input: Type.Object({handle: Type.String()}), output: Type.Null(), effect: "read", errors},
    viewpointEntry: {input: Type.Object({handle: Type.String(), id: Type.String()}), output: Out, effect: "read", errors},
    viewpointLookup: {input: Type.Object({handle: Type.String(), names: Type.Array(Type.String(), {maxItems: 200})}), output: Out, effect: "read", errors},
    viewpointExperience: {input: Type.Object({handle: Type.String(), ...Page}), output: Out, effect: "read", errors},
    viewpointKnowing: {input: Type.Object({handle: Type.String(), who: Type.String(), ...Page}), output: Out, effect: "read", errors},
} as const;

export const plotWorldContract = defineRemoteService({id: "nbook.plot/world", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});

export type PlotMethod = keyof typeof methods;
export type PlotInput<M extends PlotMethod> = Static<(typeof methods)[M]["input"]>;
