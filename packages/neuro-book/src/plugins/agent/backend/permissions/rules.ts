/**
 * 权限规则的形状与匹配（docs/specs/agent/permissions.md）。这里只有纯计算：一次调用怎样命中一条规则、一层的结果、三层怎样合并。
 *
 * 匹配是三值的：命中、不命中、算不出来。算不出来时规则偏向收紧：拒绝与询问算命中，放行不算，所以坏掉的匹配器不会让拒绝规则失效。
 */

import type {Rule, RuleAction} from "../../shared/permissions";

export interface PathSubject {
    readonly access: "read" | "write";
    /** 展开后的全局地址。 */
    readonly address: string;
}

/**
 * 规则看到的一次调用。一段命令拆成几条时每条一个视图：`argv` 是这一条，`paths` 是工具的路径加这一条的写重定向。
 */
export interface CallView {
    readonly tool: string;
    /** 工具给模型的名字：规则写 `shell` 也算。 */
    readonly toolName?: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly paths: readonly PathSubject[];
    /** 有写目标算不出地址（展开失败、重定向目标有变量）：路径匹配器没命中时算不出来。 */
    readonly unresolvedPaths: boolean;
    readonly others: ReadonlyArray<{readonly kind: string; readonly value: string}>;
    /** 取不到判定对象（提供方激活失败、`subjects` 抛错）：看对象的匹配器都算不出来。 */
    readonly subjectsAvailable: boolean;
    readonly argv: readonly string[] | null;
    /** 看不懂的命令的原文（没有方言的也是）。 */
    readonly opaqueText: string | null;
    /** 这一条是只读命令：合并时没命中也不拦别的条的放行（`cd a && touch b` 只要放行 `touch`）。 */
    readonly readOnly: boolean;
    /** 这一条有写重定向：只看命令的放行规则不放行它，要写路径规则（输出 15）。 */
    readonly redirectWrites: boolean;
}

type Tri = true | false | "unknown";

const not = (value: Tri): Tri => (value === "unknown" ? value : !value);
const all = (values: readonly Tri[]): Tri => (values.includes(false) ? false : values.includes("unknown") ? "unknown" : true);
const any = (values: readonly Tri[]): Tri => (values.includes(true) ? true : values.includes("unknown") ? "unknown" : false);

const escapeRegex = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
/** `*` 匹配任意字符：工具 id 与命令的词都没有路径分隔的意思。 */
const wildcard = (pattern: string): RegExp => new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "su");

export function matchesTool(pattern: string, view: Pick<CallView, "tool" | "toolName">): boolean {
    const regex = wildcard(pattern);
    return regex.test(view.tool) || (view.toolName !== undefined && regex.test(view.toolName));
}

/** 词对词比对，末尾的 `*` 表示后面可有可无（输出 11）。 */
export function matchesCommand(pattern: string, argv: readonly string[]): boolean {
    const words = pattern.trim().split(/\s+/u);
    const open = words.at(-1) === "*";
    const required = open ? words.slice(0, -1) : words;
    if (argv.length < required.length || (!open && argv.length !== required.length)) return false;
    return required.every((word, index) => wildcard(word).test(argv[index]!));
}

/** 看不懂的命令没有词可比，按文本包含比对：拒绝规则照样拦得住 `eval git push`。 */
function textContainsCommand(pattern: string, text: string): boolean {
    const words = pattern.trim().split(/\s+/u);
    const body = (words.at(-1) === "*" ? words.slice(0, -1) : words).join(" ");
    return new RegExp(body.split("*").map(escapeRegex).join(".*"), "su").test(text);
}

function valueAt(args: unknown, path: string): unknown {
    let at = args;
    for (const key of path.split(".")) {
        if (typeof at !== "object" || at === null) return undefined;
        at = (at as Record<string, unknown>)[key];
    }
    return at;
}

function matchesArg(matcher: {path?: unknown; op?: unknown; value?: unknown}, view: CallView): Tri {
    if (typeof matcher.path !== "string") return "unknown";
    const raw = valueAt(view.args, matcher.path);
    if (raw === undefined) return false;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const {value} = matcher;
    const values = typeof value === "string" ? [value] : Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;
    if (values === null) return "unknown";
    switch (matcher.op) {
        case "eq": return values.includes(text);
        case "glob": return values.some((item) => wildcard(item).test(text));
        case "contains": return values.some((item) => text.includes(item));
        case "keywords": return values.some((item) => text.toLowerCase().includes(item.toLowerCase()));
        case "regex":
            try {
                return values.some((item) => new RegExp(item, "u").test(text));
            } catch {
                return "unknown";
            }
        default: return "unknown";
    }
}

/** 规则的 `glob` 展开成全局地址才比对：`expand` 对不带方案的写法（`**\/.env`）原样交回。 */
export type GlobExpander = (glob: string) => string | null;

