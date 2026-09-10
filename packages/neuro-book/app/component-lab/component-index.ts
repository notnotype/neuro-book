/**
 * Lab 的组件索引。清单不是手写的，是扫描组件文档得来的派生产物——
 * 组件规范要求文档与实现并列，Lab 规范要求不保留第二份组件清单。
 */

export type LabComponentEntry = {
    /** 组件名，取自文档文件名，与同目录的 .vue 同名 */
    name: string;
    /** 所在目录，导航按此分组 */
    group: string;
    /** frontmatter 的能力标签。空数组表示已确认无隐藏通道，与「尚未处理」不同 */
    tags: string[];
    /** 文档正文，已去掉 frontmatter */
    doc: string;
    /** 能不能在 Lab 里挂载 */
    mountable: boolean;
    /** 不能挂载的原因；能挂载时为空串 */
    blockedReason: string;
    /** 需要预置状态快照才能验证 */
    needsSnapshot: boolean;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;
const TAGS_PATTERN = /^[ \t]*标签[ \t]*:[ \t]*\[(.*)\][ \t]*$/mu;

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

/**
 * 能不能挂由标签推导，不由人工逐个决定。
 * persist: 在 Lab 规范里落在两条规则的缝隙上——它没被列进「只能正式界面验证」，
 * 但 fixture 明确不许依赖浏览器持久化状态，因此这里按不可挂处理。
 */
function deriveMountability(tags: string[]): Pick<LabComponentEntry, "mountable" | "blockedReason" | "needsSnapshot"> {
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
    return {
        mountable: true,
        blockedReason: "",
        needsSnapshot: tags.includes("state:shared-read"),
    };
}

function buildEntries(): LabComponentEntry[] {
    const entries: LabComponentEntry[] = [];
    const collect = (docs: Record<string, string>, modules: Record<string, unknown>, fallbackGroup: string): void => {
        for (const [path, raw] of Object.entries(docs)) {
            const name = path.slice(path.lastIndexOf("/") + 1, -".md".length);
            // 没有同名 .vue 的 .md 不是组件文档，跳过（例如目录里的 README）
            if (!(`${path.slice(0, -".md".length)}.vue` in modules)) {
                continue;
            }
            const segments = path.split("/");
            // 分组用「最近的、不叫 components 的那层目录」：components/ 放的是某个区段私有的子组件，
            // 它们和那个区段归成一组，而不是汇成一堆叫 components 的条目。
            let groupIndex = segments.length - 2;
            if (segments[groupIndex] === "components" && groupIndex > 0) {
                groupIndex -= 1;
            }
            const group = groupIndex >= 0 ? segments[groupIndex]! : fallbackGroup;
            const tags = parseTags(raw);
            entries.push({
                name,
                group: group === "." ? fallbackGroup : group,
                tags,
                doc: stripFrontmatter(raw),
                ...deriveMountability(tags),
            });
        }
    };
    collect(productDocs, productModules, "components");
    collect(labDocs, labModules, "component-lab");
    return entries.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export const labComponents: LabComponentEntry[] = buildEntries();

export function findLabComponent(name: string): LabComponentEntry | null {
    return labComponents.find((entry) => entry.name === name) ?? null;
}
