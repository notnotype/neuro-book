import {existsSync, statSync} from "node:fs";
import {readFile, readdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {join, resolve} from "node:path";
import {Type} from "typebox";
import type * as TypeScript from "typescript";
import type {AgentWorkflowDefinition} from "@notnotype/nb-workflow";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";

// F9：typescript 包禁顶层 ESM import（Nitro dev rollup 会解析 9MB 包致 OOM），必须 require
const require = createRequire(import.meta.url);

export type WorkflowCatalogSource = "install" | "project";

/** workflow.ts 的导出形状。 */
export type WorkflowFileDef = AgentWorkflowDefinition & {
    title?: string;
    description?: string;
    whenToUse?: string;
    argsHint?: {name: string; label: string; defaultValue: string}[];
};

export type WorkflowCatalogItem = {
    key: string;
    title: string;
    description: string;
    whenToUse?: string;
    argsHint: {name: string; label: string; defaultValue: string}[];
    source: WorkflowCatalogSource;
    rootPath: string;
    entryPath: string;
    def: AgentWorkflowDefinition;
};

type CacheEntry = {mtimeMs: number; item: WorkflowCatalogItem};

/** Workflow catalog：Install Root → 当前 Project Root 的整体覆盖。 */
export class WorkflowCatalog {
    private readonly installRoot: string;
    private readonly configuredProjectRoot?: string;
    private readonly cache = new Map<string, CacheEntry>();
    private ts: typeof TypeScript | null = null;

    /** configuredProjectRoot 是 Project Workspace 根，不是 `.nbook/agent` 子根。 */
    constructor(installRoot: string, configuredProjectRoot?: string) {
        this.installRoot = resolve(installRoot);
        this.configuredProjectRoot = configuredProjectRoot ? resolve(configuredProjectRoot) : undefined;
    }

    async list(project?: ResolvedProjectWorkspace): Promise<WorkflowCatalogItem[]> {
        const items = new Map<string, WorkflowCatalogItem>();
        for (const item of await this.loadRoot(this.installRoot, "install")) items.set(item.key, item);
        const projectRoot = project?.root ?? this.configuredProjectRoot;
        if (projectRoot) {
            for (const item of await this.loadRoot(join(projectRoot, ".nbook", "agent", "workflows"), "project")) {
                items.set(item.key, item);
            }
        }
        return [...items.values()].sort((a, b) => a.key.localeCompare(b.key));
    }

    async get(workflowKey: string, project?: ResolvedProjectWorkspace): Promise<WorkflowCatalogItem | null> {
        return (await this.list(project)).find((item) => item.key === workflowKey) ?? null;
    }

    compileInline(source: string): AgentWorkflowDefinition {
        const def = this.evaluate(source, "inline.workflow.ts");
        return {...def, key: def.key || "inline"};
    }

    private async loadRoot(root: string, source: WorkflowCatalogSource): Promise<WorkflowCatalogItem[]> {
        if (!existsSync(root)) return [];
        const entries = await readdir(root, {withFileTypes: true});
        const items: WorkflowCatalogItem[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const rootPath = join(root, entry.name);
            const entryPath = join(rootPath, "workflow.ts");
            if (!existsSync(entryPath)) continue;
            try {
                items.push(await this.loadItem(entry.name, source, rootPath, entryPath));
            } catch (error) {
                console.warn(`[workflow-catalog] 加载 ${entryPath} 失败：${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return items;
    }

    private async loadItem(key: string, source: WorkflowCatalogSource, rootPath: string, entryPath: string): Promise<WorkflowCatalogItem> {
        const mtimeMs = statSync(entryPath).mtimeMs;
        const cached = source === "project" ? undefined : this.cache.get(entryPath);
        if (cached && cached.mtimeMs === mtimeMs) return cached.item;
        const def = this.evaluate(await readFile(entryPath, "utf8"), entryPath);
        const item: WorkflowCatalogItem = {
            key,
            title: def.title ?? key,
            description: def.description ?? "",
            whenToUse: def.whenToUse,
            argsHint: def.argsHint ?? [],
            source,
            rootPath,
            entryPath,
            def: {...def, key},
        };
        if (source !== "project") this.cache.set(entryPath, {mtimeMs, item});
        return item;
    }

    private evaluate(sourceText: string, fileName: string): WorkflowFileDef {
        if (!this.ts) this.ts = require("typescript") as typeof TypeScript;
        const js = this.ts.transpileModule(sourceText, {
            fileName,
            compilerOptions: {
                module: this.ts.ModuleKind.CommonJS,
                target: this.ts.ScriptTarget.ES2022,
            },
        }).outputText;
        const moduleShell = {exports: {} as {default?: WorkflowFileDef}};
        const restrictedRequire = () => {
            throw new Error("workflow 源码不允许 import/require：所有能力通过 wf API 提供");
        };
        // eslint-disable-next-line no-new-func -- workflow 源码求值边界
        const factory = new Function("exports", "module", "require", "Type", js);
        factory(moduleShell.exports, moduleShell, restrictedRequire, Type);
        const def = moduleShell.exports.default;
        if (!def || typeof def !== "object" || typeof def.run !== "function") {
            throw new Error(`${fileName} 必须 default export 一个含 run 函数的 workflow 定义对象`);
        }
        if (def.argsHint !== undefined) {
            if (!Array.isArray(def.argsHint) || def.argsHint.some((hint) => !hint
                || typeof hint !== "object"
                || typeof hint.name !== "string"
                || !hint.name.trim()
                || typeof hint.label !== "string"
                || typeof hint.defaultValue !== "string")) {
                throw new Error(`${fileName} 的 argsHint 必须是 {name,label,defaultValue:string}[]`);
            }
        }
        return def;
    }
}
