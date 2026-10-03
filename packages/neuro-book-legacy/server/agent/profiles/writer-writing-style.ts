import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";

export const DEFAULT_WRITING_STYLE_PRESET = "styles/distilled-light-comic-close-perspective.style.md";

const WritingStyleFrontmatterSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    sourcePreset: z.string().min(1),
    identifier: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean().nullable(),
    role: z.string().nullable(),
});

export type WritingStyleDefinition = z.infer<typeof WritingStyleFrontmatterSchema> & {
    readonly sourceFile: string;
    readonly content: string;
};

export type WritingStylePreset = string;

type WritingStyleFile = {
    readonly name: string;
    readonly absolutePath: string;
};

/**
 * 从 writer profile 默认 home 资源目录自动发现 Markdown 文风预设。
 */
export async function loadWritingStylePresets(candidates?: readonly string[]): Promise<WritingStyleDefinition[]> {
    const roots = candidates ?? [
        path.join(resolveSystemNbookRoot(), "agent", "profiles", "builtin", "writer.home", "styles"),
    ];
    const styleFiles = await listMergedWritingStyleFiles(roots);
    const styles: WritingStyleDefinition[] = [];

    for (const styleFile of styleFiles) {
        const content = await fs.readFile(styleFile.absolutePath, "utf-8");
        const parsed = parseFrontmatterDocument(content, WritingStyleFrontmatterSchema);
        if (!parsed.hasFrontmatter) {
            throw new Error(`Writing style missing frontmatter: ${styleFile.absolutePath}`);
        }
        styles.push({
            ...parsed.metadata,
            sourceFile: path.relative(process.cwd(), styleFile.absolutePath).split(path.sep).join("/"),
            content: parsed.body,
        });
    }
    return styles.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}

/**
 * 构造 writer 文风提示词。
 */
export async function buildWritingStyle(input: {preset?: WritingStylePreset; home?: ProfileHomeFacade} = {}): Promise<string> {
    const preset = input.preset ?? DEFAULT_WRITING_STYLE_PRESET;
    if (input.home) {
        const homeKey = normalizeStyleHomeKey(preset);
        const content = await input.home.readText(homeKey);
        const parsed = parseFrontmatterDocument(content, WritingStyleFrontmatterSchema.partial());
        const label = parsed.metadata.label ?? homeKey;
        const key = parsed.metadata.key ?? homeKey;
        return [
            `<writing_style preset="${escapeXmlAttribute(label)}" key="${escapeXmlAttribute(key)}" source="${escapeXmlAttribute(parsed.metadata.sourcePreset ?? "profile-home")}">`,
            parsed.body.trim() ? parsed.body.trim() : "空",
            "</writing_style>",
        ].join("\n");
    }
    const styles = await loadWritingStylePresets();
    const style = styles.find((item) => item.key === preset || legacyStyleKeyToHomeKey(item.key) === preset);
    if (!style) {
        throw new Error(`Unknown writing style preset: ${preset}`);
    }
    return [
        `<writing_style preset="${escapeXmlAttribute(style.label)}" key="${escapeXmlAttribute(style.key)}" source="${escapeXmlAttribute(style.sourcePreset)}">`,
        style.content.trim() ? style.content.trim() : "空",
        "</writing_style>",
    ].join("\n");
}

export function legacyStyleKeyToHomeKey(key: string): string {
    return `styles/${key}.md`;
}

export function homeStyleKeyToLegacyKey(key: string): string {
    return key.replace(/^styles\//u, "").replace(/\.md$/u, "") || "reborn-villain-loli-magic-girl.first-three-chapters.style";
}

export function normalizeStyleHomeKey(key: string): string {
    return key.includes("/") ? key : legacyStyleKeyToHomeKey(key);
}

async function listMergedWritingStyleFiles(candidates: readonly string[]): Promise<WritingStyleFile[]> {
    const filesByName = new Map<string, WritingStyleFile>();
    let foundDirectory = false;
    for (const candidate of candidates) {
        const entries = await readOptionalDirectory(candidate);
        if (!entries) {
            continue;
        }
        foundDirectory = true;
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".md")) {
                filesByName.set(entry.name, {
                    name: entry.name,
                    absolutePath: path.join(candidate, entry.name),
                });
            }
        }
    }
    if (!foundDirectory) {
        throw new Error(`Writing styles directory not found. Tried: ${candidates.join(", ")}`);
    }
    return [...filesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

async function readOptionalDirectory(directoryPath: string): Promise<Array<import("node:fs").Dirent> | null> {
    try {
        return await fs.readdir(directoryPath, {withFileTypes: true});
    } catch (error) {
        if (isMissingPathError(error)) {
            return null;
        }
        throw error;
    }
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
