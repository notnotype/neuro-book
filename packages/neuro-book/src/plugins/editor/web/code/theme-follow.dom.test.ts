/**
 * Monaco 的主题跟着产品主题走（theme-follow.ts；docs/specs/workbench/editor.md 输出 65）：页面上几个编辑器实例共用一个观察器。
 * 这里只看“什么时候重新生成主题”；生成出来的颜色要真实的计算样式与画布，由 `e2e/editor-code-menu.e2e.ts` 在浏览器里验。
 */

import {describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {MonacoApi} from "./load-monaco";
import {followMonacoTheme} from "./theme-follow";

describe("workbench/editor 输出 65：几个使用方共用一个观察器", () => {
    it("第一个使用方到来时生成主题；主题变了、还有使用方时重新生成；都走了就停，多释放一次不多减；之后再来一个重新生成", async () => {
        let defined = 0;
        // Monaco 的主题接口里用到的只有这两个；生成主题的内容不在这条用例里看。
        const api = {editor: {defineTheme: () => void (defined += 1), setTheme: () => undefined}} as unknown as MonacoApi;
        const root = document.documentElement;
        /** 换一次主题属性，等观察器都收到（自己也挂一个观察器：它收到时，先登记的那个已经收到了）。 */
        let turn = 0;
        const retheme = async (): Promise<void> => {
            const seen = Promise.withResolvers<void>();
            const witness = new MutationObserver(() => seen.resolve());
            witness.observe(root, {attributes: true, attributeFilter: ["data-nb-theme"]});
            root.setAttribute("data-nb-theme", `theme-${String(++turn)}`);
            await seen.promise;
            witness.disconnect();
        };

        const first = followMonacoTheme(api);
        const second = followMonacoTheme(api);
        expect(defined).toBe(1);
        await retheme();
        await waitUntil("重新生成", () => defined === 2);

        // 一个走了（多释放一次）：另一个还在，主题变了照样重新生成。
        first();
        first();
        await retheme();
        await waitUntil("还在跟随", () => defined === 3);

        second();
        await retheme();
        expect(defined).toBe(3);

        const third = followMonacoTheme(api);
        expect(defined).toBe(4);
        third();
    });
});
