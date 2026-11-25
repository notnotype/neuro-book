/**
 * 装配：把插件贡献的扩展、Profile 的 `extensions` 与 Profile 自己排成顺序并检查（extensions.md 输出 1–4）。
 *
 * 装配序：插件的扩展按依赖拓扑排序、同一层按 id；之后是 Profile 的 `extensions`（同样排序），最后是 Profile 自己。
 * 反应写入、槽拼接、`mount` 按装配序；拦截链从外到里也是这个顺序。可选依赖装了就参与排序，没装不算缺失。
 *
 * 两类检查：会让会话跑不对的（id、重复、依赖缺失或成环）拒绝装配；写错了只是某个入口不生效的（设置缺缺省值、
 * 处理函数挂在不存在的事件上、槽名不合法、提醒没有触发条件）装配照常、交回诊断。TypeScript 作者这些在编译期就报了，
 * 装配期的检查给 JavaScript 作者与第三方插件。
 *
 * Profile 哈希：`hash(id, version, 装配序里每个扩展的 id、版本与所属插件)`。不对源码算哈希：内置与插件的扩展改了提示词或
 * 逻辑要升 `version`（Spec 写明），用户 Profile 的打包哈希由 t05 的加载器写进 `version`。
 */

import {createHash} from "node:crypto";
import {jsonProblem, kernelEventSpecs, type AnyExtension, type AnyProfile, type ContributedExtension, type DiagnosticCode, type ExtensionFields, type Scope} from "../api/index.js";
import type {Reducer} from "../state/snapshot.js";

/** 运行时看到的扩展：定义对象就是声明本身。 */
export type ExtensionDefinition = AnyExtension & Partial<ExtensionFields<string, any, any, any, any, any>>;

export interface Assembled {
    readonly definition: ExtensionDefinition;
    readonly plugin: string | null;
    readonly role: "plugin" | "profile-extension" | "profile";
    readonly version: string;
}

export interface AssemblyProblem {
    readonly code: "bad-extension-id" | "duplicate-extension-id" | "dependency-missing" | "referenced-extension-missing" | "dependency-cycle" | "event-name-reserved" | "slice-initial-not-json";
    readonly extension: string;
    /** `dependency-missing` 时缺的那个依赖；`referenced-extension-missing` 时引用的那个 id。 */
    readonly dependency?: string;
    readonly message: string;
    readonly hint: string;
}

/** 不挡装配的问题：会话照常打开，交成诊断。 */
export interface AssemblyWarning {
    readonly code: Extract<DiagnosticCode, "setting-missing-default" | "unknown-event-handler" | "bad-slot-name" | "reminder-without-trigger" | "slot-collision">;
    readonly extension: string;
    readonly message: string;
    readonly hint: string;
    readonly params: Readonly<Record<string, string>>;
}

export interface Assembly {
    readonly profile: AnyProfile;
    readonly order: readonly Assembled[];
    readonly reducers: readonly Reducer[];
    readonly hash: string;
    readonly manifest: readonly {id: string; version: string; plugin: string | null}[];
    readonly warnings: readonly AssemblyWarning[];
    /** 扩展事件的全名 → 拥有者声明的版本（更高版本的事件归约时跳过）。 */
    readonly eventVersions: ReadonlyMap<string, number>;
}

/** `reminder()` 给它返回的扩展打的标记：装配时查有没有触发条件。 */
export const REMINDER_TRIGGERS = Symbol.for("nb-harness.kernel.reminder-triggers");

const PROFILE_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/u;
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9_-]*)*$/u;

/** 插件贡献的扩展 id 合不合规则（extensions.md 的 id 规则）：点分的小写段，等于所属插件的 id 或以它加点开头。 */
export function contributedIdProblem(id: string, plugin: string): string | null {
    if (!EXTENSION_ID.test(id)) return `extension id ${id} must be dot-separated lowercase segments`;
    if (id !== plugin && !id.startsWith(`${plugin}.`)) return `extension ${id} is contributed by plugin ${plugin} but does not start with its id`;
    return null;
}
const SLOT_NAME = /^[a-z0-9][a-z0-9-]*$/u;

