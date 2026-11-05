/**
 * `nbook.plot` 的远程合同（docs/specs/plot/knowledge.md 输出 3、6、7）：剧情的读取视图，项目实例提供。阶段 B 的各片把
 * 方法加进来；按视角过滤的视图在 B3。读取结果的形状由 `core/` 给出，链路上不逐字段核对（同 canon 的远程合同）。
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
const errors = {plot: Type.Object({code: Type.String()})};

const methods = {
    /** 某人在一个读取位置上的有效知情（输出 3）：给了知识点只给那一行。 */
    knowing: {input: Type.Object({person: Type.String(), point: Type.Optional(Type.String()), position: Type.Optional(ReadPositionSchema), mode: Type.Optional(Mode)}), output: Out, effect: "read", errors},
    /** 读者在一个讲述位置上对一个知识点的程度（输出 6），与读者第一次到怀疑、知道的讲述（输出 7）。 */
    reader: {input: Type.Object({point: Type.String(), at: TellingPositionSchema}), output: Out, effect: "read", errors},
} as const;

export const plotWorldContract = defineRemoteService({id: "nbook.plot/world", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events: {}});

export type PlotMethod = keyof typeof methods;
export type PlotInput<M extends PlotMethod> = Static<(typeof methods)[M]["input"]>;
