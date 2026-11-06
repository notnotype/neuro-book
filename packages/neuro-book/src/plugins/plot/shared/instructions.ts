/**
 * 章的写作指示快照（docs/specs/plot/decisions.md 输入）与推送它的远程服务 `nbook.plot/instructions`。
 *
 * 快照不存进世界，由宿主（写作任务）推给剧情插件，存成插件的项目记录（`backend/store.ts`）。
 * 推送是写操作（`effect: "write"`）。调用方含浏览器：写作指示是作者在界面上写的，写作任务不是唯一的写入者；服务端的调用方没有绑定项目（
 * 经项目路由才到得了项目实例），所以不能只给 `server`。多个写入者用 `put` 的 `base` 防互相覆盖。
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

export const plotInstructionsContract = defineRemoteService({id: "nbook.plot/instructions", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});