interface DependencyRef {
    readonly id: string;
    readonly optional: boolean;
    readonly events: Readonly<Record<string, unknown>>;
}

function dependenciesOf(definition: ExtensionDefinition): DependencyRef[] {
    return (definition.dependsOn ?? []).map((dependency: unknown) => {
        const wrapped = (dependency as {contract?: {id: string; events?: Record<string, unknown>}}).contract;
        const contract = wrapped ?? (dependency as {id: string; events?: Record<string, unknown>});
        return {id: contract.id, optional: wrapped !== undefined, events: contract.events ?? {}};
    });
}

/** 依赖在前、同一层按 id；成环时报问题。依赖不在这一组里的不参与排序（缺失另查）。 */
function topological(items: readonly Assembled[], problems: AssemblyProblem[]): Assembled[] {
    const inGroup = new Set(items.map((item) => item.definition.id));
    const placed = new Set<string>();
    const out: Assembled[] = [];
    let remaining = [...items].sort((a, b) => (a.definition.id < b.definition.id ? -1 : 1));
    while (remaining.length > 0) {
        const ready = remaining.filter((item) => dependenciesOf(item.definition).every((dependency) => placed.has(dependency.id) || !inGroup.has(dependency.id)));
        if (ready.length === 0) {
            for (const item of remaining) problems.push({code: "dependency-cycle", extension: item.definition.id, message: `extension ${item.definition.id} is part of a dependency cycle`, hint: "remove one of the dependsOn entries in the cycle"});
            return [...out, ...remaining];
        }
        for (const item of ready) placed.add(item.definition.id);
        out.push(...ready);
        remaining = remaining.filter((item) => !placed.has(item.definition.id));
    }
    return out;
}

function reducerOf(definition: ExtensionDefinition): Reducer {
    const slices: Record<string, {scope: Scope; initial: unknown; resetOnCompaction: boolean}> = {};
    for (const [name, slice] of Object.entries((definition.state ?? {}) as Record<string, {scope: Scope; initial: unknown; resetOnCompaction: boolean}>)) slices[name] = slice;
    return {id: definition.id, slices, reduce: (definition.reduce ?? {}) as Reducer["reduce"]};
}

/** 编辑距离最近的已知名字，给拼错的事件名做提示。 */
function closest(name: string, known: Iterable<string>): string | null {
    let best: string | null = null;
    let bestDistance = Math.max(3, Math.floor(name.length / 3)) + 1;
    for (const candidate of known) {
        const distance = levenshtein(name, candidate);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best;
}
function levenshtein(a: string, b: string): number {
    const row = Array.from({length: b.length + 1}, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0]!;
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const current = row[j]!;
            row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length]!;
}

