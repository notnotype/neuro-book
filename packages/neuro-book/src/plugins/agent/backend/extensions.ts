/**
 * `agent.extensions` 的接收者（docs/specs/agent/contributions.md 输出 1）：把平台的贡献句柄转给内核的插件宿主。
 *
 * 内核按对象相等认句柄与代次（同 id 的新一代不被旧一代的撤回误伤），所以同一个平台句柄总是交给内核同一个对象。
 * `implementation()` 每次转调平台句柄的，不缓存：平台在撤回后让它抛错，内核只在装配时取。
 */

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {AgentHost, ExtensionHandle} from "@notnotype/nb-harness/kernel/contracts";

import type {AgentExtensionDeclaration, AgentExtensionImplementation} from "../shared/points";

type PlatformHandle = ContributionHandle<AgentExtensionDeclaration, AgentExtensionImplementation>;

export function extensionReceiver(host: AgentHost, report: (message: string, cause: unknown) => void): ContributionReceiver<AgentExtensionDeclaration, AgentExtensionImplementation> {
    const handles = new WeakMap<PlatformHandle, ExtensionHandle>();
    const kernelHandle = (handle: PlatformHandle): ExtensionHandle => {
        let mapped = handles.get(handle);
        if (mapped === undefined) {
            mapped = {id: handle.id, plugin: handle.plugin, declaration: handle.declaration, implementation: () => handle.implementation()};
            handles.set(handle, mapped);
        }
        return mapped;
    };
    return {
        // 内核否决时抛 ExtensionRejected：平台按自己的合同回滚这一批。
        prepare: (handle) => host.extensions.prepare(kernelHandle(handle)),
        published: (handle) => host.extensions.published(kernelHandle(handle)),
        // 还没发布的也转：内核会删掉预占。内核目前不按原因分支，映射只为诊断。
        async revoke(handle, _prepared, reason) {
            try {
                await host.extensions.revoke(kernelHandle(handle), reason === "activation-failed" ? "activation-failed" : "deactivated");
            } catch (error) {
                // 不让平台的停止卡在 Agent 这一侧：写诊断，撤回照样完成。
                report(`revoking extension ${handle.id} failed`, error);
            }
        },
    };
}
