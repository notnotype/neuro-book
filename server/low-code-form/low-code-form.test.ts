import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {
    applyLowCodeResourceMutations,
    defineResourcePreset,
    defineLowCodeForm,
    parseLowCodeFormValue,
    profileHomeResource,
    resolveLowCodeForm,
    validateLowCodeFormValue,
    type LowCodeFormResolveContext,
} from "nbook/server/low-code-form";
import {ensureGlobalProfileHome, ensureProfileHome} from "nbook/server/agent/profiles/profile-home";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("low-code form", () => {
    it("合并 defaults 并用 TypeBox 校验值", () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                title: Type.String(),
                count: Type.Number(),
            }, {additionalProperties: false}),
            defaults: {
                title: "默认",
                count: 1,
            },
            fields: [],
        });

        expect(parseLowCodeFormValue(form, {title: "覆盖"})).toEqual({
            title: "覆盖",
            count: 1,
        });
    });

    it("忽略 defaults 未声明的残留 key（字段下线后旧存档不炸）", () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                title: Type.String(),
            }, {additionalProperties: false}),
            defaults: {
                title: "默认",
            },
            fields: [],
        });

        expect(parseLowCodeFormValue(form, {title: "覆盖", retiredSwitch: true})).toEqual({
            title: "覆盖",
        });
    });

    it("把 TypeBox 校验失败转换为 issue", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                count: Type.Number(),
            }, {additionalProperties: false}),
            defaults: {
                count: 1,
            },
            fields: [],
        });

        const result = await validateLowCodeFormValue(form, {count: "bad"}, context());

        expect(result.issues).toEqual([
            expect.objectContaining({
                severity: "error",
                code: "type",
            }),
        ]);
    });

    it("解析动态 options 生成 DTO", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                mode: Type.String(),
            }),
            defaults: {
                mode: "a",
            },
            fields: [{
                path: "mode",
                component: "combobox",
                label: "模式",
                async options() {
                    return [
                        {value: "a", label: "A"},
                        {value: "b", label: "B"},
                    ];
                },
            }],
        });

        const dto = await resolveLowCodeForm(form, context());

        expect(dto.fields[0]?.options).toEqual([
            {value: "a", label: "A"},
            {value: "b", label: "B"},
        ]);
    });

    it("保留字段展示分区但不把分区写进 settings 值", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({mode: Type.String()}),
            defaults: {mode: "a"},
            fields: [{
                path: "mode",
                component: "text",
                label: "模式",
                section: {key: "features", label: "特色设置", description: "真实运行参数。"},
            }],
        });

        const dto = await resolveLowCodeForm(form, context());

        expect(dto.fields[0]?.section).toEqual({key: "features", label: "特色设置", description: "真实运行参数。"});
        expect(parseLowCodeFormValue(form, undefined)).toEqual({mode: "a"});
    });

    it("执行自定义校验", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                title: Type.String(),
            }),
            defaults: {
                title: "",
            },
            fields: [],
            validate(value) {
                return value.title.includes("禁用")
                    ? [{path: "title", severity: "error", message: "标题不能包含禁用词。"}]
                    : [];
            },
        });

        const result = await validateLowCodeFormValue(form, {title: "禁用"}, context());

        expect(result.issues).toEqual([
            {path: "title", severity: "error", message: "标题不能包含禁用词。"},
        ]);
    });

    it("combobox 不接受 options 外的值", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                preset: Type.String(),
            }),
            defaults: {
                preset: "a",
            },
            fields: [{
                path: "preset",
                component: "combobox",
                label: "预设",
                options: [{value: "a", label: "A"}],
            }],
        });

        const result = await validateLowCodeFormValue(form, {preset: "x"}, context());

        expect(result.issues).toEqual([
            expect.objectContaining({
                path: "preset",
                code: "option",
            }),
        ]);
    });

    it("checkbox 不接受 options 外的数组项", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                tags: Type.Array(Type.String()),
            }),
            defaults: {
                tags: [],
            },
            fields: [{
                path: "tags",
                component: "checkbox",
                label: "标签",
                options: [{value: "a", label: "A"}],
            }],
        });

        const result = await validateLowCodeFormValue(form, {tags: ["a", "x"]}, context());

        expect(result.issues).toEqual([
            expect.objectContaining({
                path: "tags",
                code: "option",
            }),
        ]);
    });

    it("第一版只允许顶层字段 path", () => {
        expect(() => defineLowCodeForm({
            schema: Type.Object({
                nested: Type.Object({
                    title: Type.String(),
                }),
            }),
            defaults: {
                nested: {
                    title: "默认",
                },
            },
            fields: [{
                path: "nested.title",
                component: "text",
                label: "标题",
            }],
        })).toThrow("顶层字段");
    });

    it("checkbox option value 只允许 string 或 number", async () => {
        expect(() => defineLowCodeForm({
            schema: Type.Object({
                flags: Type.Array(Type.Boolean()),
            }),
            defaults: {
                flags: [],
            },
            fields: [{
                path: "flags",
                component: "checkbox",
                label: "标记",
                options: [{value: true, label: "启用"}],
            }],
        })).toThrow("string 或 number");

        const form = defineLowCodeForm({
            schema: Type.Object({
                flags: Type.Array(Type.String()),
            }),
            defaults: {
                flags: [],
            },
            fields: [{
                path: "flags",
                component: "checkbox",
                label: "标记",
                async options() {
                    return [{value: true, label: "启用"}];
                },
            }],
        });

        await expect(resolveLowCodeForm(form, context())).rejects.toThrow("string 或 number");
    });

    it("Global scope 下 resource-preset 使用 Global profile home", async () => {
        const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-global-resource-"));
        try {
            const home = await ensureGlobalProfileHome({workspaceRoot: absoluteFsPath(workspaceRoot), profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/global.md", "---\ntitle: \"全局文风\"\n---\n\n正文", {mode: "overwrite"});
            const form = resourceForm();
            const ctx = context({home, values: {preset: "styles/global.md"}});

            const dto = await resolveLowCodeForm(form, ctx);
            const validation = await validateLowCodeFormValue(form, {preset: "styles/global.md"}, ctx);

            expect(dto.fields[0]?.resource?.options).toEqual([expect.objectContaining({key: "styles/global.md", label: "全局文风", origin: "global"})]);
            expect(dto.fields[0]?.resource?.content).toMatchObject({key: "styles/global.md", origin: "global"});
            expect(dto.fields[0]?.resource?.capabilities).toMatchObject({create: true, update: true, rename: true, remove: true});
            expect(validation.issues).toEqual([]);
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("Project scope 下 resource-preset 列出 Markdown 资源并校验 selected key", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/plain.md", "---\ntitle: \"朴素\"\n---\n\n正文", {mode: "overwrite"});
            const form = resourceForm();
            const ctx = context({scope: "project", home, values: {preset: "styles/plain.md"}});

            const dto = await resolveLowCodeForm(form, ctx);
            const result = await validateLowCodeFormValue(form, {preset: "styles/missing.md"}, ctx);
            const legacyResult = await validateLowCodeFormValue(form, {preset: "plain"}, ctx);

            expect(dto.fields[0]?.resource?.options).toEqual([expect.objectContaining({key: "styles/plain.md", label: "朴素"})]);
            expect(dto.fields[0]?.resource?.contents[0]).toMatchObject({key: "styles/plain.md", content: "---\ntitle: \"朴素\"\n---\n\n正文"});
            expect(result.issues).toEqual([expect.objectContaining({path: "preset", code: "resource_key"})]);
            expect(legacyResult.issues).toEqual([]);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("Project scope 下展示 Global resource 为只读继承资源", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-global-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            const globalHome = await ensureGlobalProfileHome({workspaceRoot: absoluteFsPath(workspaceRoot), profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/project.md", "---\ntitle: \"项目文风\"\n---\n\n项目正文", {mode: "overwrite"});
            await globalHome.writeText("styles/global.md", "---\ntitle: \"全局文风\"\n---\n\n全局正文", {mode: "overwrite"});
            const form = resourceForm();
            const ctx = context({scope: "project", home, globalHome, values: {preset: "styles/global.md"}});

            const dto = await resolveLowCodeForm(form, ctx);
            const strictValidation = await validateLowCodeFormValue(form, {preset: "styles/global.md"}, ctx);
            const inheritedValidation = await validateLowCodeFormValue(form, {preset: "styles/global.md"}, {...ctx, allowGlobalResourceKeys: true});

            expect(dto.fields[0]?.resource?.options).toEqual([
                expect.objectContaining({key: "styles/project.md", origin: "project", editable: true}),
                expect.objectContaining({key: "styles/global.md", origin: "global", editable: false, deletable: false}),
            ]);
            expect(dto.fields[0]?.resource?.content).toMatchObject({key: "styles/global.md", origin: "global", content: expect.stringContaining("全局正文")});
            expect(strictValidation.issues).toEqual([expect.objectContaining({path: "preset", code: "resource_key"})]);
            expect(inheritedValidation.issues).toEqual([]);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 先执行，再允许 selected key 通过校验", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            const form = resourceForm();
            const ctx = context({scope: "project", home, values: {preset: "styles/new.md"}});

            const mutationResults = await applyLowCodeResourceMutations(form, [{
                type: "create",
                fieldPath: "preset",
                label: "新文风",
                slug: "new",
                content: "新的正文",
            }], ctx, {preset: "styles/new.md"});
            const validation = await validateLowCodeFormValue(form, {preset: "styles/new.md"}, ctx);

            expect(mutationResults).toEqual([{fieldPath: "preset", issues: []}]);
            expect(validation.issues).toEqual([]);
            await expect(home.readText("styles/new.md")).resolves.toContain("新的正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 禁止删除当前 selected key", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/plain.md", "正文", {mode: "overwrite"});
            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "remove",
                fieldPath: "preset",
                key: "styles/plain.md",
            }], context({scope: "project", home}), {preset: "styles/plain.md"});

            expect(result[0]?.issues[0]).toMatchObject({code: "resource_in_use"});
            await expect(home.exists("styles/plain.md")).resolves.toBe(true);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 新建目标已存在时失败且不覆盖原文件", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/new.md", "旧正文", {mode: "overwrite"});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "create",
                fieldPath: "preset",
                label: "新文风",
                slug: "new",
                content: "新的正文",
            }], context({scope: "project", home}), {preset: "styles/new.md"});

            expect(result[0]?.issues[0]).toMatchObject({code: "resource_exists"});
            await expect(home.readText("styles/new.md")).resolves.toBe("旧正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 重命名目标已存在时失败且不修改目标文件", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/source.md", "源正文", {mode: "overwrite"});
            await home.writeText("styles/taken.md", "---\ntitle: \"已有\"\n---\n\n已有正文", {mode: "overwrite"});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "rename",
                fieldPath: "preset",
                key: "styles/source.md",
                label: "改名",
                slug: "taken",
            }], context({scope: "project", home}), {preset: "styles/taken.md"});

            expect(result[0]?.issues[0]).toMatchObject({code: "resource_exists"});
            await expect(home.readText("styles/source.md")).resolves.toBe("源正文");
            await expect(home.readText("styles/taken.md")).resolves.toBe("---\ntitle: \"已有\"\n---\n\n已有正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 执行前先整批校验，后续失败时前面的新建也不落盘", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/taken.md", "已有正文", {mode: "overwrite"});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "create",
                fieldPath: "preset",
                label: "先创建",
                slug: "first",
                content: "不应该落盘",
            }, {
                type: "create",
                fieldPath: "preset",
                label: "冲突",
                slug: "taken",
                content: "冲突正文",
            }], context({scope: "project", home}), {preset: "styles/first.md"});

            expect(result[1]?.issues[0]).toMatchObject({code: "resource_exists"});
            await expect(home.exists("styles/first.md")).resolves.toBe(false);
            await expect(home.readText("styles/taken.md")).resolves.toBe("已有正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 预校验使用 resolver key 规则，非法 slug 不会导致前序新建落盘", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "create",
                fieldPath: "preset",
                label: "先创建",
                slug: "first",
                content: "不应该落盘",
            }, {
                type: "create",
                fieldPath: "preset",
                label: "非法",
                slug: "bad/name",
                content: "非法正文",
            }], context({scope: "project", home}), {preset: "styles/first.md"});

            expect(result[1]?.issues[0]).toMatchObject({code: "resource_key"});
            await expect(home.exists("styles/first.md")).resolves.toBe(false);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 支持新建后编辑再重命名并保留最终内容", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "create",
                fieldPath: "preset",
                label: "临时文风",
                slug: "draft",
                content: "初稿",
            }, {
                type: "update",
                fieldPath: "preset",
                key: "styles/draft.md",
                content: "编辑后的正文",
            }, {
                type: "rename",
                fieldPath: "preset",
                key: "styles/draft.md",
                label: "最终文风",
                slug: "final",
            }], context({scope: "project", home}), {preset: "styles/final.md"});

            expect(result).toEqual([
                {fieldPath: "preset", issues: []},
                {fieldPath: "preset", issues: []},
                {fieldPath: "preset", issues: []},
            ]);
            await expect(home.exists("styles/draft.md")).resolves.toBe(false);
            await expect(home.readText("styles/final.md")).resolves.toBe("---\ntitle: \"最终文风\"\n---\n\n编辑后的正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("resource mutations 支持连续重命名后编辑最终 key", async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), "nbook-low-code-resource-"));
        try {
            const home = await ensureProfileHome({projectRoot, profileKey: "writer", profileVersion: 1});
            await home.writeText("styles/source.md", "源正文", {mode: "overwrite"});

            const result = await applyLowCodeResourceMutations(resourceForm(), [{
                type: "rename",
                fieldPath: "preset",
                key: "styles/source.md",
                label: "中间文风",
                slug: "middle",
            }, {
                type: "rename",
                fieldPath: "preset",
                key: "styles/middle.md",
                label: "最终文风",
                slug: "final",
            }, {
                type: "update",
                fieldPath: "preset",
                key: "styles/final.md",
                content: "最终正文",
            }], context({scope: "project", home}), {preset: "styles/final.md"});

            expect(result).toEqual([
                {fieldPath: "preset", issues: []},
                {fieldPath: "preset", issues: []},
                {fieldPath: "preset", issues: []},
            ]);
            await expect(home.exists("styles/source.md")).resolves.toBe(false);
            await expect(home.exists("styles/middle.md")).resolves.toBe(false);
            await expect(home.readText("styles/final.md")).resolves.toBe("最终正文");
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });

    it("自定义 resolver 缺少 createKey 时不暴露 create 能力并拒绝新建 mutation", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                preset: Type.String(),
            }),
            defaults: {
                preset: "alpha",
            },
            fields: [{
                path: "preset",
                component: "resource-preset",
                label: "预设",
                resource: defineResourcePreset({
                    contentType: "markdown",
                    list: () => [{key: "alpha", label: "Alpha"}],
                    read: (_ctx, key) => ({key, contentType: "markdown", content: "alpha"}),
                    create: (_ctx, mutation) => ({key: mutation.slug, contentType: "markdown", content: mutation.content ?? ""}),
                }),
            }],
        });

        const dto = await resolveLowCodeForm(form, context({scope: "project"}));
        const result = await applyLowCodeResourceMutations(form, [{
            type: "create",
            fieldPath: "preset",
            label: "Beta",
            slug: "beta",
        }], context({scope: "project"}), {preset: "beta"});

        expect(dto.fields[0]?.resource?.capabilities.create).toBe(false);
        expect(result[0]?.issues[0]).toMatchObject({code: "resource_action"});
    });

    it("自定义 resolver 缺少 key 模板时不暴露 create 能力并拒绝新建 mutation", async () => {
        const form = defineLowCodeForm({
            schema: Type.Object({
                preset: Type.String(),
            }),
            defaults: {
                preset: "alpha",
            },
            fields: [{
                path: "preset",
                component: "resource-preset",
                label: "预设",
                resource: defineResourcePreset({
                    contentType: "markdown",
                    list: () => [{key: "alpha", label: "Alpha"}],
                    read: (_ctx, key) => ({key, contentType: "markdown", content: "alpha"}),
                    create: (_ctx, mutation) => ({key: mutation.slug, contentType: "markdown", content: mutation.content ?? ""}),
                    createKey: (_ctx, mutation) => mutation.slug,
                }),
            }],
        });

        const dto = await resolveLowCodeForm(form, context({scope: "project"}));
        const result = await applyLowCodeResourceMutations(form, [{
            type: "create",
            fieldPath: "preset",
            label: "Beta",
            slug: "beta",
        }], context({scope: "project"}), {preset: "beta"});

        expect(dto.fields[0]?.resource?.capabilities.create).toBe(false);
        expect(result[0]?.issues[0]).toMatchObject({code: "resource_action"});
    });
});

/**
 * 创建测试用低代码 form 上下文。
 */
function resourceForm() {
    return defineLowCodeForm({
        schema: Type.Object({
            preset: Type.String(),
        }),
        defaults: {
            preset: "styles/plain.md",
        },
        fields: [{
            path: "preset",
            component: "resource-preset",
            label: "预设",
            resource: profileHomeResource({directory: "styles", template: "模板"}),
        }],
    });
}

function context(overrides: Partial<LowCodeFormResolveContext> = {}): LowCodeFormResolveContext {
    return {
        profileKey: "writer",
        scope: "global" as const,
        workspaceRoot: "workspace",
        ...overrides,
    };
}