function warningsOf(item: Assembled): AssemblyWarning[] {
    const definition = item.definition;
    const id = definition.id;
    const warnings: AssemblyWarning[] = [];
    const properties = (definition.settings as {properties?: Record<string, {default?: unknown}>} | undefined)?.properties ?? {};
    for (const [key, schema] of Object.entries(properties)) {
        if (schema.default === undefined) warnings.push({code: "setting-missing-default", extension: id, params: {key}, message: `setting ${key} of ${id} has no default`, hint: `add a default to ${key} in the settings schema`});
    }
    const own = Object.keys(definition.events ?? {});
    const known = new Set<string>([...Object.keys(kernelEventSpecs), ...own]);
    for (const dependency of dependenciesOf(definition)) for (const name of Object.keys(dependency.events)) known.add(`${dependency.id}/${name}`);
    const checkKeys = (entry: "on" | "reduce" | "render", keys: readonly string[], allowed: ReadonlySet<string>) => {
        for (const key of keys) {
            if (allowed.has(key)) continue;
            // 扩展的 render 挂在看得到、但不是自己的事件上：提示往 Profile 的 render 去，不再说“这不是它看得到的事件”。
            if (entry === "render" && known.has(key)) {
                warnings.push({code: "unknown-event-handler", extension: id, params: {entry, key}, message: `${id}.render can only render its own conv events; ${key} is not one of them`, hint: "override other events in the Profile's render, or declare a conv event of your own"});
                continue;
            }
            const guess = closest(key, allowed);
            warnings.push({code: "unknown-event-handler", extension: id, params: {entry, key}, message: `${id}.${entry} has a handler for ${key}, which is not an event it can see`, hint: guess === null ? "use a kernel event, one of its own events, or <dependency id>/<event> for an event of a dependency in dependsOn" : `did you mean ${guess}?`});
        }
    };
    checkKeys("on", Object.keys(definition.on ?? {}), known);
    checkKeys("reduce", Object.keys(definition.reduce ?? {}), known);
    // 扩展只能渲染自己的事件；Profile 能覆盖任何看得到的对话事件。
    checkKeys("render", Object.keys(definition.render ?? {}), item.role === "profile" ? known : new Set(own));
    for (const name of Object.keys(definition.contribute ?? {})) {
        if (!SLOT_NAME.test(name)) warnings.push({code: "bad-slot-name", extension: id, params: {slot: name}, message: `slot name ${name} of ${id} is not lowercase letters, digits and dashes`, hint: "rename the slot; * is only for <Slot name=\"*\"> in templates"});
    }
    const triggers = (definition as unknown as {[REMINDER_TRIGGERS]?: {every?: number; watch?: unknown}})[REMINDER_TRIGGERS];
    if (triggers !== undefined && triggers.every === undefined && triggers.watch === undefined) warnings.push({code: "reminder-without-trigger", extension: id, params: {}, message: `reminder ${id} has neither every nor watch, so it never fires`, hint: "give every: 1 for once per turn, or watch for a value that changes"});
    return warnings;
}

/** 同一个槽有几个扩展交内容、且不是都写了 `shared: true`（harness/profile.md 输出 16）。 */
function slotCollisions(order: readonly Assembled[]): AssemblyWarning[] {
    const bySlot = new Map<string, {id: string; shared: boolean}[]>();
    for (const item of order) {
        for (const [name, contribution] of Object.entries(item.definition.contribute ?? {}) as [string, {shared?: boolean}][]) {
            bySlot.set(name, [...(bySlot.get(name) ?? []), {id: item.definition.id, shared: contribution.shared === true}]);
        }
    }
    const warnings: AssemblyWarning[] = [];
    for (const [slot, owners] of bySlot) {
        if (owners.length < 2 || owners.every((owner) => owner.shared)) continue;
        const ids = owners.map((owner) => owner.id);
        for (const owner of owners.filter((item) => !item.shared)) {
            warnings.push({code: "slot-collision", extension: owner.id, params: {slot, with: ids.filter((id) => id !== owner.id).join(", ")}, message: `slot ${slot} of ${owner.id} is also contributed by ${ids.filter((id) => id !== owner.id).join(", ")}`, hint: "rename the slot, or mark every contribution to it shared: true if it is meant to be shared"});
        }
    }
    return warnings;
}

/**
 * 这个 Profile 装哪些插件扩展（extensions.md 的“按需扩展”）：
 * 1. 自动扩展按 `pluginExtensions` 的标签排除，`"none"` 时一个都不装；
 * 2. 引用的 id 一律装上，与排除无关（引用是显式的），同一个 id 只装一次；
 * 3. 伴随只在同一插件内：按需扩展依赖同一插件已装上的另一个按需扩展、且自己的依赖都满足时跟着装上（迭代到不再增加）。
 * 别的插件的按需扩展不会伴随进来：那样会绕过 Profile 的 `"none"` 与排除。
 * `references: "ignore"` 给单次请求（`complete`）：它不装插件扩展，也不检查引用。
 */
