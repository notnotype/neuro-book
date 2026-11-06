import {computed, defineComponent, h, markRaw, shallowRef, watch} from "vue";
import type {Component, ShallowRef, VNode} from "vue";

import type {HomeProvider, HomeSource} from "./home-slot";

/**
 * 工作台的两个内置页面（docs/specs/ui/workbench-shell.md 输出 36–37）：`/` 与 `/workbench`。页面单根：窗口的状态、
 * 实例与链路标记由页面出口透传到这个根上；窗口绑定了项目时根上带项目短名（`data-workbench-project`，全页只此一处）。
 * 文档根的设置、页面浮层（输出 41）、命令宿主与通知视口两页都挂着；中间是外壳，或者（`/` 页、没有项目、有首页贡献时）首页
 * 贡献的组件。
 *
 * 首屏的两块（文档根的设置、页面主体）都是按需加载的组件，页面根先于它们挂上。所以页面自己加载这两块，等它们都挂上后
 * 才在根上标 `data-page-rendered`（src/web/PageOutlet.md 的页面合同）；主体换了（首页与外壳之间）就等新主体挂上再标。
 * 用 `onVnodeMounted` 认挂上：页面渲染的是加载好的组件本身，不是 `defineAsyncComponent` 的包装，钩子只在组件的子树进了
 * DOM 之后调用一次。
 *
 * 外壳的属性在渲染时才取（`shell.props()`），布局 store 在那里面才取：首页贡献在场时不读产品布局记录，直接打开 Lab 的
 * 窗口也一样。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。
 */

/** 首屏的一块：组件由页面加载，属性在每次渲染时取。 */
export interface WorkbenchPagePart {
    readonly load: () => Promise<Component>;
    readonly props: () => Record<string, unknown>;
}

export interface WorkbenchPageParts {
    /** 文档根的设置（界面语言、产品主题）：不渲染可见内容，但它挂上之前页面没有主题。 */
    readonly document: WorkbenchPagePart;
    readonly shell: WorkbenchPagePart;
    readonly renderCommandHost: () => VNode;
    /** 通知视口（docs/specs/workbench/notifications.md）：两页都挂，书架页与空工作台的通知落在同一处。 */
    readonly renderNotifications: () => VNode;
    /** 页面浮层（`workbench.overlays`）：首页与工作台页都挂，每个页面一份。 */
    readonly renderOverlays: () => VNode;
    readonly projectName: string | null;
    /** 首页贡献；只有 `/` 页在没有项目时用它。 */
    readonly home: HomeSource;
    /** 首页贡献加载失败时记诊断；页面退回外壳。 */
    readonly reportHome: (message: string) => void;
    /** 文档根的设置或外壳加载失败时记诊断；这一块不渲染，页面根不标 `data-page-rendered`，下次挂载页面时重新加载。 */
    readonly reportPart: (message: string) => void;
}

export interface WorkbenchPages {
    readonly home: Component;
    readonly workbench: Component;
}

/** 一块的加载状态，两个页面共用：加载好之后再挂载页面时同步渲染，不再空一帧。 */
interface LoadedPart {
    readonly component: Readonly<ShallowRef<Component | null>>;
    /** 还没加载、也不在加载中时开始加载；失败记诊断，留到下次调用再试。 */
    ensure(): void;
}

function loadedPart(name: string, part: WorkbenchPagePart, report: (message: string) => void): LoadedPart {
    const component = shallowRef<Component | null>(null);
    let pending: Promise<void> | null = null;
    const loaded = (value: Component): void => {
        component.value = markRaw(value);
    };
    return {
        component,
        ensure() {
            if (component.value !== null || pending !== null) return;
            pending = part.load().then(
                loaded,
                (error: unknown) => {
                    pending = null;
                    report(`${name}加载失败：${error instanceof Error ? error.message : String(error)}`);
                },
            );
        },
    };
}

export function createWorkbenchPages(parts: WorkbenchPageParts): WorkbenchPages {
    const frame = {document: loadedPart("文档根的设置", parts.document, parts.reportPart), shell: loadedPart("工作台外壳", parts.shell, parts.reportPart)};
    return {home: page("WorkbenchHomePage", parts, frame, true), workbench: page("WorkbenchPage", parts, frame, false)};
}

function page(name: string, parts: WorkbenchPageParts, frame: {readonly document: LoadedPart; readonly shell: LoadedPart}, useHome: boolean): Component {
    return defineComponent({
        name,
        setup() {
            const provider = computed<HomeProvider | null>(() => (useHome && parts.projectName === null ? parts.home.current.value : null));
            const loaded = shallowRef<{readonly provider: HomeProvider; readonly component: Component} | null>(null);
            const failed = shallowRef<HomeProvider | null>(null);
            // 提供者换了就重新加载；迟到的结果只在提供者没变时才用（撤回后不再渲染旧实现）。
            watch(provider, (current) => {
                loaded.value = null;
                failed.value = null;
                if (current === null) return;
                current.load().then(
                    (component) => {
                        if (provider.value === current) loaded.value = {provider: current, component};
                    },
                    (error: unknown) => {
                        if (provider.value !== current) return;
                        failed.value = current;
                        parts.reportHome(`首页 ${current.id} 加载失败，退回空工作台：${error instanceof Error ? error.message : String(error)}`);
                    },
                );
            }, {immediate: true});
            const homeShown = computed(() => provider.value !== null && failed.value !== provider.value);
            // 外壳只在要显示时才加载：首页贡献在场时不加载。
            frame.document.ensure();
            watch(homeShown, (shown) => {
                if (!shown) frame.shell.ensure();
            }, {immediate: true});
            // 已挂上的文档根设置与主体组件：主体是此刻该显示的那个时，页面才算画出。主体卸下时清掉，换回同一个组件时
            // 等它重新挂上。
            const documentMounted = shallowRef(false);
            const bodyMounted = shallowRef<Component | null>(null);
            return () => {
                const current = provider.value;
                const bodyComponent = homeShown.value
                    ? (loaded.value !== null && loaded.value.provider === current ? loaded.value.component : null)
                    : frame.shell.component.value;
                const documentComponent = frame.document.component.value;
                const body = bodyComponent === null ? null : h(bodyComponent, {
                    ...(homeShown.value ? {} : parts.shell.props()),
                    onVnodeMounted: () => {
                        bodyMounted.value = bodyComponent;
                    },
                    onVnodeUnmounted: () => {
                        const mounted: Component | null = bodyMounted.value;
                        if (mounted === bodyComponent) bodyMounted.value = null;
                    },
                });
                const documentNode = documentComponent === null ? null : h(documentComponent, {
                    ...parts.document.props(),
                    onVnodeMounted: () => {
                        documentMounted.value = true;
                    },
                });
                const rendered = documentMounted.value && bodyComponent !== null && bodyMounted.value === bodyComponent;
                return h("div", {
                    "class": "nb-workbench-page",
                    "data-workbench-root": "",
                    ...(parts.projectName === null ? {} : {"data-workbench-project": parts.projectName}),
                    ...(homeShown.value && current !== null ? {"data-workbench-home": current.id} : {}),
                    ...(rendered ? {"data-page-rendered": ""} : {}),
                }, [documentNode, body, parts.renderOverlays(), parts.renderCommandHost(), parts.renderNotifications()]);
            };
        },
    });
}
