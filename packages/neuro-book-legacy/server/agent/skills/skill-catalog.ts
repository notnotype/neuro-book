import {existsSync} from "node:fs";
import {readFile, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {consola} from "consola";

export type SkillCatalogSource = "install" | "project";

export type SkillCatalogItem = {
    key: string;
    name: string;
    description?: string;
    whenToUse?: string;
    /** 仅 runnable Skill 存在，来自 package.json.version。 */
    version?: string;
    source: SkillCatalogSource;
    rootPath: string;
    skillPath: string;
};

const DISABLED_LEGACY_SKILL_KEYS = new Set(["anti-ai-slop"]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

type LoadedSkillRoot = {
    skills: SkillCatalogItem[];
    /** 含 SKILL.md 的目录都会占用 key；无效 Project 覆盖不能悄悄回退到同名 Install Skill。 */
    declaredKeys: Set<string>;
};

/** Install Root → 当前 Project Root 的整体覆盖 Skill Catalog。 */
export class SkillCatalog {
    private readonly installRoot: string;
    private readonly configuredProjectRoot?: string;

    /** configuredProjectRoot 是 Project Workspace 根，不是 `.nbook/agent` 子根。 */
    constructor(installRoot: string, configuredProjectRoot?: string) {
        this.installRoot = resolve(installRoot);
        this.configuredProjectRoot = configuredProjectRoot ? resolve(configuredProjectRoot) : undefined;
    }

    async list(projectRoot?: string): Promise<SkillCatalogItem[]> {
        const skills = new Map<string, SkillCatalogItem>();
        const installCatalog = await this.loadRoot(this.installRoot, "install");
        for (const skill of installCatalog.skills) skills.set(skill.key, skill);
        const project = projectRoot ? resolve(projectRoot) : this.configuredProjectRoot;
        if (project) {
            const projectCatalog = await this.loadRoot(join(project, ".nbook", "agent", "skills"), "project");
            for (const skillKey of projectCatalog.declaredKeys) skills.delete(skillKey);
            for (const skill of projectCatalog.skills) skills.set(skill.key, skill);
        }
        return [...skills.values()].sort((left, right) => left.key.localeCompare(right.key));
    }

    async get(skillKey: string, projectRoot?: string): Promise<SkillCatalogItem | null> {
        return (await this.list(projectRoot)).find((skill) => skill.key === skillKey) ?? null;
    }

    private async loadRoot(root: string, source: SkillCatalogSource): Promise<LoadedSkillRoot> {
        if (!existsSync(root)) return {skills: [], declaredKeys: new Set()};
        const entries = await readdir(root, {withFileTypes: true});
        const skills: SkillCatalogItem[] = [];
        const declaredKeys = new Set<string>();
        for (const entry of entries) {
            if (!entry.isDirectory() || DISABLED_LEGACY_SKILL_KEYS.has(entry.name)) continue;
            const rootPath = join(root, entry.name);
            const skillPath = await this.findSkillFile(rootPath);
            if (!skillPath) continue;
            declaredKeys.add(entry.name);
            try {
                const metadata = this.readMetadata(await readFile(skillPath, "utf8"));
                const version = await this.readVersion(rootPath);
                skills.push({
                    key: entry.name,
                    name: metadata.name ?? entry.name,
                    description: metadata.description,
                    whenToUse: metadata.whenToUse,
                    version,
                    source,
                    rootPath,
                    skillPath,
                });
            } catch (error) {
                if (source === "install") throw error;
                consola.warn({skillKey: entry.name, rootPath, error}, "Project Skill package 无效，已隔离该 Skill");
            }
        }
        return {skills, declaredKeys};
    }

    private async findSkillFile(rootPath: string): Promise<string | null> {
        for (const name of ["SKILL.md", "skill.md"]) {
            const skillPath = join(rootPath, name);
            if (existsSync(skillPath)) return skillPath;
        }
        return null;
    }

    private async readVersion(rootPath: string): Promise<string | undefined> {
        const packagePath = join(rootPath, "package.json");
        if (!existsSync(packagePath)) return undefined;
        const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {version?: string | null};
        if (typeof packageJson.version !== "string" || !packageJson.version.trim()) throw new Error(`runnable Skill package.json.version 不能为空: ${packagePath}`);
        const version = packageJson.version.trim();
        if (!SEMVER_PATTERN.test(version)) throw new Error(`runnable Skill package.json.version 必须是 SemVer: ${packagePath}`);
        return version;
    }

    private readMetadata(source: string): {name?: string; description?: string; whenToUse?: string} {
        const frontmatter = source.match(/^---\r?\n(?<body>[\s\S]*?)\r?\n---/u)?.groups?.body;
        if (!frontmatter) {
            const heading = source.split(/\r?\n/).find((line) => line.trim().startsWith("# "))?.replace(/^#\s+/, "").trim();
            return {name: heading || undefined};
        }
        const metadata: {name?: string; description?: string; whenToUse?: string} = {};
        let currentListKey: "when_to_use" | null = null;
        const whenToUseItems: string[] = [];
        for (const line of frontmatter.split(/\r?\n/)) {
            const listMatch = line.match(/^\s*-\s*(?<value>.+)$/u);
            if (currentListKey === "when_to_use" && listMatch?.groups?.value) {
                whenToUseItems.push(cleanYamlScalar(listMatch.groups.value));
                continue;
            }
            currentListKey = null;
            const match = line.match(/^(name|description|when_to_use):\s*(?<value>.*)$/u);
            if (!match?.groups || !match[1]) continue;
            const value = cleanYamlScalar(match.groups.value ?? "");
            if (match[1] === "when_to_use") {
                if (value) metadata.whenToUse = value;
                else currentListKey = "when_to_use";
                continue;
            }
            metadata[match[1] as "name" | "description"] = value;
        }
        if (!metadata.whenToUse && whenToUseItems.length > 0) metadata.whenToUse = whenToUseItems.join("；");
        return metadata;
    }
}

function cleanYamlScalar(value: string): string {
    return value.replace(/^['"]|['"]$/g, "").trim();
}
