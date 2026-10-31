/** 内核事件的作用域与种类：日志校验与归约在运行时要查，类型由 `satisfies` 对着 `KernelEvents` 核对。 */

import type {EventKindOf, EventScope, KernelEventName, KernelEvents} from "./events.js";

type SpecTable = {readonly [N in KernelEventName]: {readonly scope: EventScope<KernelEvents[N]>; readonly kind: EventKindOf<KernelEvents[N]>}};

export const kernelEventSpecs = {
    sessionCreated: {scope: "path", kind: "ctrl"},
    inputQueued: {scope: "session", kind: "ctrl"},
    inputEdited: {scope: "session", kind: "ctrl"},
    inputRemoved: {scope: "session", kind: "ctrl"},
    inputConsumed: {scope: "session", kind: "ctrl"},
    commandAccepted: {scope: "session", kind: "ctrl"},
    settingsChanged: {scope: "session", kind: "ctrl"},
    leafChanged: {scope: "session", kind: "ctrl"},
    profileChanged: {scope: "session", kind: "ctrl"},
    approvalRemembered: {scope: "session", kind: "ctrl"},
    titleChanged: {scope: "session", kind: "ctrl"},
    archived: {scope: "session", kind: "ctrl"},
    runStarted: {scope: "path", kind: "ctrl"},
    runEnded: {scope: "path", kind: "ctrl"},
    turnStarted: {scope: "path", kind: "ctrl"},
    turnEnded: {scope: "path", kind: "ctrl"},
    input: {scope: "path", kind: "conv"},
    steer: {scope: "path", kind: "conv"},
    assistant: {scope: "path", kind: "conv"},
    continued: {scope: "path", kind: "conv"},
    modelStarted: {scope: "path", kind: "ctrl"},
    modelEnded: {scope: "path", kind: "ctrl"},
    modelFailed: {scope: "path", kind: "ctrl"},
    toolsAnnounced: {scope: "path", kind: "ctrl"},
    toolStarted: {scope: "path", kind: "ctrl"},
    toolResult: {scope: "path", kind: "conv"},
    interactionRequested: {scope: "path", kind: "ctrl"},
    interactionResolved: {scope: "path", kind: "ctrl"},
    compaction: {scope: "path", kind: "ctrl"},
    extensionFailed: {scope: "path", kind: "ctrl"},
    reactionLimit: {scope: "path", kind: "ctrl"},
} as const satisfies SpecTable;
