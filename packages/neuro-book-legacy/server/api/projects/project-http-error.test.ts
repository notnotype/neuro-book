import {describe, expect, it} from "vitest";
import {
    createProjectHttpError,
    throwProjectHttpError,
    withProjectHttpError,
} from "nbook/server/api/projects/project-http-error";
import {
    ProjectLifecycleError,
    ProjectLifecycleLockReleaseFailedError,
    ProjectLifecycleTransactionError,
} from "nbook/server/workspace-files/project-lifecycle";
import {
    ProjectInUseError,
    ProjectLockCompromisedError,
    ProjectLockReleaseFailedError,
} from "nbook/server/workspace-files/project-lock";
import {
    ProjectNotReadyError,
    ProjectSessionCloseError,
    ProjectSessionExistsError,
    ProjectSessionOpenError,
    ProjectSessionRuntimeClosedError,
} from "nbook/server/workspace-files/project-session-runtime";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";

describe("Project HTTP error mapper", () => {
    it("Lifecycle transaction 只公开稳定事务字段", () => {
        const cause = new Error("C:\\private\\transaction-secret");
        const mapped = createProjectHttpError(new ProjectLifecycleTransactionError(
            "PROJECT_PUBLISH_FAILED",
            "create",
            "publish-snapshot",
            "unknown",
            "C:\\private\\message-secret",
            cause,
        ));

        expect(mapped).toMatchObject({
            statusCode: 500,
            data: {
                code: "PROJECT_PUBLISH_FAILED",
                operation: "create",
                phase: "publish-snapshot",
                committed: "unknown",
            },
        });
        expect(mapped?.cause).toBeUndefined();
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("private");
    });

    it("Lifecycle release 子类优先于普通 Lock release 并保留 committed", () => {
        const base = new ProjectLockReleaseFailedError(
            {kind: "project-occupancy", projectRoot: "alpha"},
            new Error("module-secret"),
        );
        const mapped = createProjectHttpError(new ProjectLifecycleLockReleaseFailedError(
            "metadata-update",
            true,
            base,
        ));

        expect(mapped).toMatchObject({
            statusCode: 500,
            data: {
                code: "PROJECT_LOCK_RELEASE_FAILED",
                kind: "project-occupancy",
                projectRoot: "alpha",
                staleMs: 30_000,
                operation: "metadata-update",
                phase: "release",
                committed: true,
            },
        });
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("module-secret");
    });

    it("Session close 不公开 Module failures", () => {
        const mapped = createProjectHttpError(new ProjectSessionCloseError(
            "alpha",
            [new Error("database-module-secret"), new Error("history-module-secret")],
        ));

        expect(mapped).toMatchObject({
            statusCode: 500,
            data: {code: "PROJECT_SESSION_CLOSE_FAILED", projectRoot: "alpha"},
        });
        expect(Object.keys(mapped?.data ?? {})).toEqual(["code", "projectRoot"]);
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("module-secret");
    });

    it("Session open 不公开原始 Module cause 与路径", () => {
        const cause = new Error("C:\\private\\modules\\project-database.ts: open failed");
        const source = new ProjectSessionOpenError("alpha", cause);
        const mapped = createProjectHttpError(source);

        expect(source.cause).toBe(cause);
        expect(mapped).toMatchObject({
            statusCode: 500,
            data: {code: "PROJECT_SESSION_OPEN_FAILED", projectRoot: "alpha"},
        });
        expect(mapped?.cause).toBeUndefined();
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("private");
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("project-database.ts");
    });

    it("Session exists 返回稳定 409 与 projectRoot", () => {
        const mapped = createProjectHttpError(new ProjectSessionExistsError("alpha"));

        expect(mapped).toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_SESSION_EXISTS", projectRoot: "alpha"},
        });
        expect(Object.keys(mapped?.data ?? {})).toEqual(["code", "projectRoot"]);
    });

    it("ProjectInUse 与 ProjectNotOpen 只返回 projectRoot，不生成 projectPath", () => {
        const inUse = createProjectHttpError(new ProjectInUseError("alpha", new Error("lock-secret")));
        const notOpen = createProjectHttpError(new ProjectNotOpenError("alpha"));

        expect(inUse?.data).toEqual({code: "PROJECT_IN_USE", projectRoot: "alpha"});
        expect(notOpen?.data).toEqual({code: "PROJECT_NOT_OPEN", projectRoot: "alpha"});
        expect(JSON.stringify([inUse?.toJSON(), notOpen?.toJSON()])).not.toContain("projectPath");
    });

    it("非法 projectRoot 与内部绝对路径 message 都不会进入响应", () => {
        const invalidRoot = createProjectHttpError(new ProjectNotOpenError("C:\\private\\project"));
        const lifecycle = createProjectHttpError(new ProjectLifecycleError(
            "PROJECT_ROOT_IO",
            "C:\\private\\workspace",
            new Error("C:\\private\\cause"),
        ));

        expect(invalidRoot?.data).toEqual({code: "PROJECT_NOT_OPEN"});
        expect(lifecycle?.data).toEqual({code: "PROJECT_ROOT_IO"});
        expect(JSON.stringify([invalidRoot?.toJSON(), lifecycle?.toJSON()])).not.toContain("private");
    });

    it("普通 Lock release 公开恢复窗口但不公开 cause", () => {
        const mapped = createProjectHttpError(new ProjectLockReleaseFailedError(
            {kind: "workspace-mutation"},
            new Error("release-secret"),
        ));

        expect(mapped?.data).toEqual({
            code: "PROJECT_LOCK_RELEASE_FAILED",
            kind: "workspace-mutation",
            staleMs: 30_000,
        });
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("release-secret");
    });

    it("Lock compromised 使用稳定 409 且不公开内部 message/cause", () => {
        const mapped = createProjectHttpError(new ProjectLockCompromisedError(
            "C:\\private\\heartbeat-message",
            new Error("heartbeat-cause"),
        ));

        expect(mapped).toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_LOCK_COMPROMISED"},
        });
        expect(mapped?.cause).toBeUndefined();
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("private");
        expect(JSON.stringify(mapped?.toJSON())).not.toContain("heartbeat-cause");
    });

    it("Runtime closed 返回稳定 503，NotReady 防御性归一为 NotOpen", () => {
        const closed = createProjectHttpError(new ProjectSessionRuntimeClosedError());
        const notReady = createProjectHttpError(new ProjectNotReadyError("alpha"));

        expect(closed).toMatchObject({
            statusCode: 503,
            data: {code: "PROJECT_SESSION_RUNTIME_CLOSED"},
        });
        expect(notReady).toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: "alpha"},
        });
        expect(JSON.stringify(notReady?.toJSON())).not.toContain("尚未达到最低ready");
    });

    it("未知错误不被改写，throw helper 保留原对象", () => {
        const unknown = new Error("unknown");
        expect(createProjectHttpError(unknown)).toBeNull();
        expect(createProjectHttpError({
            name: "ProjectNotOpenError",
            code: "PROJECT_NOT_OPEN",
            statusCode: 409,
            projectRoot: "alpha",
        })).toBeNull();
        expect(() => throwProjectHttpError(unknown)).toThrow(unknown);
    });

    it("canonical wrapper 映射 Project error 并保留未知错误", async () => {
        await expect(withProjectHttpError(() => {
            throw new ProjectNotOpenError("alpha");
        })).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: "alpha"},
        });
        const unknown = new Error("unknown");
        await expect(withProjectHttpError(() => {
            throw unknown;
        })).rejects.toBe(unknown);
    });
});
