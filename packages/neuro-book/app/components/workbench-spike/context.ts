/**
 * 上下文键与谓词求值。形态用提案开放问题 2 的默认值：**枚举数组**，不实现表达式 AST。
 * 可见性（when）与可执行性（requiredAuthority）是两件事，这里分开求值。
 */
import {ref, type Ref} from "vue";
import type {ViewAuthority, ViewWhen} from "./descriptors";

export type SpikeContext = {
    project: Ref<boolean>;
    selection: Ref<boolean>;
    job: Ref<boolean>;
};

export function createSpikeContext(): SpikeContext {
    return {project: ref(true), selection: ref(false), job: ref(false)};
}

const REQUIREMENT_LABELS: Record<string, string> = {
    project: "需要打开项目",
    selection: "需要先选中一个条目",
};

export function evaluateWhen(when: ViewWhen | undefined, ctx: SpikeContext): {visible: boolean; reason?: string} {
    for (const requirement of when?.requires ?? []) {
        if (!ctx[requirement].value) {
            return {visible: false, reason: REQUIREMENT_LABELS[requirement] ?? requirement};
        }
    }
    return {visible: true};
}

export function evaluateAuthority(list: ViewAuthority[] | undefined, ctx: SpikeContext): {actionable: boolean; reason?: string} {
    for (const authority of list ?? []) {
        if (authority === "job" && !ctx.job.value) {
            return {actionable: false, reason: "需要任务 authority 可用"};
        }
    }
    return {actionable: true};
}
