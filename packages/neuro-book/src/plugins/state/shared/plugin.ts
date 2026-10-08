/**
 * `nbook.state`：拥有贡献点 `state.public`，服务端、项目与浏览器三个位置各一个入口，代码相同，每个入口只读本实例
 * （docs/specs/state/public-state.md）。
 *
 * 绑定表放在 `@vue/reactivity` 的响应式集合里，`read` 无论走哪条路都先读它，再同步调用读取函数：绑定、撤回与拥有者
 * 状态的变化都会使读过它的 computed 重新求值，命令面板不用另订阅。绑定在贡献发布时（接收者的 `published`）才放进表：
 * commit 时贡献方的激活还可能失败撤回，读取函数也还取不到。未绑定键的声明从内核查已接受的贡献，内核目录不是响应式的：
 * 插件登记与撤销登记不会让已经求值的 computed 失效。
 */

import {shallowReactive} from "@vue/reactivity";
import {Value} from "typebox/value";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {ContributionDeclarations, ContributionDescriptor, ContributionHandle, ContributionReceiver, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";

import {descriptor} from "../plugin";
import {PUBLIC_STATE_POINT, publicStateKey} from "./contracts";
import type {PublicStateBinding, PublicStateDeclaration, PublicStateRead, PublicStateService} from "./contracts";

const NAME = /^[a-z][a-zA-Z0-9]{0,63}$/u;
const TYPES = ["boolean", "string", "number"] as const;
const FIELDS = new Set(["type", "unready", "reason"]);

/** 贡献点的校验（public-state 输出第 1 条）：限定名、类型、未就绪取值与原因。同名由内核的去重处理。 */
export function publicDeclarationProblem(contribution: ContributionDescriptor): string | null {
    const prefix = `${contribution.plugin}/`;
    if (!contribution.id.startsWith(prefix)) return `公开键 ${contribution.id} 必须写成 ${prefix}<名>`;
    const name = contribution.id.slice(prefix.length);
    if (!NAME.test(name)) return `公开键名 ${name} 不合规则：小写字母开头，其余为字母与数字，至多 64 个字符`;
    const declaration = contribution.declaration;
    if (typeof declaration !== "object" || declaration === null) return `公开键 ${contribution.id} 的声明必须是对象`;
    const fields = declaration as Record<string, unknown>;
    const extra = Object.keys(fields).filter((field) => !FIELDS.has(field));
    if (extra.length > 0) return `公开键 ${contribution.id} 的声明有未知字段：${extra.join("、")}`;
    const type = fields.type;
    if (!(TYPES as ReadonlyArray<unknown>).includes(type)) return `公开键 ${contribution.id} 的 type 必须是 boolean、string 或 number`;
    if (typeof fields.unready !== type || (type === "number" && !Number.isFinite(fields.unready))) return `公开键 ${contribution.id} 的 unready 必须是 ${String(type)}`;
    if (fields.reason !== undefined) {
        if (type !== "boolean") return `公开键 ${contribution.id} 不是布尔键，不能写 reason`;
        if (!Value.Check(LocalizedTextSchema, fields.reason)) return `公开键 ${contribution.id} 的 reason 必须是中英两份文本`;
    }
    return null;
}

type PublicHandle = ContributionHandle<PublicStateDeclaration, PublicStateBinding>;

function stateEntry(location: RuntimeLocation): PluginEntryDefinition {
    return {
        id: location,
        location,
        dependencies: [{key: diagnosticsKey}],
        provides: [publicStateKey],
        receives: [PUBLIC_STATE_POINT],
        activate: (context) => {
            const bindings = shallowReactive(new Map<string, PublicHandle>());
            const receiver: ContributionReceiver<PublicStateDeclaration, PublicStateBinding, null> = {
                published: (handle) => {
                    bindings.set(handle.id, handle);
                },
                revoke: (handle) => {
                    if (bindings.get(handle.id) === handle) bindings.delete(handle.id);
                },
            };
            const service = createService(location, bindings, context.declarations, context.services.require(diagnosticsKey));
            return {services: [provide(publicStateKey, service)], receivers: {[PUBLIC_STATE_POINT]: receiver}};
        },
    };
}

function createService(location: RuntimeLocation, bindings: ReadonlyMap<string, PublicHandle>, declarations: ContributionDeclarations, diagnostics: DiagnosticsService): PublicStateService {
    // 同一代绑定的同一种错误只记一次：computed 每次重新求值都会再读，不能每次都写诊断。
    const reported = new WeakMap<PublicHandle, Set<string>>();
    const report = (handle: PublicHandle, kind: string, message: string, error?: unknown): void => {
        const kinds = reported.get(handle) ?? new Set<string>();
        reported.set(handle, kinds);
        if (kinds.has(kind)) return;
        kinds.add(kind);
        diagnostics.record({level: "warn", event: `state.public.${kind}`, message, error, data: {key: handle.id}, source: {plugin: handle.plugin}});
    };
    const declarationOf = (key: string): PublicStateDeclaration | null => {
        const accepted = declarations.get<PublicStateDeclaration>(PUBLIC_STATE_POINT, key);
        // 只认本运行位置入口的声明：别处入口声明的键在本实例永远不会绑定（public-state 输出第 8 条）。
        return accepted === null || accepted.location !== location ? null : accepted.declaration;
    };
    return {
        read(key): PublicStateRead {
            const handle = bindings.get(key);
            const declaration = handle?.declaration ?? declarationOf(key);
            if (declaration === null) return {status: "undeclared"};
            const unready: PublicStateRead = {status: "unready", value: declaration.unready};
            // 拥有者入口开始停止时句柄先失效、撤回稍后才把它移出表：这段时间按未就绪，不再调用旧的读取函数。
            if (handle === undefined || !handle.published) return unready;
            const binding = handle.implementation();
            if (binding.kind === "unbound") return unready;
            let value: unknown;
            try {
                value = binding.read();
            } catch (error) {
                report(handle, "read-threw", `公开键 ${key} 的读取函数抛出异常，按未就绪处理`, error);
                return unready;
            }
            if (typeof value !== declaration.type || (typeof value === "number" && !Number.isFinite(value))) {
                report(handle, "read-mismatch", `公开键 ${key} 读到的值不是 ${declaration.type}，按未就绪处理`);
                return unready;
            }
            return {status: "ready", value: value as PublicStateDeclaration["unready"]};
        },
        declaration: (key) => bindings.get(key)?.declaration ?? declarationOf(key),
    };
}

export const statePlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [{id: PUBLIC_STATE_POINT, implementation: "required", validate: publicDeclarationProblem}],
    entries: [stateEntry("server"), stateEntry("project"), stateEntry("browser")],
};
