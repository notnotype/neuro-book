/**
 * Lab 的组件索引。清单不是手写的，是扫描组件文档得来的派生产物——
 * 组件规范要求文档与实现并列，Lab 规范要求不保留第二份组件清单。
 */
export type LabComponentEntry = {
    /** 组件名，取自文档文件名，与同目录的 .vue 同名 */
    name: string;
    /**
     * 人类可读名称，取自文档正文第一条 H1。
     *
     * 组件名是稳定的 canonical 身份（导航 id、场景键、偏好键都用它）；显示名只用来「找到并读懂」，
     * 两者相同是常态，此时界面上不重复第二遍。
     */
    displayName: string;
    /**
     * 部件别名（frontmatter `别名: ["活动栏", "Activity Bar"]`）：中文/英文的**部件叫法**，
     * 让「我知道它长什么样、不知道它叫什么」的人也能搜到真实组件。缺省为空数组。
     */
    aliases: string[];
    /** 所在目录，导航按此分组 */
    group: string;
    /**
     * 完整的目录分组路径（相对组件根，不含文件名）：导航按它建多级目录，
     * 例如 `["novel-ide", "settings", "sections", "model", "components"]`。
     * `group` 是它的「最近的、不叫 components 的那层」，用于右栏显示人类读的那一档。
     */
    groupPath: string[];
    /** frontmatter 的能力标签。空数组表示已确认无隐藏通道，与「尚未处理」不同 */
    tags: string[];
    /** 文档正文，已去掉 frontmatter */
    doc: string;
    /** 能不能在 Lab 里挂载 */
    mountable: boolean;
    /** 不能挂载的原因；能挂载时为空串 */
    blockedReason: string;
    /**
     * frontmatter `验证入口:`：这个零件不能独立挂载，只能在承载它的宿主集成场景里观察。
     * 值为宿主组件名（canonical 名），中栏据此给一个跳转入口；没声明时为 null。
     */
    verifyEntry: string | null;
    /**
     * 被其它条目的 `verifyEntry` 指向：它是某条宿主链的**集成入口**，Lab 里唯一能打开整链的地方。
     * 这是从条目之间的关系派生的事实，不是名单——谁被指向，谁就是入口。
     */
    integrationEntry: boolean;
    /** 需要预置状态快照才能验证 */
    needsSnapshot: boolean;
    /**
     * 组件的粗分类，决定导航里画什么图形。按名字派生而不是人工登记：
     * 分类只用来区分「这是什么」，不参与挂载判定，规则变了不会影响任何验收结论。
     */
    kind: LabComponentKind;
    /**
     * 组件在 Component Lab 画布中的视口形态：
     * - fill: 撑满视区（适用于全屏大视图、复杂工作区、主侧栏）
     * - tight: 紧凑自适应（适用于小部件、输入框、气泡、卡片、状态栏等，高度由内容自适应并在舞台居中）
     */
    displayMode: LabDisplayMode;
};

export type LabComponentKind = "view" | "dialog" | "section" | "field" | "list" | "panel" | "agent" | "editor" | "workbench" | "part";

export type LabDisplayMode = "tight" | "fill";

/**
 * 推导组件在 Component Lab 画布中的默认视口形态：
 * - fill: 满屏 / 复杂工作区 / 侧栏主视图，撑满工作区高度；
 * - tight: 局部小部件 / 输入框 / 气泡 / 卡片 / 工具条，默认尺寸精准包裹组件（height: auto），并在舞台居中。
 */
export function deriveDisplayMode(name: string, kind?: LabComponentKind): LabDisplayMode {
    if (
        name === "WorkbenchShellLayout" ||
        name === "EditorWorkbench" ||
        name === "AgentSidebarView" ||
        name === "AgentChatFlow" ||
        name === "ProjectPickerView" ||
        name === "CodeEditorView" ||
        name === "WorkbenchStatusBar" ||
        name === "DesktopTitleBar" ||
        name === "DesktopTitleBarChrome"
    ) {
        return "fill";
    }

    if (
        /(Input|Bar|Bubble|Item|Card|Prompt|Node|Controls|EmptyState|Loader|Banner|Tab|Actions)$/u.test(name) ||
        kind === "field" ||
        kind === "part"
    ) {
        return "tight";
    }

    if (/SettingsView$/u.test(name) || /Panel$/u.test(name)) {
        return "fill";
    }

    return "tight";
}

