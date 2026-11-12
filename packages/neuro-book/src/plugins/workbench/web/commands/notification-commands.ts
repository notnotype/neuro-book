/**
 * 通知中心的命令（docs/specs/workbench/notifications.md 输出 14）：“通知”视图头的“全部清除”。中心为空时不可用（公开状态
 * `nbook.workbench/hasNotifications`）。只清本窗口的中心，弹出着的通知不动。公开状态单独成一组：它不归布局，布局那一组的键
 * 由 ui/workbench-layout.md 输出 36 列定。
 */

import {Type} from "typebox";

import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import {definePublicState} from "nbook/shared/store/public";

import {workbenchText} from "../../shared/text";
import type {NotificationCenter} from "../notifications";

export const notificationState = definePublicState("nbook.workbench", {
    hasNotifications: {type: "boolean", unready: false, reason: workbenchText("state.hasNotifications.reason")},
});

export const CLEAR_NOTIFICATIONS_COMMAND = "nbook.notifications.clear";

export const NOTIFICATION_COMMAND_DECLARATIONS = {
    [CLEAR_NOTIFICATIONS_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Clear every notification in this window's notification center. Notifications still showing in the corner stay.",
        args: Type.Object({}, {additionalProperties: false}),
        effect: "write",
        // 通知是给人看的；清掉它们对 Agent 没有用处。
        expose: {agent: "never"},
        when: {requires: [notificationState.key("hasNotifications")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

export function notificationCommands(center: Pick<NotificationCenter, "clear">): {readonly [K in keyof typeof NOTIFICATION_COMMAND_DECLARATIONS]: CommandImplementation} {
    return {
        [CLEAR_NOTIFICATIONS_COMMAND]: {
            run: () => {
                center.clear();
                return {ok: true, value: null};
            },
        },
    };
}
