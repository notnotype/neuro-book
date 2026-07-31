import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {assertRpChildInvocation, assertRpFormalFileWrite} from "nbook/server/rp/intake-guard";
import {
    beginRpBootstrap,
    confirmRpIntakeFromPlayer,
    completeRpBootstrapStage,
    failRpBootstrap,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";

describe("RP intake file guard", () => {
    let workspaceRoot: string;
    let projectRoot: string;
    const projectPath = normalizeProjectPath("workspace/adventure");

    beforeEach(async () => {
        workspaceRoot = await mkdtemp(join(tmpdir(), "rp-intake-guard-"));
        projectRoot = join(workspaceRoot, "adventure");
        for (const key of RP_INTAKE_FIELD_KEYS) {
            await updateRpIntakeField(projectRoot, key, {status: "confirmed", value: `${key} ready`});
        }
        const reviewing = await reviewRpIntake(projectRoot);
        await confirmRpIntakeFromPlayer(projectRoot, reviewing.version);
        await beginRpBootstrap(projectRoot);
        await failRpBootstrap(projectRoot, "测试配置错误");
    });

    afterEach(async () => {
        await rm(workspaceRoot, {recursive: true, force: true});
    });

    it("config 失败后允许修正文档，但禁止通用文件工具手写 Schema/Calendar", async () => {
        const context = {
            profileKey: "rp.leader",
            workspaceFsRoot: absoluteFsPath(workspaceRoot),
        } as ToolExecutionContext;

        await expect(assertRpFormalFileWrite(context, address("rp/manual/README.md"))).resolves.toBeUndefined();
        await expect(assertRpFormalFileWrite(context, address("rp/lorebook/world.md"))).resolves.toBeUndefined();
        await expect(assertRpFormalFileWrite(context, address("rp/world-engine/schema/index.ts")))
            .rejects.toThrow("op=initialize_config");
        await expect(assertRpFormalFileWrite(context, address("rp/world-engine/calendar.ts")))
            .rejects.toThrow("op=initialize_config");
    });

    it("characters 阶段允许 world 登记具名 NPC，但不放行其他子 Agent", async () => {
        await completeRpBootstrapStage(projectRoot, "config");
        await completeRpBootstrapStage(projectRoot, "world");
        await completeRpBootstrapStage(projectRoot, "map");
        const context = {
            profileKey: "rp.leader",
            workspaceFsRoot: absoluteFsPath(workspaceRoot),
        } as ToolExecutionContext;

        await expect(assertRpChildInvocation(context, "rp.world", projectPath)).resolves.toBeUndefined();
        await expect(assertRpChildInvocation(context, "rp.screenwriter", projectPath)).rejects.toThrow("characters");
        await expect(assertRpChildInvocation(context, "rp.writer", projectPath)).rejects.toThrow("characters");
    });

    /** 构造受当前 Project Workspace 约束的文件地址。 */
    function address(relativePath: string): ResolvedFileAddress {
        return {
            kind: "scope-relative",
            absolutePath: absoluteFsPath(join(projectRoot, relativePath)),
            projectPath,
            relativePath,
        };
    }
});
