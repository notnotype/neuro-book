/**
 * 章的写作指示快照（docs/specs/plot/decisions.md 输入）与推送它的远程服务 `nbook.plot/instructions`。
 *
 * 快照不存进世界，由宿主（写作任务）推给剧情插件；阶段 E 放在项目实例的内存里（`backend/instructions.ts`），存处随阶段 F。
 * 推送是写操作，只给 `server` 调用方：浏览器页面不能替换写作任务推进来的快照。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";
import type {Static} from "typebox";

const Text = Type.String({maxLength: 20_000});
/** 补叙的安放：前史里某一处，或某一章里某个键（不带世界线：补叙读的是本章讲的线）。 */
const FlashbackPlacement = Type.Union([
    Type.Object({kind: Type.Literal("prehistory"), order: Type.Number()}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("chapter"), chapter: Type.String(), key: Type.Number()}, {additionalProperties: false}),
]);
const Ref = Type.Object({kind: Type.Literal("entry"), id: Type.String()}, {additionalProperties: false});

/** 章的写作指示快照：`chapter`、`version` 必有，其余都可选（Spec decisions 输入）。 */
export const InstructionSnapshotSchema = Type.Object({
    chapter: Type.String(),
    version: Type.String(),
    readerChange: Type.Optional(Text),
    pov: Type.Optional(Ref),
    povMode: Type.Optional(Type.Union([Type.Literal("first"), Type.Literal("limited"), Type.Literal("omniscient")])),
    timeMode: Type.Optional(Type.Union([
        Type.Literal("follow"),
        Type.Object({parallel: Type.String()}, {additionalProperties: false}),
        Type.Object({flashback: FlashbackPlacement}, {additionalProperties: false}),
    ])),
    tone: Type.Optional(Text),
    opening: Type.Optional(Text),
    ending: Type.Optional(Text),
    avoid: Type.Optional(Type.Array(Text, {maxItems: 200})),
    other: Type.Optional(Text),
}, {additionalProperties: false});

export type InstructionSnapshot = Static<typeof InstructionSnapshotSchema>;

const errors = {plot: Type.Object({code: Type.String()})};

const methods = {
    /** 按章替换一份快照（`snapshot` 为 null 是删除）；带 `base`（当前表的数据版本）时对不上回 `instructions-conflict`。 */
    put: {input: Type.Object({chapter: Type.String(), snapshot: Type.Union([InstructionSnapshotSchema, Type.Null()]), base: Type.Optional(Type.String())}), output: Type.Object({dataVersion: Type.String()}), effect: "write", errors},
    /** 当前表的数据版本，作 `put` 的 `base`。 */
    current: {input: Type.Object({}), output: Type.Object({dataVersion: Type.String()}), effect: "read", errors},
} as const;

export const plotInstructionsContract = defineRemoteService({id: "nbook.plot/instructions", version: 1, provider: "project", callers: ["server"], methods, events: {}});
