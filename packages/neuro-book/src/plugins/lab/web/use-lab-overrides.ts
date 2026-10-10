/**
 * 变量页签的覆盖层（docs/specs/ui/component-lab.md 的输出“变量 tab”）。
 *
 * - 覆盖写进一个独立的 `<style>`，挂在 `:root[data-nb-lab-active]` 上，`!important` 压过主题与配色写在文档根上的值；
 *   不改主题与配色的写入位置，换主题后覆盖仍然生效。
 * - 只在内存里：不写偏好、不写浏览器存储，刷新后消失。要留下来就导出成文件。
 * - Lab 页面卸载时移除 `<style>` 与标记属性，不留到别的页面（离开 Lab 本来也是整页加载）。
 */

import {computed, onBeforeUnmount, ref, watch} from "vue";

import {parseLabOverrideSnapshot, serializeLabOverrideSnapshot} from "./lab-overrides";

export const LAB_OVERRIDE_STYLE_ID = "nb-lab-variable-overrides";

export function useLabOverrides(allowedNames: () => ReadonlySet<string>) {
    const overrides = ref<Record<string, string>>({});
    const count = computed(() => Object.keys(overrides.value).length);

    function render(): void {
        let style = document.getElementById(LAB_OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
        if (style === null) {
            style = document.createElement("style");
            style.id = LAB_OVERRIDE_STYLE_ID;
            document.head.appendChild(style);
        }
        const declarations = Object.entries(overrides.value).map(([name, value]) => `    ${name}: ${value} !important;`).join("\n");
        style.textContent = declarations === "" ? "" : `:root[data-nb-lab-active], :root[data-nb-lab-active] body {\n${declarations}\n}`;
        document.documentElement.dataset.nbLabActive = "";
    }

    watch(overrides, render, {deep: true});

    onBeforeUnmount(() => {
        document.getElementById(LAB_OVERRIDE_STYLE_ID)?.remove();
        delete document.documentElement.dataset.nbLabActive;
    });

    return {
        overrides,
        count,
        /** 改一个变量；空串表示撤掉它的覆盖。值不合法时抛错，覆盖不变。 */
        set(name: string, value: string): void {
            if (!allowedNames().has(name)) throw new Error(`未登记的变量：${name}`);
            if (value.trim() === "") {
                const next = {...overrides.value};
                delete next[name];
                overrides.value = next;
                return;
            }
            const parsed = parseLabOverrideSnapshot(serializeLabOverrideSnapshot({[name]: value}), new Set([name]));
            overrides.value = {...overrides.value, ...parsed};
        },
        reset(name: string): void {
            const next = {...overrides.value};
            delete next[name];
            overrides.value = next;
        },
        resetAll(): void {
            overrides.value = {};
        },
        /** 整份替换；不合法时抛错，旧的覆盖不变。返回导入的项数。 */
        importSnapshot(raw: string): number {
            const next = parseLabOverrideSnapshot(raw, allowedNames());
            overrides.value = next;
            return Object.keys(next).length;
        },
        exportSnapshot: (): string => serializeLabOverrideSnapshot(overrides.value),
    };
}
