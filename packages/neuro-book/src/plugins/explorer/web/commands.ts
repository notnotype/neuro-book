/**
 * 资源管理器的命令（docs/specs/workbench/commands.md 的“命令目录（资源管理器）”与第二批的 `refresh-files`）：工具栏、
 * 右键菜单与树内快捷键只引用这些命令 id。实现经会话找到控制器与当前挂着的视图；资源管理器还没打开时为 `unavailable`，
 * 不静默成功。
 */

import {Type} from "typebox";

import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ExplorerController} from "./controller";
import {explorerLocalized, explorerText} from "./messages";
import type {ExplorerSession} from "./session";
import {explorerState} from "./state";

export const COLLAPSE_ALL_COMMAND = "nbook.files.collapse-all";
export const TOGGLE_MANIFESTS_COMMAND = "nbook.files.toggle-manifests";
export const REFRESH_FILES_COMMAND = "nbook.view.refresh-files";

const CATEGORY = {"zh-CN": "文件", "en-US": "Files"};
const NO_ARGS = Type.Object({}, {additionalProperties: false});
const requires = (...names: ReadonlyArray<keyof typeof explorerState.declarations & string>) => ({requires: names.map((name) => explorerState.key(name))});

export const EXPLORER_COMMAND_DECLARATIONS = {
    [COLLAPSE_ALL_COMMAND]: {
        title: explorerLocalized("collapseAll"),
        category: CATEGORY,
        description: "Collapse every folder in this window's explorer except the roots.",
        args: NO_ARGS,
        effect: "read",
        expose: {agent: "never"},
        when: requires("ready"),
    },
    [TOGGLE_MANIFESTS_COMMAND]: {
        title: explorerLocalized("showManifests"),
        category: CATEGORY,
        description: "Show or hide manifest files (content.xml) in this window's explorer. Only changes the display preference.",
        args: NO_ARGS,
        effect: "write",
        expose: {agent: "never"},
        when: requires("ready"),
    },
    [REFRESH_FILES_COMMAND]: {
        title: explorerLocalized("refresh"),
        category: CATEGORY,
        description: "Re-list every loaded folder of the explorer view instance given by viewId and generation.",
        args: Type.Object({viewId: Type.String(), generation: Type.Integer({minimum: 1})}, {additionalProperties: false}),
        effect: "read",
        // 视图动作：参数是实例的代次，从命令面板执行没有意义。
        expose: {human: false, agent: "never"},
        when: requires("ready"),
    },
} as const satisfies Readonly<Record<string, CommandDeclaration>>;

export function explorerCommands(session: ExplorerSession, locale: () => DisplayLocale): Record<string, CommandImplementation> {
    const withController = (run: (controller: ExplorerController) => CommandResult<unknown>): CommandImplementation => ({
        run: () => {
            const controller = session.controller.value;
            if (controller === null) return {ok: false, code: "unavailable", reason: explorerText(locale(), "notReady")};
            return run(controller);
        },
    });
    return {
        [COLLAPSE_ALL_COMMAND]: withController((controller) => {
            controller.model.collapseAll();
            return {ok: true, value: null};
        }),
        [TOGGLE_MANIFESTS_COMMAND]: withController((controller) => {
            session.setShowManifests(!controller.showManifests.value);
            return {ok: true, value: null};
        }),
        [REFRESH_FILES_COMMAND]: {
            run: (args) => {
                const {viewId, generation} = args as {viewId: string; generation: number};
                const controller = session.controller.value;
                const view = session.view.value;
                if (controller === null) return {ok: false, code: "unavailable", reason: explorerText(locale(), "notReady")};
                if (view === null || view.id !== viewId || view.generation !== generation) return {ok: false, code: "stale-target", reason: explorerText(locale(), "staleView")};
                controller.model.refresh();
                return {ok: true, value: null};
            },
        },
    };
}
