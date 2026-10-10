/**
 * 地址栏与 Lab 的会话状态双向同步（docs/specs/ui/component-lab.md 的输出“地址栏就是标签页的会话状态”）。
 *
 * 地址只经宿主的 router 改：直接调 History API 时 router 记录的当前路由与地址栏不一致，离开 `reloadOnLeave` 页面时
 * 会按旧地址整页加载。界面上切组件 `push` 一条历史，浏览器后退回到上一个组件；其余变化 `replace`。后退前进由 router
 * 的当前路由驱动 Lab 的状态。
 *
 * 两个方向不会互相触发：写地址前先算出规范地址，与当前路由相同就不写；路由变化时先算出它对应的会话，与当前状态相同
 * 就不改。
 */

import {watch} from "vue";
import type {Ref} from "vue";
import type {Router} from "vue-router";

import {queryFromSession, sessionFromQuery} from "./lab-url";
import type {LabSession, LabSessionCatalog} from "./lab-url";

export type LabSessionRefs = {
    readonly component: Ref<string>;
    readonly scene: Ref<string>;
    readonly canvasWidth: Ref<number>;
    readonly canvasHeight: Ref<number>;
    /** 下拉框的值是字符串。 */
    readonly zoom: Ref<string>;
    readonly tab: Ref<string>;
};

export function useLabSession(router: Router, refs: LabSessionRefs, catalog: LabSessionCatalog) {
    /** 进入 Lab 时地址里写的场景；组件没有这个场景而回落到首个场景时，界面据此给出提示。 */
    const requested = sessionFromQuery(router.currentRoute.value.query, catalog);
    const path = router.currentRoute.value.path;

    const current = (): LabSession => ({
        component: refs.component.value,
        scene: refs.scene.value,
        canvas: {width: refs.canvasWidth.value, height: refs.canvasHeight.value},
        zoom: Number(refs.zoom.value),
        tab: refs.tab.value,
    });

    function apply(session: LabSession): void {
        refs.component.value = session.component;
        refs.scene.value = session.scene;
        refs.canvasWidth.value = session.canvas.width;
        refs.canvasHeight.value = session.canvas.height;
        refs.zoom.value = String(session.zoom);
        refs.tab.value = session.tab;
    }

    apply(requested);

    /** 地址里的主题与配色：保留（undefined），或在界面上换过之后去掉（null）。 */
    let look: null | undefined = undefined;

    /** 第一次写地址只做规范化（去掉旧别名、补上回落的场景），不新增历史记录。 */
    let settled = false;
    /**
     * 自己写下、还没到达的地址，和最近一次写下的组件：router 的导航是异步的，连续切换时当前路由还停在更早的地址上，
     * 先写的地址到达时状态可能已经又变了，不能拿它回头改状态。
     */
    const inFlight = new Set<string>();
    let written: {readonly fullPath: string; readonly component: string} | null = null;

    function write(): void {
        const route = router.currentRoute.value;
        if (route.path !== path) return;
        const query = queryFromSession(current(), route.query, catalog, look);
        const fullPath = router.resolve({path, query}).fullPath;
        if (fullPath === (written?.fullPath ?? route.fullPath)) return;
        const component = written?.component ?? sessionFromQuery(route.query, catalog).component;
        const pushing = settled && component !== refs.component.value;
        settled = true;
        written = {fullPath, component: refs.component.value};
        inFlight.add(fullPath);
        void (pushing ? router.push({path, query}) : router.replace({path, query}));
    }

    // post：切组件时场景随后由 fixture 的 watch 换成首个场景，两处变化合成一次写入，不留下一条中间地址。
    const stopWrite = watch([refs.component, refs.scene, refs.canvasWidth, refs.canvasHeight, refs.zoom, refs.tab], write, {flush: "post"});
    const stopRead = watch(() => router.currentRoute.value, (route) => {
        if (route.path !== path) return;
        if (inFlight.delete(route.fullPath)) return;
        inFlight.clear();
        written = null;
        const next = sessionFromQuery(route.query, catalog);
        const now = current();
        // 地址里没写场景时 Lab 选了首个场景，这不是地址要求换场景。
        const sameScene = next.scene === "" || next.scene === now.scene;
        if (next.component === now.component && sameScene && next.canvas.width === now.canvas.width && next.canvas.height === now.canvas.height
            && next.zoom === now.zoom && next.tab === now.tab) return;
        apply(next);
    });

    /** 当前画面的规范地址，带上主题与配色：复制出去的链接打开就是同一个画面。 */
    function canonicalHref(look: {readonly themeId: string; readonly colorwayId: string}): string {
        const route = router.currentRoute.value;
        return new URL(router.resolve({path, query: queryFromSession(current(), route.query, catalog, look)}).href, window.location.origin).href;
    }

    return {
        requestedScene: requested.scene,
        /** 挂载后调一次：把进入时的地址规范化。 */
        start: write,
        /** 在界面上换了主题或配色：地址里的已过时，去掉。 */
        dropLook: (): void => {
            look = null;
            write();
        },
        canonicalHref,
        stop: (): void => {
            stopWrite();
            stopRead();
        },
    };
}
