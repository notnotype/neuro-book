import {randomUUID} from "node:crypto";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
    buildAgentSqlSchemaSummary,
    hasSqlStatementSeparator,
    validateExecuteSql,
} from "nbook/server/agent/tools/agent-sql-project-module";
import {createSqlTool} from "nbook/server/agent/tools/sql-tool";
import type {NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    writeProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {
    closeProjectForTest,
    openProjectForTest,
    removeProjectWorkspaceForTest,
} from "nbook/server/workspace-files/project-session-test-utils";
import {
    createIsolatedWorkspaceAssets,
    type IsolatedWorkspaceAssets,
} from "nbook/server/workspace-files/test-workspace-fixture";

describe("v3 execute_sql tool", () => {
    let assets: IsolatedWorkspaceAssets;

    beforeAll(async () => {
        assets = await createIsolatedWorkspaceAssets({purpose: "sql-tool-tests"});
    });

    afterAll(async () => {
        await assets.dispose();
    });

    it("schema summary 不会把 sceneId 错挂到 StoryScene", () => {
        const summary = buildAgentSqlSchemaSummary([
            row("StoryScene", "id", 1),
            row("StoryScene", "storyId", 2),
            row("StoryScene", "threadId", 3),
            row("StoryScene", "chapterPath", 4),
            row("StorySceneRef", "id", 1),
            row("StorySceneRef", "sceneId", 2),
        ], []);

        expect(summary).toContain('"StoryScene":');
        expect(summary).toContain('- "storyId": integer');
        expect(summary).toContain('- "sceneId": integer');
        expect(summary).toContain('"StorySceneRef":');
        expect(summary).not.toContain('"StoryScene"(id, "storyId", "threadId", "chapterPath", "sceneId")');
    });

    it("单语句 scanner 允许字符串和注释里的分号", () => {
        expect(hasSqlStatementSeparator("SELECT 'drop table; still text'")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT 1 -- ; comment\n")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT /* ; */ 1")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT 1; SELECT 2")).toBe(true);
    });

    it("SQL 校验允许 CTE、尾部分号和写入语句", () => {
        expect(() => validateExecuteSql("WITH rows AS (SELECT 1) SELECT * FROM rows")).not.toThrow();
        expect(() => validateExecuteSql("SELECT 1;")).not.toThrow();
        expect(() => validateExecuteSql("INSERT INTO \"StoryScene\" (id) VALUES (1)")).not.toThrow();
        expect(() => validateExecuteSql("UPDATE \"StoryScene\" SET title = 'x' WHERE id = 1")).not.toThrow();
        expect(() => validateExecuteSql("DELETE FROM \"StoryScene\" WHERE id = 1")).not.toThrow();
    });

    it("SQL 校验拒绝多语句和不允许的首关键字", () => {
        expect(() => validateExecuteSql("SELECT 1; SELECT 2")).toThrow("sql 只允许单条语句");
        for (const keyword of ["ALTER", "CREATE", "DROP", "TRUNCATE", "COPY", "VACUUM"]) {
            expect(() => validateExecuteSql(`${keyword} TABLE "StoryScene"`)).toThrow("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
        }
    });

    it("没有具体Current Project时拒绝执行", async () => {
        await expect(executeSqlTool(null, "SELECT 1")).rejects.toThrow(
            "execute_sql 需要当前 session 位于具体 Project Workspace",
        );
    });

    it("缺少invocationId时fail closed，不按持久化projectPath查询latest generation", async () => {
        const projectRoot = `sql-tool-missing-invocation-${randomUUID()}`;
        try {
            const ready = await createProject(projectRoot);
            await expect(executeSqlTool(ready, "SELECT 1", {invocationId: undefined})).rejects.toThrow(
                "execute_sql 缺少 invocationId",
            );
        } finally {
            await removeProjectWorkspaceForTest(projectRoot);
        }
    });

    it("已open的Project通过工具公开入口执行当前generation SQL", async () => {
        const projectRoot = `sql-tool-${randomUUID()}`;
        try {
            const ready = await createProject(projectRoot);
            await expect(executeSqlTool(ready, "SELECT 1 AS value")).resolves.toMatchObject({
                details: {
                    mode: "read",
                    command: "SELECT",
                    rowCount: 1,
                    rows: [{value: 1}],
                },
            });
        } finally {
            await removeProjectWorkspaceForTest(projectRoot);
        }
    }, 30_000);

    it("close/reopen后旧invocation generation拒绝执行且不会切换到新generation", async () => {
        const projectRoot = `sql-tool-exact-generation-${randomUUID()}`;
        try {
            const staleReady = await createProject(projectRoot);
            await closeProjectForTest(projectRoot);
            const currentReady = await openProjectForTest(projectRoot);

            expect(currentReady.generation).not.toBe(staleReady.generation);
            await expect(executeSqlTool(staleReady, "SELECT 1 AS stale")).rejects.toThrow(
                "Project尚未达到最低ready",
            );
            await expect(executeSqlTool(currentReady, "SELECT 2 AS current")).resolves.toMatchObject({
                details: {
                    rows: [{current: 2}],
                },
            });
        } finally {
            await removeProjectWorkspaceForTest(projectRoot);
        }
    }, 30_000);
});

/** 通过NeuroAgentTool公开上下文入口执行SQL。 */
async function executeSqlTool(
    ready: ReadyProjectSessionRef | null,
    sql: string,
    overrides: Pick<Partial<ToolExecutionContext>, "invocationId"> = {},
): Promise<NeuroToolResult> {
    const execute = createSqlTool().executeWithContext;
    if (!execute) {
        throw new Error("execute_sql缺少context执行入口");
    }
    const harness = {} as ToolExecutionContext["harness"];
    harness.projectForInvocation = () => ready;
    return execute({
        harness,
        sessionId: 1,
        profileKey: "leader.default",
        workspaceRoot: resolveRuntimeWorkspaceRoot(),
        currentProject: ready,
        invocationId: "execute-sql-test-invocation",
        ...overrides,
    }, "execute-sql-test", {sql});
}

function row(tableName: string, columnName: string, ordinalPosition: number) {
    return {
        tableName,
        columnName,
        ordinalPosition,
        isNullable: "NO" as const,
        columnDefault: null,
        dataType: "integer",
        udtName: "int4",
    };
}

async function createProject(projectRoot: string): Promise<ReadyProjectSessionRef> {
    await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot), {
        kind: "novel",
        title: projectRoot,
        summary: "",
    });
    return openProjectForTest(projectRoot);
}
