/**
 * `nbook.plot/author`（docs/specs/plot/author-ui.md 的“输入与前置条件”）：作者界面用的剧情读取，项目实例提供。现有的
 * `nbook.plot/world`、`nbook.plot/checks` 给写手上下文、检查与 Agent 工具用，口径不同，不动。
 *
 * 每个方法用同一份读取输入算出一个页面块要的全部东西；结果都带 `version`、`inputDigest`、实际读的线 `line` 与名字表 `names`
 * （结果里引用到的条目在同一线、位置、模式上的名字）。读取结果的形状由 `core/author/` 给出，链路上不逐字段核对（同 canon 的远程合同）。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {ReadPositionSchema} from "@notnotype/nb-canon/schema";
import {Type} from "typebox";
import type {Static} from "typebox";

const Mode = Type.Union([Type.Literal("actual"), Type.Literal("planned")]);
const Out = Type.Unknown();
const errors = {plot: Type.Object({code: Type.String()})};
const At = {position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode)};
/** 列表的一页（同 canon.project 输出 18）：一页至多 200 条。 */
const Page = {cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 200}))};

const methods = {
    /** 人物页：他的知情（plot/knowledge.md 输出 16）、目标与态度（plot/goals.md 输出 6）。 */
    person: {input: Type.Object({person: Type.String(), ...At}), output: Out, effect: "read", errors},
    /** 秘密的“谁知道”（plot/knowledge.md 输出 15）。 */
    point: {input: Type.Object({point: Type.String(), ...At}), output: Out, effect: "read", errors},
    /** 保密表的一页、全表的分段条数、候选的人与主要角色（plot/knowledge.md 输出 14）；`people` 是表的列。 */
    secrets: {
        input: Type.Object({
            ...At,
            segment: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("readerOnly"), Type.Literal("readerUnaware"), Type.Literal("noPlan")])),
            people: Type.Optional(Type.Array(Type.String(), {maxItems: 12})),
            ...Page,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    /** 作者用的目标表（plot/goals.md 输出 6）：主要角色一组一组；`finished` 时另列达成与放弃的。 */
    goals: {input: Type.Object({...At, holder: Type.Optional(Type.String()), finished: Type.Optional(Type.Boolean()), ...Page}), output: Out, effect: "read", errors},
    /** 作者用的伏笔账本（plot/foreshadowing.md 输出 9）：一页、全表的分段条数。 */
    ledger: {
        input: Type.Object({...At, segment: Type.Optional(Type.Union([Type.Literal("unpaid"), Type.Literal("silent"), Type.Literal("unplanned"), Type.Literal("dropped"), Type.Literal("all")])), ...Page}),
        output: Out,
        effect: "read",
        errors,
    },
    /** 作者用的经历（plot/knowledge.md 输出 17）：从新到旧分页。 */
    experience: {input: Type.Object({person: Type.String(), ...At, ...Page}), output: Out, effect: "read", errors},
} as const;

export const plotAuthorContract = defineRemoteService({id: "nbook.plot/author", version: 1, provider: "project", callers: ["browser"], methods, events: {}});

export type PlotAuthorMethod = keyof typeof methods;
export type PlotAuthorInput<M extends PlotAuthorMethod> = Static<(typeof methods)[M]["input"]>;
