/**
 * 星瑕样本项目（canon-sample.ts）：生成出来的目录是一部能打开的作品；用产品打开世界的那段代码（`createWorldHost`）重新打开，
 * 条目、马甲关系、内置类型的字段都在，三章都在章表里，星瑕的主文字渲染出来没有坏块、马甲的外观不是占位。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import type {AuthorBlock, AuthorNode} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createWorldHost} from "../src/plugins/canon/backend/world-host";
import {BUILTIN_COMPONENTS} from "../src/plugins/canon/shared/components";
import {writeCanonSample} from "./canon-sample";
import type {CanonSampleResult} from "./canon-sample";

let tmp = "";
let result: CanonSampleResult;
const project = (): string => join(tmp, "星瑕");

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "sample-project");
    result = await writeCanonSample(project());
});

afterAll(async () => {
    await rm(tmp, {recursive: true, force: true});
});

/** 语法树里的 canon 节点。 */
function canonNodes(node: unknown): AuthorNode[] {
    if (typeof node !== "object" || node === null) return [];
    const typed = node as {type?: string; children?: unknown[]};
    const self = typeof typed.type === "string" && typed.type.startsWith("canon") ? [node as AuthorNode] : [];
    return [...self, ...(typed.children ?? []).flatMap(canonNodes)];
}

describe("星瑕样本项目", () => {
    it("是一部作品：作品清单、活页夹三章、世界日志都在；重新打开世界读得到样本里的条目与修订", async () => {
        expect(JSON.parse(await readFile(join(project(), ".nbook", "project.json"), "utf8"))).toMatchObject({schema: 1, id: result.projectId});
        expect(result.revisions).toBe(12);

        const host = createWorldHost(project(), () => undefined);
        host.setComponents(BUILTIN_COMPONENTS);
        try {
            const service = await host.ready();
            if ("code" in service) throw new Error(service.code);
            expect(service.status().version).toBe(result.revisions);
            expect(service.chapters().items.map((chapter) => [chapter.id, chapter.title])).toEqual([["1", "好哥哥真难当"], ["2", "用钱说话"], ["3", null]]);

            const roots = service.tree(null, undefined, 500);
            if (roots === "cursor-stale") throw new Error(roots);
            const star = roots.items.find((item) => item.name === "星瑕")!;
            expect(star).toMatchObject({folder: "人物", hasChildren: true});
            const below = service.tree(star.id, undefined, 500);
            if (below === "cursor-stale") throw new Error(below);
            expect(below.items.map((item) => item.name)).toContain("哥哥");

            const end = {kind: "chapter" as const, chapter: "2", edge: "end" as const};
            const read = service.entry(star.id, end, "actual");
            if (typeof read === "string" || read.view === null) throw new Error(JSON.stringify(read));
            expect(read.view.namespaces.character?.type).toBe("nbook.canon.person");
            expect(Object.keys(read.view.namespaces.character?.fields ?? {})).toEqual(expect.arrayContaining(["身体", "样子", "外观", "性格", "态度"]));
            expect(read.view.namespaces.panel?.type).toBe("nbook.canon.panel");
            expect(typeof read.view.namespaces.panel?.fields.存款?.value).toBe("number");
            expect(read.view.namespaces.identity).toBeUndefined();

            const rendered = service.render(star.id, end, "actual", "author");
            if (rendered === null || typeof rendered === "string") throw new Error(String(rendered));
            const blocks = rendered.blocks as readonly AuthorBlock[];
            expect(blocks.filter((block) => "error" in block)).toEqual([]);
            const nodes = blocks.flatMap((block) => ("tree" in block ? canonNodes(block.tree) : []));
            // 马甲的外观原来在身份块里，并进了人物：文字里引用它的地方是值，不是占位。
            expect(nodes.filter((node) => node.type === "canonPlaceholder")).toEqual([]);
            expect(nodes.some((node) => node.type === "canonValue" && node.path === "character.外观" && node.entry !== null)).toBe(true);
        } finally {
            await host.stop();
        }
    });
});
