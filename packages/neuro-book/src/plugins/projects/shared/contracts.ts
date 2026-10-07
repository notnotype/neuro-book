/**
 * `nbook.projects` 的远程服务合同 `nbook.projects/projects`：浏览器（以后的 TUI）列出已登记项目、登记目录。
 * 列表带项目目录路径，那是用户自己登记的位置，用来区分同名目录；服务端内部路径与子进程信息不在里面
 * （docs/specs/runtime/projects.md 输出第 10 条）。两端共用，不碰 DOM、Bun 与 Node API。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

export const OPEN_PROJECT_COMMAND = "nbook.project.open";

const ProjectView = Type.Object({
    id: Type.String(),
    name: Type.String(),
    path: Type.String(),
    state: Type.Union([Type.Literal("stopped"), Type.Literal("starting"), Type.Literal("running"), Type.Literal("idle-grace"), Type.Literal("stopping")]),
    generation: Type.Union([Type.Integer(), Type.Null()]),
}, {additionalProperties: false});

export type ProjectView = Static<typeof ProjectView>;

export const projectsRemoteContract = defineRemoteService({
    id: "nbook.projects/projects",
    version: 1,
    provider: "server",
    callers: ["browser", "tui"],
    methods: {
        list: {
            input: Type.Object({}, {additionalProperties: false}),
            output: Type.Array(ProjectView),
            effect: "read",
            errors: {"registry-invalid": Type.Object({detail: Type.String()}, {additionalProperties: false})},
        },
        register: {
            input: Type.Object({path: Type.String({minLength: 1})}, {additionalProperties: false}),
            output: Type.Object({id: Type.String(), name: Type.String(), path: Type.String()}, {additionalProperties: false}),
            effect: "write",
            errors: {"register-failed": Type.Object({reason: Type.String(), detail: Type.String()}, {additionalProperties: false})},
        },
    },
});