/** 从组件名推分类；先匹配更具体后缀，避免 `SettingsView` 被 `View` 之外的模式抢走。 */
function deriveKind(name: string): LabComponentKind {
    if (/(Dialog|Window)$/u.test(name)) {
        return "dialog";
    }
    if (/(SettingsView|View)$/u.test(name)) {
        return "view";
    }
    if (/Section$/u.test(name)) {
        return "section";
    }
    if (/(Fields?|Input|Select|Checkbox|Radio|Editor)$/u.test(name)) {
        return "field";
    }
    if (/(List|Table|Tree)$/u.test(name)) {
        return "list";
    }
    if (/(Panel|Rail|Aside|Bar|Tabs?)$/u.test(name)) {
        return "panel";
    }
    /*
     * 下面三条按**域**分，不按形状分：这三族的零件加起来占全部条目的一半，各自内部形状不同，
     * 靠名字逐个认太慢——先在导航里把它们从灰盒子里分出来，域内再按名字读。
     *
     * 位置必须在最后：`AgentSidebarView` 是 view、`EditorSettingsView` 是 view、
     * `WorkbenchContainerSection` 是 section，这些更具体的判断在前面已经命中。
     */
    if (/^Agent/u.test(name)) {
        return "agent";
    }
    if (/^Editor/u.test(name)) {
        return "editor";
    }
    if (/^Workbench/u.test(name)) {
        return "workbench";
    }
    return "part";
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;
const TAGS_PATTERN = /^[ \t]*标签[ \t]*:[ \t]*\[(.*)\][ \t]*$/mu;
const ALIASES_PATTERN = /^[ \t]*别名[ \t]*:[ \t]*\[(.*)\][ \t]*$/mu;
const VERIFY_ENTRY_PATTERN = /^[ \t]*验证入口[ \t]*:[ \t]*(.+?)[ \t]*$/mu;
const HEADING_PATTERN = /^#[ \t]+(.+?)[ \t]*$/mu;

const productDocs = import.meta.glob("../components/**/*.md", {query: "?raw", import: "default", eager: true}) as Record<string, string>;
const labDocs = import.meta.glob("./*.md", {query: "?raw", import: "default", eager: true}) as Record<string, string>;
const productModules = import.meta.glob("../components/**/*.vue");
const labModules = import.meta.glob("./*.vue");

function parseTags(raw: string): string[] {
    const frontmatter = FRONTMATTER_PATTERN.exec(raw)?.[1];
    if (frontmatter === undefined) {
        return [];
    }
    const inner = TAGS_PATTERN.exec(frontmatter)?.[1];
    if (inner === undefined) {
        return [];
    }
    return inner.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function stripFrontmatter(raw: string): string {
    return raw.replace(FRONTMATTER_PATTERN, "");
}

/** 文档第一条 H1 就是显示名；没有 H1 的文档回落组件名（不造名字）。 */
function parseDisplayName(body: string, fallback: string): string {
    const heading = HEADING_PATTERN.exec(body)?.[1]?.trim();
    return heading !== undefined && heading !== "" ? heading : fallback;
}

/**
 * frontmatter `别名: ["活动栏", "Activity Bar"]`：JSON 字符串数组。
 *
 * 写坏时给开发期诊断并按「没有别名」继续——别名只影响能不能搜到，不该让整个 Lab 打不开；
 * 但也不能静默，静默会让「明明写了却搜不到」变成一次无证据的排查。
 */
function parseAliases(raw: string, name: string): string[] {
    const frontmatter = FRONTMATTER_PATTERN.exec(raw)?.[1];
    if (frontmatter === undefined) {
        return [];
    }
    const inner = ALIASES_PATTERN.exec(frontmatter)?.[1];
    if (inner === undefined) {
        return [];
    }
    try {
        const parsed = JSON.parse(`[${inner}]`) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error("别名必须是 JSON 数组");
        }
        return parsed
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item !== "");
    } catch (error) {
        console.warn(`[component-lab] ${name} 的「别名」不是合法 JSON 字符串数组：${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * frontmatter `验证入口: WorkbenchShellLayout`：该零件不能独立挂载，只能在承载它的宿主集成场景里观察。
 *
 * 这是给「props 全来自 provide/inject 或 Grid 叶」的零件准备的（`state:inject` / `env:portal`）：
 * 标签本身不阻断挂载，但脱离宿主链没有可验证状态，硬造一层假宿主只会验成另一个东西。
 * 值是宿主组件的 canonical 名；写坏时给开发期诊断并按「没有入口」继续，只影响提示与跳转。
 */
function parseVerifyEntry(raw: string, name: string): string | null {
    const frontmatter = FRONTMATTER_PATTERN.exec(raw)?.[1];
    if (frontmatter === undefined) {
        return null;
    }
    const value = VERIFY_ENTRY_PATTERN.exec(frontmatter)?.[1]?.trim().replace(/^["']|["']$/gu, "") ?? "";
    if (value === "") {
        return null;
    }
    if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) {
        console.warn(`[component-lab] ${name} 的「验证入口」应当是宿主组件名，实际是：${value}`);
        return null;
    }
    return value;
}

/** 检索规范化：大小写、首尾空格与全角空格都不该影响「搜不搜得到」。 */
function normalizeQuery(value: string): string {
    return value.trim().toLowerCase().replace(/\u3000/gu, " ");
}

/** 搜组件名、显示名与别名；不搜正文（导航要的是「带我过去」，不是全文检索）。 */
export function matchesLabQuery(entry: LabComponentEntry, query: string): boolean {
    const needle = normalizeQuery(query);
    if (needle === "") {
        return true;
    }
    return [entry.name, entry.displayName, ...entry.aliases].some((candidate) => candidate.toLowerCase().includes(needle));
}

/**
 * 导航主文字：canonical 名在前，显示名不同时并列。
 * 树的行只有一个文字位（`GenericTreeNode` 没有副标题字段），两个名字这里同格呈现，
 * 显示名与组件名相同时不重复。
 */
export function labComponentLabel(entry: LabComponentEntry): string {
    return entry.displayName === entry.name ? entry.name : `${entry.name} · ${entry.displayName}`;
}

/**
 * 能不能挂由标签推导，不由人工逐个决定。
 * persist: 在 Lab 规范里落在两条规则的缝隙上——它没被列进「只能正式界面验证」，
 * 但 fixture 明确不许依赖浏览器持久化状态，因此这里按不可挂处理。
 */
function deriveMountability(tags: string[], verifyEntry: string | null): Pick<LabComponentEntry, "mountable" | "blockedReason" | "needsSnapshot"> {
    const blocking = tags.filter((tag) => tag.startsWith("io:") || tag === "state:shared-write");
    if (blocking.length > 0) {
        return {
            mountable: false,
            blockedReason: `会真的读写产品数据（${blocking.join("、")}），只能在正式界面验证`,
            needsSnapshot: false,
        };
    }
    const persisting = tags.filter((tag) => tag.startsWith("persist:"));
    if (persisting.length > 0) {
        return {
            mountable: false,
            blockedReason: `直接访问浏览器存储（${persisting.join("、")}），fixture 不允许依赖持久化状态`,
            needsSnapshot: false,
        };
    }
    if (verifyEntry !== null) {
        return {
            mountable: false,
            blockedReason: `需要宿主链上下文（${tags.filter((tag) => tag === "state:inject" || tag === "env:portal").join("、") || "宿主切片"}），在 ${verifyEntry} 的集成场景里观察`,
            needsSnapshot: false,
        };
    }
    return {
        mountable: true,
        blockedReason: "",
        needsSnapshot: tags.includes("state:shared-read"),
    };
}

function buildEntries(): LabComponentEntry[] {
    const entries: LabComponentEntry[] = [];
    /**
     * rootSegments 是 glob 根在路径里的段数：`../components/**` 是 2 段（".." 与 "components"），
     * `./*.md` 是 1 段（"."）。它们不是分类，导航从它们下面一层开始。
     */
    const collect = (docs: Record<string, string>, modules: Record<string, unknown>, fallbackGroup: string, rootSegments: number): void => {
        for (const [path, raw] of Object.entries(docs)) {
            const name = path.slice(path.lastIndexOf("/") + 1, -".md".length);
            // 没有同名 .vue 的 .md 不是组件文档，跳过（例如目录里的 README）
            if (!(`${path.slice(0, -".md".length)}.vue` in modules)) {
                continue;
            }
            const segments = path.split("/");
            // 目录路径 = 去掉文件名与 glob 根之后的每一段。
            // "../components/novel-ide/settings/sections/providers/components/X.md" → novel-ide / settings / sections / model / components
            const groupPath = segments.slice(rootSegments, -1).filter((segment) => segment !== "" && segment !== ".");
            // 右栏显示的那一档跳过 components 桶：它是某个组件的私有子目录，不是分类。
            let groupIndex = groupPath.length - 1;
            if (groupPath[groupIndex] === "components" && groupIndex > 0) {
                groupIndex -= 1;
            }
            const group = groupIndex >= 0 ? groupPath[groupIndex]! : fallbackGroup;
            const tags = parseTags(raw);
            const doc = stripFrontmatter(raw);
            const verifyEntry = parseVerifyEntry(raw, name);
            entries.push({
                name,
                displayName: parseDisplayName(doc, name),
                aliases: parseAliases(raw, name),
                group: group === "." ? fallbackGroup : group,
                groupPath: groupPath.length > 0 ? groupPath : [fallbackGroup],
                tags,
                doc,
                kind: deriveKind(name),
                displayMode: deriveDisplayMode(name, deriveKind(name)),
                verifyEntry,
                // 指向关系要等所有条目收集完才知道，这里先给初值，下面统一覆盖。
                integrationEntry: false,
                ...deriveMountability(tags, verifyEntry),
            });
        }
    };
    collect(productDocs, productModules, "components", 2);
    collect(labDocs, labModules, "component-lab", 1);
    /**
     * 入口必须落在索引里，否则中栏那个跳转按钮点了没反应。
     * 指向不存在的组件时降级成「只在宿主场景里验证」：仍然不可独立挂载（这是文档说的事实），只是不给入口。
     */
    const known = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
        if (entry.verifyEntry !== null && !known.has(entry.verifyEntry)) {
            console.warn(`[component-lab] ${entry.name} 的「验证入口」指向不存在的组件：${entry.verifyEntry}`);
            entry.verifyEntry = null;
            entry.blockedReason = "需要宿主链上下文，只在宿主组件的集成场景里观察";
        }
    }
    /**
     * 集成入口：被别的条目当成「验证入口」的那个组件。它自己可能标签为空、耦合度为 0，
     * 特殊之处只在关系里——导航据此给它单独的图形，免得和普通零件混在一起。
     */
    const integrationNames = new Set(entries.map((entry) => entry.verifyEntry).filter((name): name is string => name !== null));
    for (const entry of entries) {
        entry.integrationEntry = integrationNames.has(entry.name);
    }
    // Lab 自己的组件在 ./ 下，groupPath 只剩根目录名；排序按完整路径读起来才是目录顺序
    return entries.sort((a, b) => a.groupPath.join("/").localeCompare(b.groupPath.join("/")) || a.name.localeCompare(b.name));
}

export const labComponents: LabComponentEntry[] = buildEntries();

export function findLabComponent(name: string): LabComponentEntry | null {
    return labComponents.find((entry) => entry.name === name) ?? null;
}
