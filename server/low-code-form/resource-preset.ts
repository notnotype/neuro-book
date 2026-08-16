import type {LowCodeFormResolveContext} from "nbook/server/low-code-form";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {stripFrontmatterBody} from "nbook/server/utils/frontmatter-document";
import type {
    ResourcePresetContent,
    ResourcePresetCreateInput,
    ResourcePresetDefinition,
    ResourcePresetOption,
    ResourcePresetRenameInput,
    ResourcePresetUpdatePatch,
} from "nbook/profile-sdk/contracts";
export type {
    ResourcePresetContent,
    ResourcePresetCreateInput,
    ResourcePresetDefinition,
    ResourcePresetOption,
    ResourcePresetRenameInput,
    ResourcePresetUpdatePatch,
} from "nbook/profile-sdk/contracts";

export type ResourcePresetContext = LowCodeFormResolveContext & {
    home?: ProfileHomeFacade;
};

/**
 * 定义 resource-preset resolver。resolver 只在服务端执行。
 */
export function defineResourcePreset(definition: ResourcePresetDefinition): ResourcePresetDefinition {
    return definition;
}

/**
 * 基于 profile home 目录的 Markdown resource-preset helper。
 */
export function profileHomeResource(input: {
    directory: string;
    extension?: ".md";
    template?: string;
}): ResourcePresetDefinition {
    const extension = input.extension ?? ".md";
    const keyForSlug = (slug: string) => joinResourcePath(input.directory, `${sanitizeSlug(slug)}${extension}`);
    return defineResourcePreset({
        contentType: "markdown",
        template: input.template,
        createKeyPrefix: `${normalizeResourcePath(input.directory)}/`,
        createKeySuffix: extension,
        async list(ctx) {
            const home = requireHome(ctx);
            const items = await home.list(input.directory);
            return Promise.all(items
                .filter((item) => item.kind === "file" && item.name.endsWith(extension))
                .map(async (item) => {
                    const key = joinResourcePath(input.directory, item.name);
                    const content = await home.readText(key);
                    return {
                        key,
                        label: readMarkdownTitle(content) ?? item.name.slice(0, -extension.length),
                        editable: true,
                        deletable: true,
                    };
                }));
        },
        async read(ctx, key) {
            assertProfileHomeResourceKey(input.directory, extension, key);
            return {
                key,
                contentType: "markdown",
                content: await requireHome(ctx).readText(key),
            };
        },
        async create(ctx, mutation) {
            const key = keyForSlug(mutation.slug);
            const result = await requireHome(ctx).writeText(key, withMarkdownTitle(mutation.content ?? input.template ?? "", mutation.label), {mode: "create"});
            if (!result.written) {
                throw new Error(`资源已存在：${key}`);
            }
            return {
                key,
                contentType: "markdown",
                content: await requireHome(ctx).readText(key),
            };
        },
        createKey(_ctx, mutation) {
            return keyForSlug(mutation.slug);
        },
        async update(ctx, key, patch) {
            assertProfileHomeResourceKey(input.directory, extension, key);
            const home = requireHome(ctx);
            const current = await home.readText(key);
            const nextContent = patch.content ?? current;
            await home.writeText(key, patch.label ? withMarkdownTitle(nextContent, patch.label) : nextContent, {mode: "overwrite"});
        },
        async rename(ctx, key, mutation) {
            assertProfileHomeResourceKey(input.directory, extension, key);
            const nextKey = keyForSlug(mutation.slug);
            const result = await requireHome(ctx).move(key, nextKey, {mode: "create"});
            if (!result.written) {
                throw new Error(`资源已存在：${nextKey}`);
            }
            if (mutation.label) {
                const home = requireHome(ctx);
                const content = await home.readText(nextKey);
                await home.writeText(nextKey, withMarkdownTitle(content, mutation.label), {mode: "overwrite"});
            }
            return {key: nextKey, label: mutation.label};
        },
        renameKey(_ctx, key, mutation) {
            assertProfileHomeResourceKey(input.directory, extension, key);
            return keyForSlug(mutation.slug);
        },
        async remove(ctx, key) {
            assertProfileHomeResourceKey(input.directory, extension, key);
            await requireHome(ctx).remove(key);
        },
        async validateKey(ctx, key) {
            try {
                assertProfileHomeResourceKey(input.directory, extension, key);
                return await requireHome(ctx).exists(key);
            } catch {
                return false;
            }
        },
    });
}

export function assertProfileHomeResourceKey(directory: string, extension: string, key: string): void {
    const normalizedDirectory = normalizeResourcePath(directory);
    const normalizedKey = normalizeResourcePath(key);
    if (!normalizedKey.startsWith(`${normalizedDirectory}/`) || !normalizedKey.endsWith(extension)) {
        throw new Error(`资源 key 不在允许目录内：${key}`);
    }
    const rest = normalizedKey.slice(normalizedDirectory.length + 1);
    if (rest.includes("/")) {
        throw new Error(`resource-preset 第一版不支持子目录：${key}`);
    }
}

function requireHome(ctx: ResourcePresetContext): ProfileHomeFacade {
    if (!ctx.home) {
        throw new Error("resource-preset 需要 profile home。");
    }
    return ctx.home;
}

function joinResourcePath(directory: string, fileName: string): string {
    return `${normalizeResourcePath(directory)}/${fileName}`;
}

function normalizeResourcePath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`非法 resource-preset 路径：${value}`);
    }
    return normalized;
}

function sanitizeSlug(slug: string): string {
    const normalized = slug.trim().replace(/\.md$/u, "");
    if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) {
        throw new Error(`资源文件名只支持 A-Z、a-z、0-9、点、下划线和连字符：${slug}`);
    }
    return normalized;
}

function readMarkdownTitle(content: string): string | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(content);
    if (!match) return null;
    const titleLine = (match[1] ?? "").split(/\r?\n/u).find((line) => line.trim().startsWith("title:"));
    if (!titleLine) return null;
    return titleLine.slice(titleLine.indexOf(":") + 1).trim().replace(/^["']|["']$/gu, "") || null;
}

function withMarkdownTitle(content: string, title: string): string {
    const cleanTitle = title.replaceAll("\"", "\\\"");
    const body = stripFrontmatterBody(content);
    if (body !== content) {
        return `---\ntitle: "${cleanTitle}"\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
    }
    return `---\ntitle: "${cleanTitle}"\n---\n\n${content}`;
}