function pluginExtensionsFor(profile: AnyProfile, contributed: readonly ContributedExtension[], problems: AssemblyProblem[], references: "check" | "ignore"): ContributedExtension[] {
    const exclude = profile.pluginExtensions;
    const tagsOf = (item: ContributedExtension): readonly string[] => (item.extension as ExtensionDefinition).tags ?? [];
    const idOf = (item: ContributedExtension): string => (item.extension as ExtensionDefinition).id;
    const automatic = exclude === "none" ? [] : contributed.filter((item) => item.onRequest !== true && !(exclude?.exclude ?? []).some((tag) => tagsOf(item).includes(tag)));
    // 按对象记：同 id 的两份贡献照样都进来，由下面的重名检查报出，不在这里悄悄去掉一份。
    const chosen = new Set<ContributedExtension>(automatic);
    const chosenId = (id: string): ContributedExtension | undefined => [...chosen].find((item) => idOf(item) === id);
    if (references === "ignore") return contributed.filter((item) => chosen.has(item));
    const referenced: unknown = profile.referencedExtensions ?? [];
    // 类型挡得住，这里给 JavaScript 作者与用户级 Profile 再查一次：写成字符串时不按字符逐个当成 id。
    if (!Array.isArray(referenced) || !referenced.every((id) => typeof id === "string")) {
        problems.push({code: "bad-extension-id", extension: profile.id, message: `referencedExtensions of profile ${profile.id} must be an array of extension ids`, hint: "write referencedExtensions: [\"<plugin id>.<name>\"]"});
        return contributed.filter((item) => chosen.has(item));
    }
    for (const id of referenced as readonly string[]) {
        const found = contributed.find((item) => idOf(item) === id);
        if (found === undefined) problems.push({code: "referenced-extension-missing", extension: profile.id, dependency: id, message: `profile ${profile.id} references extension ${id}, which is not contributed`, hint: `install the plugin that contributes ${id}, or remove it from referencedExtensions`});
        else chosen.add(found);
    }
    const companions = contributed.filter((item) => item.onRequest === true && item.plugin !== null);
    // 伴随项其余的硬依赖可以由 Profile 自带的扩展满足：与后面装配校验看的是同一个集合。
    const own = new Set((profile.extensions ?? []).filter((extension) => typeof extension !== "string").map((extension) => (extension as ExtensionDefinition).id));
    for (let added = true; added;) {
        added = false;
        for (const item of companions) {
            if (chosen.has(item)) continue;
            const dependencies = dependenciesOf(item.extension as ExtensionDefinition).filter((dependency) => !dependency.optional).map((dependency) => dependency.id);
            const follows = dependencies.some((id) => {
                const dependency = chosenId(id);
                return dependency?.onRequest === true && dependency.plugin === item.plugin;
            });
            if (follows && dependencies.every((id) => chosenId(id) !== undefined || own.has(id))) {
                chosen.add(item);
                added = true;
            }
        }
    }
    // 保持贡献的原顺序：装配序与哈希不因引用的写法先后而变。
    return contributed.filter((item) => chosen.has(item));
}

