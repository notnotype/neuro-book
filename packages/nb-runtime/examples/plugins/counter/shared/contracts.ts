/**
 * `example.counter` 对外公开的合同。别的插件在运行时引用这个文件，直接 `context.remote.use(counterContract)` 调用，
 * 不经本地服务转发：接口只传数据，调用方可能在别的实例（docs/specs/runtime/plugin-api.md 的“选用规则”）。
 * 合同因此是本插件的公开接口，改动要升合同版本。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

const Empty = Type.Object({}, {additionalProperties: false});

/**
 * 提供方按 schema 校验输入与输出，调用方再核对一次输出。合同 id 以插件 id 加 `/` 开头；`provider` 是提供方的
 * 运行位置，`callers` 是允许调用的运行位置。
 */
export const counterContract = defineRemoteService({
    id: "example.counter/remote",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        increment: {input: Type.Object({by: Type.Integer({minimum: 1})}, {additionalProperties: false}), output: Type.Integer(), effect: "write"},
        current: {input: Empty, output: Type.Integer(), effect: "read"},
        /** 演示用：提供方看到的调用方。调用方的身份由内核标记，调用方自己填不了。 */
        caller: {input: Empty, output: Type.Object({plugin: Type.Union([Type.String(), Type.Null()]), instance: Type.String()}, {additionalProperties: false}), effect: "read"},
    },
    events: {
        changed: {filter: Empty, payload: Type.Integer()},
    },
});
