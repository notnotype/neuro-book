/**
 * `agent.compactionMethods` 的接收者（docs/specs/agent/compaction.md）。内置的三种方法也经这个贡献点交出（ADR 0027：没有内部登记表）。
 *
 * 内核按名字查方法表、每次都查，所以表是一个按当前发布的一代转发的代理：提供方撤回之后查到的就是新的一代，或者不可用。
 */

import type {ContributionDeclaration, ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {CompactionJob, CompactionMethodImpl, CompactionResult} from "@notnotype/nb-harness/kernel/contracts";

import {COMPACTION_METHODS_POINT, onAgentCompaction} from "../../shared/points";
import type {AgentCompactionMethodDeclaration} from "../../shared/points";

import {inplaceMethod} from "./inplace";
import {shakeMethod} from "./shake";
import {summaryMethod} from "./summary";

const SHAKE = "nbook.agent.shake";
const INPLACE = "nbook.agent.inplace";
const SUMMARY = "nbook.agent.summary";

/** 就地和摘要都可能失败（端点不支持禁止工具调用、对话模型不可用），末尾留一个摘要兜底。溢出时就地用不了。 */
export const DEFAULT_COMPACTION_ORDER = {onThreshold: [SHAKE, INPLACE, SUMMARY], onOverflow: [SHAKE, SUMMARY]} as const;

export const BUILTIN_COMPACTION_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentCompactionMethodDeclaration>> = [SHAKE, INPLACE, SUMMARY].map((id) => ({capability: COMPACTION_METHODS_POINT, id, declaration: {}}));

export const builtinCompactionMethods = (): Readonly<Record<string, CompactionMethodImpl>> => ({[SHAKE]: shakeMethod, [INPLACE]: inplaceMethod, [SUMMARY]: summaryMethod});

type Handle = ContributionHandle<AgentCompactionMethodDeclaration, CompactionMethodImpl>;

export class CompactionMethods {
    readonly #published = new Map<string, Handle>();
    /** 这一代上在途的调用：撤回时中止，算这个方法失败。 */
    readonly #running = new Map<Handle, Set<AbortController>>();

    constructor(private readonly options: {readonly declarations: ContributionDeclarations; readonly activate: (event: string) => Promise<boolean>}) {}

    readonly receiver: ContributionReceiver<AgentCompactionMethodDeclaration, CompactionMethodImpl> = {
        published: (handle) => {
            this.#published.set(handle.id, handle);
        },
        revoke: (handle) => {
            if (this.#published.get(handle.id) === handle) this.#published.delete(handle.id);
            for (const controller of this.#running.get(handle) ?? []) controller.abort();
            this.#running.delete(handle);
        },
    };

    /** 交给内核的方法表。没有声明的名字查不到，内核算失败。 */
    readonly table: Readonly<Record<string, CompactionMethodImpl>> = new Proxy({}, {
        get: (_target, name) => {
            if (typeof name !== "string") return undefined;
            const declared = this.options.declarations.list<AgentCompactionMethodDeclaration>(COMPACTION_METHODS_POINT).some((descriptor) => descriptor.id === name);
            return declared ? (job: CompactionJob) => this.#call(name, job) : undefined;
        },
    });

    async #call(id: string, job: CompactionJob): Promise<CompactionResult> {
        let handle = this.#published.get(id);
        if (handle === undefined) {
            const activated = await this.options.activate(onAgentCompaction(id));
            handle = activated ? this.#published.get(id) : undefined;
        }
        if (handle === undefined) return {failed: "method-unavailable"};
        // 等激活的时候运行可能已经被中止：不再启动第三方的实现。
        if (job.signal.aborted) return {failed: "aborted"};
        const controller = new AbortController();
        const running = this.#running.get(handle) ?? new Set();
        this.#running.set(handle, running);
        running.add(controller);
        // 撤回之后不等它，晚到的结果丢掉（compaction.md 输出 12）。
        const revoked = new Promise<CompactionResult>((resolve) => {
            controller.signal.addEventListener("abort", () => resolve({failed: "method-revoked"}), {once: true});
        });
        try {
            // 撤回之后旧实现可能不理会 signal 继续调 `job.model`：这一代结束后的调用不放行，免得迟到的模型请求记费、写事件。
            const model: CompactionJob["model"] = (request, options) => (controller.signal.aborted ? Promise.reject(new Error("method-revoked")) : job.model(request, options));
            return await Promise.race([handle.implementation()({...job, model, signal: AbortSignal.any([job.signal, controller.signal])}), revoked]);
        } finally {
            running.delete(controller);
        }
    }
}
