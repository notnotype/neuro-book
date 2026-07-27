import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {
    insertIllustrationAfterAnchor,
    RpAnchorNotFoundError,
    RpTickNotFoundError,
} from "nbook/server/rp/prose-store";

const TICK_DIR = "000002-test-scene";

const PROSE = [
    "# 第二幕：雪夜",
    "",
    "**雪**落在她的肩上，她抬头看向天空。远处的灯火忽明忽暗。",
    "",
    "她说：“我们走吧。”雪落在她的肩上，这一次没有人回应。",
    "",
    "> 旁白：夜色渐深。",
].join("\n");

describe("rp prose 插图写回", () => {
    let projectRoot: string;
    let prosePath: string;

    beforeAll(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-prose-insert-"));
    });

    afterAll(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    beforeEach(async () => {
        await mkdir(join(projectRoot, "rp", "ticks", TICK_DIR), {recursive: true});
        prosePath = join(projectRoot, "rp", "ticks", TICK_DIR, "prose.md");
        await writeFile(prosePath, PROSE, "utf-8");
    });

    it("源码精确匹配：插图落在锚点所在段落之后", async () => {
        const result = await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "她抬头看向天空",
            occurrence: 0,
            imagePath: "assets/illustrations/a.png",
            alt: "雪夜",
            fallback: "none",
        });
        expect(result.mode).toBe("anchored");
        const content = await readFile(prosePath, "utf-8");
        const paragraphIndex = content.indexOf("忽明忽暗。");
        const imageIndex = content.indexOf("![雪夜](assets/illustrations/a.png)");
        const nextParagraphIndex = content.indexOf("她说：");
        expect(imageIndex).toBeGreaterThan(paragraphIndex);
        expect(imageIndex).toBeLessThan(nextParagraphIndex);
        // 图片行独立成段（前后有空行）
        expect(content).toMatch(/忽明忽暗。\n\n!\[雪夜\]\(assets\/illustrations\/a\.png\)\n\n她说/u);
    });

    it("剥离行内标记的归一化匹配：选区文本含加粗内容仍能定位", async () => {
        // 渲染 DOM 的选区不含 ** 标记
        const result = await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "雪落在她的肩上，她抬头看向天空",
            occurrence: 0,
            imagePath: "assets/illustrations/b.png",
            alt: "",
            fallback: "none",
        });
        expect(result.mode).toBe("anchored");
        const content = await readFile(prosePath, "utf-8");
        expect(content.indexOf("![](assets/illustrations/b.png)")).toBeLessThan(content.indexOf("她说："));
    });

    it("occurrence 区分重复文本：第二次出现插在第二段之后", async () => {
        await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "雪落在她的肩上",
            occurrence: 1,
            imagePath: "assets/illustrations/c.png",
            alt: "",
            fallback: "none",
        });
        const content = await readFile(prosePath, "utf-8");
        expect(content.indexOf("![](assets/illustrations/c.png)")).toBeGreaterThan(content.indexOf("没有人回应。"));
    });

    it("末段锚点：插到文末仍带换行收尾", async () => {
        await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "夜色渐深",
            occurrence: 0,
            imagePath: "assets/illustrations/d.png",
            alt: "",
            fallback: "none",
        });
        const content = await readFile(prosePath, "utf-8");
        expect(content.endsWith("![](assets/illustrations/d.png)\n")).toBe(true);
    });

    it("锚点找不到 + fallback=none 抛 RpAnchorNotFoundError；fallback=append 追加到文末", async () => {
        await expect(insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "这段文字不存在于正文",
            occurrence: 0,
            imagePath: "assets/illustrations/e.png",
            alt: "",
            fallback: "none",
        })).rejects.toBeInstanceOf(RpAnchorNotFoundError);

        const result = await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "这段文字不存在于正文",
            occurrence: 0,
            imagePath: "assets/illustrations/e.png",
            alt: "",
            fallback: "append",
        });
        expect(result.mode).toBe("appended");
        const content = await readFile(prosePath, "utf-8");
        expect(content.endsWith("![](assets/illustrations/e.png)\n")).toBe(true);
    });

    it("非法 tickDir（路径注入）与不存在的 tick 都抛 RpTickNotFoundError", async () => {
        for (const tickDir of ["../escape", "000009-missing"]) {
            await expect(insertIllustrationAfterAnchor(projectRoot, {
                tickDir,
                anchorText: "雪",
                occurrence: 0,
                imagePath: "assets/illustrations/f.png",
                alt: "",
                fallback: "none",
            })).rejects.toBeInstanceOf(RpTickNotFoundError);
        }
    });

    it("alt 中的 ] 与换行被清洗，不破坏图片语法", async () => {
        await insertIllustrationAfterAnchor(projectRoot, {
            tickDir: TICK_DIR,
            anchorText: "夜色渐深",
            occurrence: 0,
            imagePath: "assets/illustrations/g.png",
            alt: "坏]字\n符",
            fallback: "none",
        });
        const content = await readFile(prosePath, "utf-8");
        expect(content).toContain("![坏 字 符](assets/illustrations/g.png)");
    });
});
