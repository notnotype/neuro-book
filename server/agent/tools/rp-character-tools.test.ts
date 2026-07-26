import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {rpCharacterTools} from "nbook/server/agent/tools/rp-character-tools";
import {createBuiltinTools} from "nbook/server/agent/tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

describe("rp character tools", {timeout: 30_000}, () => {
    let projectPath: string;
    let projectRoot: string;
    let context: ToolExecutionContext;

    beforeEach(async () => {
        const slug = `rp-tools-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        projectPath = `workspace/${slug}`;
        projectRoot = path.join(resolveRuntimeWorkspaceRoot(), slug);
        await fs.mkdir(projectRoot, {recursive: true});
        await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: RP Tools Test\nsummary: ''\n", "utf-8");
        await openProjectForTest(projectPath);
        context = {
            harness: {} as ToolExecutionContext["harness"],
            sessionId: 1,
            profileKey: "leader.default",
            workspaceRootRef: "workspace",
            workspaceFsRoot: resolveRuntimeWorkspaceRoot(),
            workspaceKey: "global",
        };
    }, 30_000);

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await fs.rm(projectRoot, {recursive: true, force: true});
    }, 30_000);

    it("三个工具都已注册进内置工具", () => {
        const keys = createBuiltinTools().map((tool) => tool.key);
        expect(keys).toContain("rp_character_recall");
        expect(keys).toContain("rp_character_update");
        expect(keys).toContain("rp_memory_commit");
    });

    it("端到端:建档→记知识→登记未知→提交记忆→回忆(视图隔离)→揭示", async () => {
        const update = rpCharacterTools.rpCharacterUpdate;
        const recall = rpCharacterTools.rpCharacterRecall;
        const commit = rpCharacterTools.rpMemoryCommit;

        await update.executeWithContext!(context, "t1", {projectPath, characterId: "erina", op: "ensure", content: "# 我是艾琳娜\n"});
        await update.executeWithContext!(context, "t2", {projectPath, characterId: "erina", op: "add_knowledge", topic: "子爵的处境", content: "领地缺钱", source: "偷听", tick: 2});
        await update.executeWithContext!(context, "t3", {projectPath, characterId: "erina", op: "add_unknown", topic: "法师的注视", content: "法师怀疑她是特殊召唤体", occurredTick: 2, revealHint: "决斗时点破"});
        const commitResult = await commit.executeWithContext!(context, "t4", {
            projectPath,
            characterId: "erina",
            tick: 3,
            detail: "我假装整理衣角,偷听到了子爵与管家的对话。",
            summaryLine: "偷听子爵与管家谈话,得知领地缺钱",
            mood: "# 心境\n\n有了筹码,心里踏实了一点。\n",
        });
        expect((commitResult.details as {rollupNeeded: boolean}).rollupNeeded).toBe(false);

        // actor 视图:无 god-view 内容
        const actorResult = await recall.executeWithContext!(context, "t5", {projectPath, characterId: "erina", ticks: [3]});
        const actorText = JSON.stringify(actorResult.details);
        expect(actorText).toContain("领地缺钱");
        expect(actorText).toContain("偷听子爵与管家谈话");
        expect(actorText).toContain("整理衣角");
        expect(actorText).not.toContain("特殊召唤体");

        // god 视图:齐全
        const godResult = await recall.executeWithContext!(context, "t6", {projectPath, characterId: "erina", view: "god"});
        expect(JSON.stringify(godResult.details)).toContain("特殊召唤体");

        // 揭示后进入已知
        await update.executeWithContext!(context, "t7", {projectPath, characterId: "erina", op: "reveal_unknown", entryId: "U001", source: "法师当面点破", tick: 5});
        const afterReveal = await recall.executeWithContext!(context, "t8", {projectPath, characterId: "erina"});
        expect(JSON.stringify(afterReveal.details)).toContain("特殊召唤体");

        // 列出角色
        const list = await recall.executeWithContext!(context, "t9", {projectPath});
        expect((list.details as {characters: string[]}).characters).toEqual(["erina"]);
    });

    it("未 open 的 Project 拒绝访问", async () => {
        await closeProjectForTest(projectPath);
        await expect(rpCharacterTools.rpCharacterRecall.executeWithContext!(context, "t1", {projectPath})).rejects.toThrow();
        await openProjectForTest(projectPath);
    });
});
