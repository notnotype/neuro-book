/** 方案到提供者的登记表（docs/specs/harness/builtin-tools.md 输出 9）：每个方案一个提供者或按会话构造的工厂。 */

import type {ResourceAccess, ResourceProvider, SchemeContext, SchemeDefinition} from "./types";

const SCHEME = /^[a-z][a-z0-9+.-]*$/u;

export function createResourceAccess(definitions: Readonly<Record<string, SchemeDefinition>>): ResourceAccess {
    // 自己的键才算登记：按 `definitions[scheme]` 取会把 constructor、toString 这些继承属性当成方案
    const entries = Object.entries(definitions);
    const table = new Map(entries);
    for (const [scheme, definition] of entries) {
        if (!SCHEME.test(scheme)) throw new TypeError(`方案名不合规则（[a-z][a-z0-9+.-]*）：${scheme}`);
        if (definition.doc.trim() === "") throw new TypeError(`方案 ${scheme} 没有说明`);
    }
    // 工厂按会话各建一份，建好就复用：同一会话里 read 登记的快照与 edit 要对得上同一个根
    const built = new Map<string, Map<string, ResourceProvider>>();
    return {
        schemes: () => entries.map(([scheme, definition]) => ({scheme, doc: definition.doc})),
        open(scheme: string, context: SchemeContext) {
            const definition = table.get(scheme);
            if (definition === undefined) return undefined;
            if (typeof definition.provider !== "function") return definition.provider;
            let perSession = built.get(scheme);
            if (perSession === undefined) {
                perSession = new Map();
                built.set(scheme, perSession);
            }
            let provider = perSession.get(context.sessionId);
            if (provider === undefined) {
                provider = definition.provider(context);
                perSession.set(context.sessionId, provider);
            }
            return provider;
        },
    };
}