export function assemble(profile: AnyProfile, contributed: readonly ContributedExtension[], options: {readonly references?: "check" | "ignore"} = {}): {ok: true; assembly: Assembly} | {ok: false; problems: AssemblyProblem[]} {
    const problems: AssemblyProblem[] = [];
    const plugins = pluginExtensionsFor(profile, contributed, problems, options.references ?? "check");
    const asAssembled = (definition: ExtensionDefinition, plugin: string | null, role: Assembled["role"]): Assembled => ({definition, plugin, role, version: definition.version ?? "0"});
    const pluginItems = plugins.map(({extension, plugin}) => asAssembled(extension as ExtensionDefinition, plugin, "plugin"));
    // 照声明的写法把 id 写进了 `extensions`（那里要扩展对象）：给出说得清的问题，不让它变成 id 为 undefined 的扩展。
    const misplaced = (profile.extensions ?? []).filter((extension) => typeof extension === "string") as unknown as string[];
    for (const id of misplaced) problems.push({code: "bad-extension-id", extension: profile.id, message: `extensions of profile ${profile.id} contains the string ${id}; it takes extension objects`, hint: "to reference a contributed extension by id, list it in referencedExtensions"});
    const ownItems = (profile.extensions ?? []).filter((extension) => typeof extension !== "string").map((extension) => asAssembled(extension as ExtensionDefinition, null, "profile-extension"));
    const profileItem = asAssembled(profile as unknown as ExtensionDefinition, null, "profile");

    if (!PROFILE_ID.test(profile.id)) problems.push({code: "bad-extension-id", extension: profile.id, message: `profile id ${profile.id} must be <source>.<name>`, hint: "use builtin.<name>, user.<name> or <plugin>.<name>"});
    for (const item of [...pluginItems, ...ownItems]) {
        const id = item.definition.id;
        if (!EXTENSION_ID.test(id)) problems.push({code: "bad-extension-id", extension: id, message: `extension id ${id} must be dot-separated lowercase segments`, hint: "use <plugin id> or <plugin id>.<name>"});
        else if (item.plugin !== null && id !== item.plugin && !id.startsWith(`${item.plugin}.`)) problems.push({code: "bad-extension-id", extension: id, message: `extension ${id} is contributed by plugin ${item.plugin} but does not start with its id`, hint: `rename it to ${item.plugin} or ${item.plugin}.<name>`});
    }
    // 类型挡得住这两类写错，这里给 JavaScript 作者与绕过了类型的第三方插件再查一次（extensions.md 输出 1）。
    for (const item of [...pluginItems, ...ownItems, profileItem]) {
        const id = item.definition.id;
        for (const name of Object.keys(item.definition.events ?? {})) {
            if (Object.hasOwn(kernelEventSpecs, name)) problems.push({code: "event-name-reserved", extension: id, message: `event ${name} of ${id} has the name of a kernel event`, hint: `rename it; kernel event names are ${Object.keys(kernelEventSpecs).join(", ")}`});
        }
        for (const [name, declared] of Object.entries((item.definition.state ?? {}) as Record<string, {initial?: unknown}>)) {
            const problem = jsonProblem(declared.initial);
            if (problem !== null) problems.push({code: "slice-initial-not-json", extension: id, message: `the initial value of slice ${name} of ${id} is not JSON (${problem})`, hint: "use arrays and plain objects instead of Map, Set or Date; store dates as numbers"});
        }
    }
    const seen = new Map<string, Assembled>();
    for (const item of [...pluginItems, ...ownItems, profileItem]) {
        const previous = seen.get(item.definition.id);
        if (previous !== undefined) problems.push({code: "duplicate-extension-id", extension: item.definition.id, message: previous.definition === item.definition ? `extension ${item.definition.id} is installed twice` : `extension id ${item.definition.id} is used twice`, hint: "each extension and profile id must be unique in a session"});
        seen.set(item.definition.id, item);
    }
    for (const item of [...pluginItems, ...ownItems, profileItem]) {
        for (const dependency of dependenciesOf(item.definition)) {
            if (!dependency.optional && !seen.has(dependency.id)) problems.push({code: "dependency-missing", extension: item.definition.id, dependency: dependency.id, message: `extension ${item.definition.id} depends on ${dependency.id}, which is not installed`, hint: `install ${dependency.id}, or wrap it in optional() if ${item.definition.id} can work without it`});
        }
    }
    const order = [...topological(pluginItems, problems), ...topological(ownItems, problems), profileItem];
    if (problems.length > 0) return {ok: false, problems};
    const manifest = order.map((item) => ({id: item.definition.id, version: item.version, plugin: item.plugin}));
    const hash = createHash("sha256").update(JSON.stringify([profile.id, profile.version, manifest])).digest("hex");
    const eventVersions = new Map<string, number>();
    for (const item of order) for (const [name, spec] of Object.entries((item.definition.events ?? {}) as Record<string, {version: number}>)) eventVersions.set(`${item.definition.id}/${name}`, spec.version);
    return {ok: true, assembly: {profile, order, reducers: order.map((item) => reducerOf(item.definition)), hash, manifest, warnings: [...order.flatMap(warningsOf), ...slotCollisions(order)], eventVersions}};
}
