import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

describe("leader-owned Plot reference contract", () => {
    it("novel writing workflow 使用 leader-owned Plot 主链", async () => {
        const workflow = await readReference("reference/agent/novel-writing-workflow.md");

        expect(workflow).toContain("leader.default` 直接负责 Plot / Scene");
        expect(workflow).toContain("剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> get_chapter_writer_brief");
        expect(workflow).toContain("director` 只保留为高级或手动剧情导演 profile");
        expect(workflow).not.toContain("由 `director` 管理");
        expect(workflow).not.toContain("调度 `director` / `writer`");
        expect(workflow).not.toContain("结构化 Thread / Scene / Chapter Plot 交给 `director`");
    });

    it("Plot System reference 把 get_chapter_writer_brief 作为 writer 前置入口", async () => {
        const plotSystem = await readReference("reference/plot/system.md");

        expect(plotSystem).toContain("`get_chapter_writer_brief`");
        expect(plotSystem).toContain("若 status 不是 `ready`");
        expect(plotSystem).toContain("重新编译");
        expect(plotSystem).not.toContain("Writer 写章节时，Leader 应优先用 `get_story_chapter`");
    });

    it("Plot agent spec 不再把普通 Scene 落库责任只写给 director", async () => {
        const agentSpec = await readReference("reference/plot/agent-spec.md");

        expect(agentSpec).toContain("Leader（或手动 director）落库前");
        expect(agentSpec).toContain("默认回报 leader");
        expect(agentSpec).not.toContain("Director 落库前");
        expect(agentSpec).not.toContain("回报 leader / director");
    });
});

async function readReference(path: string): Promise<string> {
    return await readFile(resolve(repositoryRoot, "packages", "neuro-book", "assets", path), "utf8");
}
