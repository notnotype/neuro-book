/**
 * `example.board` 对外公开的合同。窗口里的插件在运行时引用这个文件，直接 `context.remote.use(boardContract)` 调用。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

/**
 * 提供方位置是 `project`：每个项目实例各提供一份。调用方省略 `.at()`（或写 `.at("project")`）到达自己所在窗口绑定的
 * 那个项目，代码里没有“哪个项目”的参数；窗口没有绑定项目时调用得到失败码，不会落到别的项目。
 */
export const boardContract = defineRemoteService({
    id: "example.board/remote",
    version: 1,
    provider: "project",
    callers: ["browser"],
    methods: {
        pin: {input: Type.Object({text: Type.String({minLength: 1})}, {additionalProperties: false}), output: Type.Null(), effect: "write"},
        items: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(Type.String()), effect: "read"},
    },
    events: {
        pinned: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.String()},
    },
});