export function evaluate(matcher: unknown, view: CallView, expand: GlobExpander): Tri {
    if (typeof matcher !== "object" || matcher === null) return "unknown";
    const node = matcher as Record<string, unknown>;
    if (Array.isArray(node.all)) return all(node.all.map((item) => evaluate(item, view, expand)));
    if (Array.isArray(node.any)) return any(node.any.map((item) => evaluate(item, view, expand)));
    if ("not" in node) return not(evaluate(node.not, view, expand));
    switch (node.type) {
        case "arg":
            return matchesArg(node, view);
        case "path": {
            if (typeof node.glob !== "string") return "unknown";
            if (!view.subjectsAvailable) return "unknown";
            const glob = expand(node.glob);
            if (glob === null) return "unknown";
            const compiled = new Bun.Glob(glob);
            if (view.paths.some((path) => (node.access === undefined || node.access === path.access) && compiled.match(path.address))) return true;
            return view.unresolvedPaths ? "unknown" : false;
        }
        case "command": {
            if (typeof node.pattern !== "string") return "unknown";
            if (!view.subjectsAvailable) return "unknown";
            if (view.opaqueText !== null) return textContainsCommand(node.pattern, view.opaqueText);
            return view.argv !== null && view.argv.length > 0 && matchesCommand(node.pattern, view.argv);
        }
        case "subject": {
            if (typeof node.kind !== "string" || typeof node.glob !== "string") return "unknown";
            if (!view.subjectsAvailable) return "unknown";
            const regex = wildcard(node.glob);
            return view.others.some((subject) => subject.kind === node.kind && regex.test(subject.value));
        }
        default:
            return "unknown";
    }
}

/** 规则的条件要不要判定对象：要的话，提供方没激活时得先激活。 */
export function needsSubjects(matcher: unknown): boolean {
    if (typeof matcher !== "object" || matcher === null) return false;
    const node = matcher as Record<string, unknown>;
    if (Array.isArray(node.all)) return node.all.some(needsSubjects);
    if (Array.isArray(node.any)) return node.any.some(needsSubjects);
    if ("not" in node) return needsSubjects(node.not);
    return node.type !== "arg";
}

export interface RuleHit {
    readonly action: RuleAction;
    readonly reason?: string;
}

const mentionsPath = (matcher: unknown): boolean => {
    if (typeof matcher !== "object" || matcher === null) return false;
    const node = matcher as Record<string, unknown>;
    if (Array.isArray(node.all)) return node.all.some(mentionsPath);
    if (Array.isArray(node.any)) return node.any.some(mentionsPath);
    return node.type === "path";
};

/** 一条视图在一层里第一条命中的规则。看不懂的命令放行规则不生效（输出 14）；写重定向要路径规则才放行（输出 15）。 */
function firstHit(rules: readonly Rule[], view: CallView, expand: GlobExpander, report: (rule: Rule) => void): RuleHit | null {
    for (const rule of rules) {
        if (!matchesTool(rule.tool, view)) continue;
        const matched = rule.when === undefined ? true : evaluate(rule.when, view, expand);
        if (matched === "unknown") report(rule);
        if (matched === false || (matched === "unknown" && rule.action === "allow")) continue;
        if (rule.action === "allow" && (view.opaqueText !== null || (view.redirectWrites && !mentionsPath(rule.when)))) return null;
        return {action: rule.action, ...(rule.reason === undefined ? {} : {reason: rule.reason})};
    }
    return null;
}

/** 一层的结果：逐条命令按第一条命中算，再合并（输出 12）。只读的条没命中不算数。 */
export function layerResult(rules: readonly Rule[], views: readonly CallView[], expand: GlobExpander, report: (rule: Rule) => void): RuleHit | null {
    const hits = views.map((view) => ({view, hit: firstHit(rules, view, expand, report)}));
    const found = (action: RuleAction): RuleHit | undefined => hits.find(({hit}) => hit?.action === action)?.hit ?? undefined;
    const allowed = found("allow");
    return found("deny") ?? found("ask") ?? (allowed !== undefined && hits.every(({view, hit}) => hit?.action === "allow" || view.readOnly) ? allowed : null);
}

/** 三层合并（输出 2）：任一层拒绝；会话层放行；任一层询问；用户层放行。 */
export function mergeLayers(layers: {readonly user: RuleHit | null; readonly project: RuleHit | null; readonly session: RuleHit | null}): RuleHit | null {
    const {user, project, session} = layers;
    if (user?.action === "deny") return user;
    if (project?.action === "deny") return project;
    if (session?.action === "deny") return session;
    if (session?.action === "allow") return session;
    if (user?.action === "ask") return user;
    if (project?.action === "ask") return project;
    if (session?.action === "ask") return session;
    return user?.action === "allow" ? user : null;
}
