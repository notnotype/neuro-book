/**
 * 上下文键：`when` 可以引用的具名布尔状态（例如“有活动编辑器”）。
 *
 * 命令表只经键来源问两件事：登记时这个键能不能用于 `when`，求值时它此刻是否为 true。产品命令表的来源是公开状态
 * （`nbook.state`，键是本运行位置声明的布尔公开键，见 docs/specs/workbench/commands.md 的“when 读公开状态”）；
 * Lab 命令场景与测试用本地键表（`contextTable`）。命令系统本身不认识任何领域键。本文件不碰 DOM 与运行时。
 */

/** 键 → 不满足时给用户看的原因。 */
export type ContextKeyTable = Readonly<Record<string, string>>;

/** 填值方给出的事实快照：没给值的已登记键按 false 求值，不必为没发生的事伪填。 */
export type ContextValues = Readonly<Record<string, boolean | undefined>>;

/** 谓词只有一种形态：`requires` 是 all-of，空数组恒真。 */
export type WhenPredicate = Readonly<{requires?: readonly string[]}>;

export type WhenEvaluation = {ok: true; value: {matches: boolean; reasons: string[]}} | {ok: false; reason: string};

export interface ContextKeySource {
    /** 登记期：键不能用于 `when` 的原因；能用为 null。 */
    problem(key: string): string | null;
    /** 求值期：键此刻是否为 true，不为 true 时给出原因。在响应式环境里求值时，读到的依赖随之收集。 */
    evaluate(key: string): {readonly matches: true} | {readonly matches: false; readonly reason: string};
}

/** 本地键表：只认表里的键（原型上的属性名不算）；值由 `values()` 给出，没给的按 false。 */
export function contextTable(keys: ContextKeyTable, values: () => ContextValues = () => ({})): ContextKeySource {
    return {
        problem: (key) => (Object.hasOwn(keys, key) ? null : `未登记的 when 取值：${key}`),
        evaluate: (key) => (values()[key] === true ? {matches: true} : {matches: false, reason: keys[key] as string}),
    };
}

/** 登记期校验：只回答“键是否都能用”，不求值。 */
export function validateWhen(keys: Pick<ContextKeySource, "problem">, when: WhenPredicate | undefined): {ok: true} | {ok: false; reason: string} {
    for (const key of when?.requires ?? []) {
        const problem = keys.problem(key);
        if (problem !== null) return {ok: false, reason: problem};
    }
    return {ok: true};
}

/** 求值期：需要但不为 true 的键各产生一条原因，`matches` 是 all-of 的结果。 */
export function evaluateContextWhen(keys: ContextKeySource, when: WhenPredicate | undefined): WhenEvaluation {
    const validation = validateWhen(keys, when);
    if (!validation.ok) return validation;
    const reasons: string[] = [];
    for (const key of when?.requires ?? []) {
        const evaluation = keys.evaluate(key);
        if (!evaluation.matches) reasons.push(evaluation.reason);
    }
    return {ok: true, value: {matches: reasons.length === 0, reasons}};
}
