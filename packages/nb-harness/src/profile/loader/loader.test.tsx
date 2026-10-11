import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createProfileCatalog, createProfileHost, defineProfile, Prompt, System} from "../profile";
import type {Profile} from "../profile";
import {loadProfile, profileFromModule} from "./loader";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

const PROFILE_SOURCE = `/** @jsxImportSource @notnotype/nb-harness/profile */
import {defineProfile, Prompt, System, User} from "@notnotype/nb-harness/profile";

export default defineProfile({
    id: "loaded", name: "从文件加载", description: "d", version: 2,
    prompt: (ctx) => (
        <Prompt>
            <System>会话 {ctx.session.id}</System>
            <User>你好</User>
        </Prompt>
    ),
});
`;

describe("加载（输出 12）", () => {
    test("场景 9：从临时目录加载 .profile.tsx，得到可准备、可渲染的 Profile；没有默认导出为 invalid-profile；模块执行失败为 module-load-failed", async () => {
        const root = await createTestTmpRoot("nb-harness-profile-loader", "profile-loader");
        roots.push(root);
        await mkdir(join(root, "profiles"), {recursive: true});
        const path = join(root, "profiles", "loaded.profile.tsx");
        await writeFile(path, PROFILE_SOURCE, "utf8");

        const loaded = await loadProfile(path);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        expect(loaded.value).toMatchObject({id: "loaded", version: 2});
        const host = createProfileHost();
        const prepared = await host.prepare(loaded.value, {context: {session: {id: "abc", createdAt: "2026-10-10T00:00:00.000Z"}, turn: 1, now: new Date(0), fields: {}}});
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) return;
        expect(host.renderSystem(prepared.value).systemPrompt).toEqual(["会话 abc"]);
        expect(host.renderRequest(prepared.value, {history: [], invocationStart: 0}).messages.map((m) => m.content)).toEqual(["你好"]);

        const noDefault = join(root, "profiles", "no-default.ts");
        await writeFile(noDefault, "export const notDefault = 1;\n", "utf8");
        const missing = await loadProfile(noDefault);
        expect(missing.ok ? null : missing.code).toBe("invalid-profile");

        const broken = join(root, "profiles", "broken.ts");
        await writeFile(broken, "throw new Error('模块执行失败');\n", "utf8");
        const failed = await loadProfile(broken);
        expect(failed.ok ? null : `${failed.code}:${failed.detail}`).toContain("module-load-failed:");
        expect(failed.ok ? "" : failed.detail).toContain("模块执行失败");

        const nowhere = await loadProfile(join(root, "profiles", "nowhere.tsx"));
        expect(nowhere.ok ? null : nowhere.code).toBe("module-load-failed");

        // 文件里的 defineProfile 定义不合规则：是 Profile 本身的问题，报 invalid-profile 而不是 module-load-failed。
        const invalid = join(root, "profiles", "invalid.profile.tsx");
        await writeFile(invalid, PROFILE_SOURCE.replace('id: "loaded"', 'id: "Bad Id"'), "utf8");
        const badDefinition = await loadProfile(invalid);
        expect(badDefinition.ok ? null : `${badDefinition.code}:${badDefinition.detail}`).toContain("invalid-profile:");
        expect(badDefinition.ok ? "" : badDefinition.detail).toContain("id");
        const syntax = join(root, "profiles", "syntax.profile.tsx");
        await writeFile(syntax, "export default defineProfile({", "utf8");
        expect((await loadProfile(syntax)).ok ? null : (await loadProfile(syntax) as {code: string}).code).toBe("module-load-failed");
    });

    test("profileFromModule 只认 defineProfile 的结果；defineProfile 拒绝不合规则的定义；一等属性并进 fields，与 fields 同给被拒", () => {
        const profile = defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System>s</System></Prompt>});
        expect(profileFromModule({default: profile}).ok).toBe(true);
        const sugared = defineProfile({
            id: "p", name: "n", description: "d", version: 1, tools: ["read", "edit"], model: {role: "writer"}, compaction: {threshold: {percent: 80}}, approval: "write",
            fields: {"plugin.x/flag": true}, prompt: () => <Prompt><System>s</System></Prompt>,
        });
        expect(sugared.fields).toEqual({"plugin.x/flag": true, "harness/tools": ["read", "edit"], "harness/model": {role: "writer"}, "harness/compaction": {threshold: {percent: 80}}, "harness/approval": "write"});
        expect("tools" in sugared).toBe(false);
        expect(() => defineProfile({id: "p", name: "n", description: "d", version: 1, tools: ["read"], fields: {"harness/tools": ["edit"]}, prompt: () => <Prompt />})).toThrow('tools 与 fields["harness/tools"] 只能给一个');
        // 值为 undefined 的字段：不是合法的字段值，也躲不过冲突判定
        expect(() => defineProfile({id: "p", name: "n", description: "d", version: 1, tools: ["read"], fields: {"harness/tools": undefined as never}, prompt: () => <Prompt />})).toThrow("undefined");
        expect(() => defineProfile({id: "p", name: "n", description: "d", version: 1, fields: {"plugin.x/flag": undefined as never}, prompt: () => <Prompt />})).toThrow("undefined");
        const fake = profileFromModule({default: {id: "p", name: "n", description: "d", version: 1, prompt: () => null}});
        expect(fake.ok ? null : fake.code).toBe("invalid-profile");
        expect(() => defineProfile({id: "Bad Id", name: "n", description: "d", version: 1, prompt: () => <Prompt />})).toThrow(TypeError);
        expect(() => defineProfile({id: "p", name: "", description: "d", version: 1, prompt: () => <Prompt />})).toThrow("name");
        expect(() => defineProfile({id: "p", name: "n", description: "d", version: 0, prompt: () => <Prompt />})).toThrow("version");
    });
});

describe("目录（输出 13）", () => {
    const make = (id: string, name: string): Profile => defineProfile({id, name, description: "d", version: 1, prompt: () => <Prompt />});

    test("场景 8：内置、用户、项目三组各有同 id 的 Profile 时取项目组的；同一组内重复时都不收录并报告", () => {
        const catalog = createProfileCatalog([
            {source: "builtin", profiles: [make("writer", "内置"), make("editor", "内置编辑")]},
            {source: "user", profiles: [make("writer", "用户"), make("dup", "用户 1"), make("dup", "用户 2")]},
            {source: "project", profiles: [make("writer", "项目")]},
        ]);
        expect(catalog.get("writer")?.name).toBe("项目");
        expect(catalog.get("editor")?.name).toBe("内置编辑");
        expect(catalog.get("dup")).toBeUndefined();
        expect(catalog.list().map((profile) => profile.id).sort()).toEqual(["editor", "writer"]);
        expect(catalog.issues).toEqual([
            {severity: "error", code: "duplicate-profile", path: "user:dup", detail: "组 user 里有多个 id 为 dup 的 Profile，都不收录"},
            {severity: "error", code: "duplicate-profile", path: "user:dup", detail: "组 user 里有多个 id 为 dup 的 Profile，都不收录"},
        ]);
    });
});
