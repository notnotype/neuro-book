/**
 * 上下文键与谓词求值。形态用提案开放问题 2 的默认值：**枚举数组**，不实现表达式 AST。
 * 可见性（when）与可执行性（requiredAuthority）是两件事，这里分开求值。
 *
 * `evaluateAuthority` 的规则表按 `ViewAuthority` 闭合：往联合类型加取值而不加判定会直接编译失败，
 * 不存在「声明了但不检查」的取值（旧实现只判 job，其余一律放行）。
 */
import {ref, type Ref} from "vue";
import type {ViewAuthority, ViewWhen} from "./descriptors";

export type SpikeContext = {
    project: Ref<boolean>;
    selection: Ref<boolean>;
    session: Ref<boolean>;
    files: Ref<boolean>;
    job: Ref<boolean>;
};

/** 上下文键的当前取值（传给诊断栏展示与切换，避免两处各写一份字段表）。 */
export type SpikeContextValues = {[K in keyof SpikeContext]: boolean};

export function createSpikeContext(): SpikeContext {
    return {project: ref(true), selection: ref(false), session: ref(false), files: ref(true), job: ref(false)};
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

/** 每种 authority 对应一个现场可观测的条件；多个为 allOf，第一个不满足的给出原因。 */
const AUTHORITY_CHECKS: Record<ViewAuthority, {available: (ctx: SpikeContext) => boolean; reason: string}> = {
    project: {available: (ctx) => ctx.project.value, reason: "需要打开项目"},
    session: {available: (ctx) => ctx.session.value, reason: "需要活动会话"},
    job: {available: (ctx) => ctx.job.value, reason: "需要任务 authority 可用"},
    files: {available: (ctx) => ctx.files.value, reason: "需要文件上下文"},
};

export function evaluateAuthority(list: ViewAuthority[] | undefined, ctx: SpikeContext): {actionable: boolean; reason?: string} {
    for (const authority of list ?? []) {
        const check = AUTHORITY_CHECKS[authority];
        if (!check.available(ctx)) {
            return {actionable: false, reason: check.reason};
        }
    }
    return {actionable: true};
}
