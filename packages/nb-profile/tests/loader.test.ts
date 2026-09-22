import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {loadProfile, profileFromModule, renderProfile} from "../src";

const fixtures = resolve(import.meta.dir, "fixtures");
let tmpRoot = "";

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("nb-profile", "loader");
});

afterAll(async () => {
    if (tmpRoot !== "") {
        const {rm} = await import("node:fs/promises");
        await rm(tmpRoot, {recursive: true, force: true});
    }
});

describe("loadProfile", () => {
    test("加载 JSX fixture 并渲染（含系统段与历史展开）", async () => {
        const loaded = await loadProfile(join(fixtures, "hello.profile.tsx"));
        const rendered = renderProfile(loaded.node, {messages: [{role: "user", text: "历史消息"}]});

        expect(loaded.path.endsWith("hello.profile.tsx")).toBe(true);
        expect(rendered.systemPrompt).toEqual(["你是 nb-profile 的测试助手。", "第二段系统提示。"]);
        expect(rendered.messages).toEqual([{role: "user", text: "历史消息"}]);
    });

    test("加载任意路径下的 TS fixture（不依赖包内目录）", async () => {
        const entry = pathToFileURL(resolve(import.meta.dir, "..", "src", "index.ts")).href;
        const fixturePath = join(tmpRoot, "temp.profile.ts");
        await writeFile(
            fixturePath,
            `import {ProfilePrompt, System} from ${JSON.stringify(entry)};\n` +
                `export default ProfilePrompt({children: [System({children: ["来自临时目录"]})]});\n`,
            "utf-8",
        );

        const loaded = await loadProfile(fixturePath);
        expect(renderProfile(loaded.node, {messages: []}).systemPrompt).toEqual(["来自临时目录"]);
    });

    test("没有默认导出时抛错并带路径", async () => {
        await expect(loadProfile(join(fixtures, "no-default.profile.tsx"))).rejects.toThrow(/没有默认导出/u);
    });

    test("profileFromModule 拒绝非节点默认导出", () => {
        expect(() => profileFromModule({default: {kind: "X"}}, "memory.profile.tsx")).toThrow(/不是 ProfileNode/u);
        expect(() => profileFromModule({}, "memory.profile.tsx")).toThrow(/memory\.profile\.tsx/u);
    });
});
