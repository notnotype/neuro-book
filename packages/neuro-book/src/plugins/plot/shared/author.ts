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

const methods = {
    /** 人物页：他的知情（plot/knowledge.md 输出 16）。 */
    person: {input: Type.Object({person: Type.String(), ...At}), output: Out, effect: "read", errors},
    /** 秘密的“谁知道”（plot/knowledge.md 输出 15）。 */
    point: {input: Type.Object({point: Type.String(), ...At}), output: Out, effect: "read", errors},
} as const;

export const plotAuthorContract = defineRemoteService({id: "nbook.plot/author", version: 1, provider: "project", callers: ["browser"], methods, events: {}});

export type PlotAuthorMethod = keyof typeof methods;
export type PlotAuthorInput<M extends PlotAuthorMethod> = Static<(typeof methods)[M]["input"]>;
