/**
 * Workbench 上下文键的唯一登记表。
 *
 * View 可见性（descriptors.ts）与命令 `when` 求值共用这一份登记：键名、缺失口径与
 * 未登记键的失败方式只有一份，否则「同一个键在视图里可见、在命令里不可用」会变成两套说法。
 * 本文件是纯逻辑：不 import Vue、不读 window——谁持有事实谁填值。
 */

/** 键 → 缺失时展示的原因。表的键集合就是 `ContextKey`，加键忘了语义说明会直接编译失败。 */
const CONTEXT_KEY_REASONS = {
    project: "需要打开 Project",
    selection: "需要先选中一个条目",
    "user-assets": "只在用户资产工作区可见",
    desktop: "需要桌面外壳（bridge）",
    "editor-focus": "需要编辑区焦点",
    "quick-open-visible": "需要打开命令面板",
    "agent-panel-open": "需要打开 Agent 面板",
    "editor-active": "需要活动编辑器",
    "editor-writable": "当前编辑器不可写",
    "editor-line-navigation": "当前编辑器不支持行号跳转",
} satisfies Record<string, string>;

export type ContextKey = keyof typeof CONTEXT_KEY_REASONS;

/** 宿主注入的事实快照：缺失的已登记键按 false 求值，不必为没发生的事伪填。 */
export type ContextValues = Readonly<Partial<Record<ContextKey, boolean>>>;

/** 谓词只有一个形态：`requires` 是 all-of，空数组恒真（提案开放问题 2 取值 a）。 */
export type WhenPredicate = Readonly<{requires?: readonly ContextKey[]}>;

/** 注册期校验：只回答「键是否都登记过」，不求值。 */
export function validateWhen(when: WhenPredicate | undefined): {ok: true; value: void} | {ok: false; reason: string} {
    for (const key of (when?.requires ?? []) as readonly string[]) {
        if (!Object.hasOwn(CONTEXT_KEY_REASONS, key)) {
            return {ok: false, reason: `未登记的 when 取值：${key}`};
        }
    }
    return {ok: true, value: undefined};
}

/** 求值期：需要但缺失（或不为 true）的键各产生一条原因，`matches` 是 all-of 的结果。 */
export function evaluateContextWhen(
    when: WhenPredicate | undefined,
    values: ContextValues,
): {ok: true; value: {matches: boolean; reasons: string[]}} | {ok: false; reason: string} {
    const validation = validateWhen(when);
    if (!validation.ok) {
        return validation;
    }
    const reasons: string[] = [];
    for (const key of when?.requires ?? []) {
        if (values[key] !== true) {
            reasons.push(CONTEXT_KEY_REASONS[key]);
        }
    }
    return {ok: true, value: {matches: reasons.length === 0, reasons}};
}
