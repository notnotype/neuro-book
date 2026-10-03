/**
 * 真实模型写作 workflow smoke：consistency-audit（只读）+ cancel 场景，经 dev server 的
 * `/api/agent/workflow/runs` 与 jobs 端点执行。
 *
 * 前置通过环境变量显式提供（缺一即 skip）：
 * - `REAL_MODEL_SMOKE_PROJECT`   已 open 项目的单段 Project Root；
 * - `REAL_MODEL_SMOKE_CHAPTERS`  consistency-audit 的章节清单（逗号/换行分隔）。
 *
 * 写盘场景（chapter-write-review-revise）默认不跑；显式设置 `REAL_MODEL_SMOKE_WRITE_CHAPTER`
 * 才会写入真实项目章节文件。测试进程与 dev server 的 State Root 不同，写盘后不在本地读文件断言。
 * 运行入口：`bun run test:real-model`。
 */

import {describe, expect, it} from "vitest";
import {runWritingWorkflowSmoke} from "nbook/scripts/smoke/writing-workflow";
import {probeRealModelDevServer, REAL_MODEL_SMOKE_BASE_URL} from "./support";

const projectRoot = process.env.REAL_MODEL_SMOKE_PROJECT?.trim() || null;
const chapters = process.env.REAL_MODEL_SMOKE_CHAPTERS?.trim() || null;
const chapterPaths = chapters
    ? chapters.split(/[,，\n]/u).map((item) => item.trim()).filter((item) => item.length > 0)
    : [];
if (chapters && chapterPaths.length === 0) {
    throw new Error("REAL_MODEL_SMOKE_CHAPTERS 未解析出任何章节路径（仅分隔符或空白）");
}
const writeChapter = process.env.REAL_MODEL_SMOKE_WRITE_CHAPTER?.trim() || null;

describe("真实模型：写作 workflow smoke（dev server + 项目）", () => {
    it("consistency-audit 与 cancel 在真实项目上跑通", async (context) => {
        if (!projectRoot) context.skip("未设置 REAL_MODEL_SMOKE_PROJECT（已 open 项目的 Project Root）");
        if (!chapters) context.skip("未设置 REAL_MODEL_SMOKE_CHAPTERS（consistency-audit 章节清单）");
        if (!(await probeRealModelDevServer())) {
            context.skip(`dev server 不可达（${REAL_MODEL_SMOKE_BASE_URL}）；先启动 bun run dev 或设置 AGENT_HTTP_BASE_URL`);
        }

        const results = await runWritingWorkflowSmoke({
            baseUrl: REAL_MODEL_SMOKE_BASE_URL,
            projectRoot,
            chapters,
            writeChapter,
            verifyChapterFile: false,
        });

        const failed = results.filter((result) => result.status === "failed");
        expect(failed.map((result) => `${result.name}: ${result.detail}`)).toEqual([]);
        expect(results.some((result) => result.status === "passed")).toBe(true);
    }, 900_000);
});
