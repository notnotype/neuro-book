import {
    inject,
    onBeforeUnmount,
    provide,
    shallowRef,
    type InjectionKey,
    type ShallowRef,
} from "vue";

export type WorkbenchProjectItem = Readonly<{
    projectRoot: string;
    title: string;
}>;

export type WorkbenchChromeRegistration = Readonly<{
    title: () => string;
    appearance: () => "light" | "dark";
    surfaceActive: () => boolean;
    currentProjectRoot: () => string | null;
    projects: () => readonly WorkbenchProjectItem[];
    agentPanelOpen: () => boolean;
    openBookshelf: () => void | Promise<void>;
    switchProject: (projectRoot: string) => void | Promise<void>;
    toggleAgentPanel: () => void | Promise<void>;
}>;

export type WorkbenchChromeRegistry = Readonly<{
    current: ShallowRef<WorkbenchChromeRegistration | null>;
    register: (registration: WorkbenchChromeRegistration) => () => void;
}>;

const WORKBENCH_CHROME_KEY: InjectionKey<WorkbenchChromeRegistry> = Symbol("nbook.workbench-chrome");

/** 建立只属于当前 Nuxt app 实例的页面 Chrome 注册表。 */
export function createWorkbenchChromeRegistry(): WorkbenchChromeRegistry {
    const current = shallowRef<WorkbenchChromeRegistration | null>(null);
    return {
        current,
        register(registration) {
            current.value = registration;
            return () => {
                if (current.value === registration) current.value = null;
            };
        },
    };
}

/** 在 app 根提供 Workbench Chrome；避免 SSR 请求共享模块级状态。 */
export function provideWorkbenchChrome(): WorkbenchChromeRegistry {
    const registry = createWorkbenchChromeRegistry();
    provide(WORKBENCH_CHROME_KEY, registry);
    return registry;
}

/** 读取当前 app 的 Workbench Chrome。 */
export function useWorkbenchChrome(): WorkbenchChromeRegistry {
    const registry = inject(WORKBENCH_CHROME_KEY);
    if (!registry) throw new Error("Workbench Chrome 尚未由 app 根提供。");
    return registry;
}

/** 页面注册自身的标题栏状态，并在页面销毁时只释放自己的 registration。 */
export function useWorkbenchChromeRegistration(
    registration: WorkbenchChromeRegistration,
): void {
    const release = useWorkbenchChrome().register(registration);
    onBeforeUnmount(release);
}
