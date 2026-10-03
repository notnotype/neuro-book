import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import type {ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";

export const DEFAULT_WRITING_REFERENCE_PRESET = "references/reborn-villain-loli-magic-girl.first-three-chapters.md";
const LEGACY_DEFAULT_WRITING_REFERENCE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters";

const WritingReferenceFrontmatterSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    sourceTitle: z.string().min(1),
    sourceChapters: z.string().min(1),
    generatedFrom: z.string().min(1),
});

export type WritingReferenceDefinition = z.infer<typeof WritingReferenceFrontmatterSchema> & {
    readonly sourceFile: string;
    readonly content: string;
};

export type WritingReferencePreset = string;

type WritingReferenceFile = {
    readonly name: string;
    readonly absolutePath: string;
};

/**
 * 从 writer profile 默认 home 资源目录自动发现 Markdown 文风参考正文。
 */
export async function loadWritingReferencePresets(candidates?: readonly string[]): Promise<WritingReferenceDefinition[]> {
    const roots = candidates ?? [
        path.join(resolveSystemNbookRoot(), "agent", "profiles", "builtin", "writer.home", "references"),
    ];
    const referenceFiles = await listMergedWritingReferenceFiles(roots);
    const references: WritingReferenceDefinition[] = [];

    for (const referenceFile of referenceFiles) {
        const content = await fs.readFile(referenceFile.absolutePath, "utf-8");
        const parsed = parseFrontmatterDocument(content, WritingReferenceFrontmatterSchema);
        if (!parsed.hasFrontmatter) {
            throw new Error(`Writing reference missing frontmatter: ${referenceFile.absolutePath}`);
        }
        references.push({
            ...parsed.metadata,
            sourceFile: path.relative(process.cwd(), referenceFile.absolutePath).split(path.sep).join("/"),
            content: parsed.body,
        });
    }
    return references.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}

/**
 * 构造 writer 文风参考正文提示词。
 */
export async function buildWritingReference(input: {preset?: WritingReferencePreset; home?: ProfileHomeFacade} = {}): Promise<string> {
    const preset = input.preset ?? DEFAULT_WRITING_REFERENCE_PRESET;
    if (input.home) {
        const homeKey = normalizeReferenceHomeKey(preset);
        const content = await input.home.readText(homeKey);
        const parsed = parseFrontmatterDocument(content, WritingReferenceFrontmatterSchema.partial());
        return [
            "<writing_reference>",
            parsed.body.trim() ? parsed.body.trim() : "空",
            "</writing_reference>",
        ].join("\n");
    }
    const references = await loadWritingReferencePresets();
    const reference = references.find((item) => item.key === preset || legacyReferenceKeyToHomeKey(item.key) === preset);
    if (!reference) {
        throw new Error(`Unknown writing reference preset: ${preset}`);
    }
    return [
        "<writing_reference>",
        reference.content.trim() ? reference.content.trim() : "空",
        "</writing_reference>",
    ].join("\n");
}

export function legacyReferenceKeyToHomeKey(key: string): string {
    return `references/${key}.md`;
}

export function homeReferenceKeyToLegacyKey(key: string): string {
    return key.replace(/^references\//u, "").replace(/\.md$/u, "") || LEGACY_DEFAULT_WRITING_REFERENCE_PRESET;
}

export function normalizeReferenceHomeKey(key: string): string {
    return key.includes("/") ? key : legacyReferenceKeyToHomeKey(key);
}

async function listMergedWritingReferenceFiles(candidates: readonly string[]): Promise<WritingReferenceFile[]> {
    const filesByName = new Map<string, WritingReferenceFile>();
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
        throw new Error(`Writing references directory not found. Tried: ${candidates.join(", ")}`);
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

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
