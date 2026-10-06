/**
 * 上下文键：`when` 可以引用的具名状态（例如“有活动编辑器”）。
 *
 * 键由拥有该状态的一方登记，登记表随命令表一起创建；命令系统本身不认识任何领域键。
 * 本文件不碰 DOM 与运行时：谁持有事实谁填值。
 */

/** 键 → 不满足时给用户看的原因。 */
export type ContextKeyTable = Readonly<Record<string, string>>;

/** 填值方给出的事实快照：没给值的已登记键按 false 求值，不必为没发生的事伪填。 */
export type ContextValues = Readonly<Record<string, boolean | undefined>>;

/** 谓词只有一种形态：`requires` 是 all-of，空数组恒真。 */
export type WhenPredicate = Readonly<{requires?: readonly string[]}>;

export type WhenEvaluation = {ok: true; value: {matches: boolean; reasons: string[]}} | {ok: false; reason: string};

/** 登记期校验：只回答“键是否都登记过”，不求值。原型上的属性名不算登记。 */
export function validateWhen(keys: ContextKeyTable, when: WhenPredicate | undefined): {ok: true} | {ok: false; reason: string} {
    for (const key of when?.requires ?? []) {
        if (!Object.hasOwn(keys, key)) return {ok: false, reason: `未登记的 when 取值：${key}`};
    }
    return {ok: true};
}

/** 求值期：需要但不为 true 的键各产生一条原因，`matches` 是 all-of 的结果。 */
export function evaluateContextWhen(keys: ContextKeyTable, when: WhenPredicate | undefined, values: ContextValues): WhenEvaluation {
    const validation = validateWhen(keys, when);
    if (!validation.ok) return validation;
    const reasons: string[] = [];
    for (const key of when?.requires ?? []) {
        if (values[key] !== true) reasons.push(keys[key] as string);
    }
    return {ok: true, value: {matches: reasons.length === 0, reasons}};
}
