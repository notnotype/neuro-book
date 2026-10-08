/**
 * `example.counter` 对外公开的合同：两份远程服务合同（服务端一份、项目一份）、一个公开状态键、一条命令的 id。
 *
 * 窗口里的插件在运行时引用这个文件，直接 `context.remote.use(合同)` 调用，不经本地服务转发：接口只传数据，调用方
 * 在别的实例（docs/specs/runtime/plugin-api.md 的“选用规则”）。合同因此是本插件的公开接口，改动要升合同版本。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {definePublicState} from "nbook/shared/store/public";

const Empty = Type.Object({}, {additionalProperties: false});
const Increment = Type.Object({by: Type.Integer({minimum: 1})}, {additionalProperties: false});

/**
 * 服务端的计数：全局一份，存在 `nbook.storage` 里，服务端重启后还在。
 *
 * `provider: "server"`：调用方省略 `.at()` 就是发往服务端。`callers: ["browser"]`：只允许窗口里的插件调用；服务端
 * 自己的插件调用会得到 `denied`（docs/specs/runtime/plugin-channel.md 输出第 4 条“不在允许的调用方种类”）。
 */
export const counterContract = defineRemoteService({
    id: "example.counter/remote",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        /** 加 `by`，返回加完之后的计数。存不进 Storage 时为业务失败 `not-saved`，详情是 store 的提交结果。 */
        increment: {input: Increment, output: Type.Integer(), effect: "write", errors: {"not-saved": Type.Object({result: Type.String()}, {additionalProperties: false})}},
        current: {input: Empty, output: Type.Integer(), effect: "read"},
        /** 演示用：提供方看到的调用方。调用方的身份由内核标记，调用方自己填不了。 */
        caller: {input: Empty, output: Type.Object({plugin: Type.Union([Type.String(), Type.Null()]), instance: Type.String()}, {additionalProperties: false}), effect: "read"},
    },
    events: {
        /** 每次计数变化推送新的计数。 */
        changed: {filter: Empty, payload: Type.Integer()},
    },
});

/**
 * 项目的计数：每个打开的项目一份，只活在那个项目实例里（项目关掉就没了）。
 *
 * `provider: "project"`：调用方省略 `.at()`（或写 `.at("project")`）到达自己所在窗口绑定的那个项目，代码里没有
 * “哪个项目”的参数；窗口没有绑定项目时得到 `target-gone`，不会落到别的项目上（docs/specs/runtime/plugin-channel.md
 * 输出第 1 条、“输入与前置条件”）。
 */
export const projectCounterContract = defineRemoteService({
    id: "example.counter/project",
    version: 1,
    provider: "project",
    callers: ["browser"],
    methods: {
        increment: {input: Increment, output: Type.Integer(), effect: "write"},
        current: {input: Empty, output: Type.Integer(), effect: "read"},
    },
    events: {
        changed: {filter: Empty, payload: Type.Integer()},
    },
});

/**
 * 公开状态：向 `nbook.state` 的贡献点 `state.public` 声明的键，同一实例里的命令可以在 `when` 里引用它
 * （docs/specs/state/public-state.md）。这里只声明一次：结果既写进入口的 `contributions`，也交给 store 的 `publish`
 * 绑定，名字与类型由编译器在两处核对。键的全名是 `example.counter/nonzero`（`counterState.key("nonzero")`）。
 *
 * `unready` 是还没有绑定（入口没激活、或已停止）时读到的值；`reason` 是值不为 true 时给用户看的原因，命令面板用它
 * 解释命令为什么不可用。
 */
export const counterState = definePublicState("example.counter", {
    nonzero: {type: "boolean", unready: false, reason: {"zh-CN": "计数已经是 0", "en-US": "The count is already zero"}},
});

/**
 * 命令 id：别的插件按 id 执行它。第三方插件的命令 id 写成“自己的插件 id + `.` + 动作”；`nbook.<域>.<动作>` 只给内置
 * 插件（docs/specs/workbench/commands.md 的“命名与域词表（第一批）”，规则由 `nbook.commands` 的贡献点校验）。
 */
export const RESET_COMMAND = "example.counter.reset";
