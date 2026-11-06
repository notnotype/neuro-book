/**
 * 项目入口经它调模型（docs/specs/plot/checks.md 边界）。`modelsKey` 只在服务端进程，剧情插件的计算在项目子进程，所以隔一层远程合同。它实际上是个
 * 通用的模型网关，所以提供方只认本插件的项目入口。第二个项目侧调用方出现时把它上移到 `nbook.models`。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";
import type {Static} from "typebox";

const Usage = Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), cost: Type.Union([Type.Number(), Type.Null()])});

/** 一次调用的结果：只传错误的类别与码，不传错误文字（遮盖过，但没有必要过这条通道）。 */
const AskOutcome = Type.Union([
    Type.Object({outcome: Type.Literal("answer"), answer: Type.Unknown(), usage: Usage}),
    /** 撞上输出上限。`capped`：这次已经是模型的上限，加大也没用。 */
    Type.Object({outcome: Type.Literal("length"), capped: Type.Boolean(), usage: Usage}),
    Type.Object({outcome: Type.Literal("aborted"), usage: Usage}),
    Type.Object({outcome: Type.Literal("failed"), kind: Type.String(), usage: Usage}),
]);
export type AskOutcome = Static<typeof AskOutcome>;

/** 调用方不是本插件的项目入口。 */
const errors = {"wrong-caller": Type.Undefined()};

const methods = {
    /** 两个角色都解析得出时 `problem` 是 null，否则是解析失败的码（不发请求，不花钱）。 */
    available: {input: Type.Object({}), output: Type.Object({problem: Type.Union([Type.String(), Type.Null()])}), effect: "read", errors},
    ask: {
        input: Type.Object({
            role: Type.Union([Type.Literal("ledger"), Type.Literal("reader")]),
            system: Type.String(),
            user: Type.String(),
            answer: Type.Union([Type.Literal("yesNo"), Type.Literal("object"), Type.Literal("fixed"), Type.Literal("trial"), Type.Literal("judge")]),
            maxTokens: Type.Integer({minimum: 1}),
        }),
        output: AskOutcome,
        effect: "read",
        errors,
    },
} as const;

export const plotModelContract = defineRemoteService({id: "nbook.plot/model", version: 1, provider: "server", callers: ["project"], methods, events: {}});
