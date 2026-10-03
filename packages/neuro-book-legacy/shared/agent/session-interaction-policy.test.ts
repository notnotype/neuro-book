import {describe, expect, it} from "vitest";
import {sessionInteraction} from "nbook/shared/agent/session-interaction-policy";

describe("Session interaction policy", () => {
    it("统一投影 Idle、Running、Waiting、Profile 不可用与 Archived 能力矩阵", () => {
        expect(sessionInteraction({archived: false, status: "idle", profileAvailability: "loaded"})).toEqual({
            canInvoke: true,
            canResolveUserInput: false,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canMutateHistory: true,
            canChangeRuntime: true,
            canArchive: true,
            canRestore: false,
            canAbort: false,
        });
        expect(sessionInteraction({archived: false, status: "running", profileAvailability: "loaded"})).toMatchObject({
            canInvoke: true,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canMutateHistory: false,
            canChangeRuntime: false,
            canAbort: true,
        });
        expect(sessionInteraction({archived: false, status: "waiting", profileAvailability: "loaded"})).toMatchObject({
            canInvoke: false,
            canResolveUserInput: true,
            canRegisterAttachment: false,
            canInsertAttachment: false,
            canAbort: true,
        });
        expect(sessionInteraction({archived: false, status: "idle", profileAvailability: "missing"})).toMatchObject({
            canInvoke: false,
            canMutateHistory: false,
            canChangeRuntime: false,
            canArchive: true,
        });
        expect(sessionInteraction({archived: true, status: "archived", profileAvailability: "loaded"})).toEqual({
            canInvoke: false,
            canResolveUserInput: false,
            canRegisterAttachment: false,
            canInsertAttachment: false,
            canMutateHistory: false,
            canChangeRuntime: false,
            canArchive: false,
            canRestore: true,
            canAbort: false,
        });
    });

    it("Profile 在运行中失效时仍允许停止，但不允许新增交互", () => {
        expect(sessionInteraction({archived: false, status: "running", profileAvailability: "unloadable"})).toMatchObject({
            canInvoke: false,
            canRegisterAttachment: false,
            canInsertAttachment: false,
            canAbort: true,
        });
    });
});
