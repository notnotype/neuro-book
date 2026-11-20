/**
 * 包装组件把外露方法转给里面那个组件：`markdownKey` 交出的组件外面套了几层（插件的 `withHost`、`MarkdownHosted`），宿主在
 * 交出的组件上取模板引用调方法（对话视图的输入框调 PromptEditor 的 `focus`、`addFiles`），引用停在最外层就拿不到。
 *
 * 用法：setup 里 `const inner = forwardExpose(expose)`（`<script setup>` 里是 `defineExpose(exposeOf(inner))`），渲染里面的组件时
 * `ref: inner`。里面的组件是异步组件时，Vue 把引用
 * 交给它加载出的真实组件。里面的组件还没挂上时，取一般的成员是 undefined；列在 `deferred` 里的方法（没有返回值）先记下调用，
 * 挂上后按先后执行：调用方拿到包装就当编辑器已经在了（对话输入框的 `focus`），第一次打开时代码还在路上会直接报错。
 */

import {shallowRef, watch} from "vue";
import type {SetupContext, ShallowRef} from "vue";

type Exposed = Record<PropertyKey, unknown>;

/** 转给 `inner` 的外露对象：`<script setup>` 的组件交给 `defineExpose`。在组件的 setup 里调用（`deferred` 的队列随组件卸载丢掉）。 */
export function exposeOf(inner: ShallowRef<Exposed | null>, deferred: readonly string[] = []): Exposed {
    const queue: Array<(target: Exposed) => void> = [];
    if (deferred.length > 0) {
        watch(inner, (target) => {
            if (target !== null) for (const call of queue.splice(0)) call(target);
        });
    }
    return new Proxy({}, {
        get: (_target, key) => {
            if (inner.value !== null || typeof key !== "string" || !deferred.includes(key)) return inner.value?.[key];
            return (...args: unknown[]): void => {
                queue.push((target) => void (target[key] as (...values: unknown[]) => unknown)(...args));
            };
        },
        // Vue 取外露对象的成员前先用 `in` 判断：还没挂上时列在 `deferred` 里的也要算在。
        has: (_target, key) => (inner.value !== null ? key in inner.value : typeof key === "string" && deferred.includes(key)),
    });
}

export function forwardExpose(expose: SetupContext["expose"], deferred: readonly string[] = []): ShallowRef<Exposed | null> {
    const inner = shallowRef<Exposed | null>(null);
    expose(exposeOf(inner, deferred));
    return inner;
}

/** nb-markdown `PromptEditor` 外露的方法（都没有返回值），各层包装在它加载完之前先记下调用。 */
export const PROMPT_EDITOR_METHODS: readonly string[] = ["focus", "insertText", "insertFiles", "openTrigger"];
