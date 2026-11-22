/**
 * 模型选择器与 agent 标签用的选项（docs/specs/ui/agent-conversation-view.md 的模型选择器）：由模型服务的快照与选用数据的行算出。
 * 纯函数，`web/plugin.ts` 在快照或行换了的时候调用。
 */

import type {ComposerGroupView, ComposerIcon, ComposerModelView} from "@notnotype/nb-agent-ui";

import {builtinRoleNameKey, hasCredentials, modelsText, providerIconUrl, roleReference, splitReference} from "nbook/plugins/models/shared/contracts";
import type {ModelsSnapshot, SelectionRow, SnapshotProvider} from "nbook/plugins/models/shared/contracts";
import {roleIconClass} from "nbook/ui/role-icons";

import type {RoleOption} from "./session-host";

/**
 * 服务商图标的引用：用户选的内置图标与模板的图标只放键，图标表在渲染时由图标解析端口取（表晚到时首字母换成图标）；上传的是
 * 状态根里的文件，按读取路由的地址；选了首字母或没有图标可用时画首字母块。同模板的两个实例各用自己的图标。
 */
export function providerIconRef(provider: Pick<SnapshotProvider, "template" | "name" | "icon">): ComposerIcon {
    const icon = provider.icon;
    if (icon === null) return {kind: "key", set: "provider", key: provider.template, fallback: provider.name};
    if (icon.kind === "builtin") return {kind: "key", set: "provider", key: icon.key, fallback: provider.name};
    if (icon.kind === "file") return {kind: "url", src: providerIconUrl(icon.name), fallback: provider.name};
    return {kind: "initial", text: Array.from(provider.name.trim())[0]?.toUpperCase() ?? "?"};
}

export function modelGroups(snapshot: ModelsSnapshot): ComposerGroupView[] {
    return snapshot.providers.filter(hasCredentials).map((provider) => ({id: provider.id, name: provider.name, icon: providerIconRef(provider)}));
}

export function modelOptions(snapshot: ModelsSnapshot, rows: readonly SelectionRow[]): ComposerModelView[] {
    const names = new Map(snapshot.providers.map((provider) => [provider.id, provider.name] as const));
    return rows.map((row) => ({
        key: `${row.provider}/${row.id}`,
        label: row.name,
        supportsImages: row.vision,
        group: names.get(row.provider) ?? row.provider,
        groupId: row.provider,
        contextWindow: row.contextWindow,
        reasoning: row.reasoning,
        price: row.price === null ? null : {input: row.price[0], output: row.price[1]},
    }));
}

function roleNameOf(role: ModelsSnapshot["roles"][number]): RoleOption["name"] {
    const key = builtinRoleNameKey(role);
    return key === null ? (role.name === "" ? role.id : role.name) : modelsText(key);
}

export function roleOptions(snapshot: ModelsSnapshot, lookup: ReadonlyMap<string, {readonly name: string} | null>): RoleOption[] {
    const providers = new Map(snapshot.providers.map((provider) => [provider.id, provider] as const));
    return snapshot.roles.map((role) => {
        const bound = role.model === null ? null : splitReference(role.model);
        const provider = bound === null ? undefined : providers.get(bound.provider);
        return {
            key: roleReference(role.id),
            id: role.id,
            name: roleNameOf(role),
            axis: role.axis,
            modelLabel: role.model === null ? null : lookup.get(role.model)?.name ?? role.model,
            status: role.status,
            icon: {kind: "class", name: roleIconClass(role.id, role.icon)},
            ...(provider === undefined ? {} : {modelIcon: providerIconRef(provider)}),
            effort: role.effort,
        };
    });
}

