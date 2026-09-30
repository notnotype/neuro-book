declare module "*.vue" {
    import type {DefineComponent} from "vue";
    const component: DefineComponent;
    export default component;
}

// SDK 只在编译期提供类型；运行时由宿主注入同名模块。
declare module "@neurobook/plugin-sdk" {
    import type {ComputedRef, InjectionKey, Ref} from "vue";
    export const PLUGIN_HOST_CONTEXT: InjectionKey<{hostName: string}>;
    export function useHostI18n(): {t: (key: string) => string; locale: Ref<string>};
    export function useHostColorMode(): ComputedRef<string>;
}
