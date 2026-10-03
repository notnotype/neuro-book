import type {Ref} from "vue";

const LOCALE_STORAGE_KEY = "nbook.locale";
const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

type SupportedLocale = typeof SUPPORTED_LOCALES[number];
type RuntimeI18nLocaleApi = {
    locale: Ref<string>;
    setLocale: (locale: SupportedLocale) => Promise<void>;
};

function isSupportedLocale(locale: string | null): locale is SupportedLocale {
    return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

export default defineNuxtPlugin({
    name: "i18n-locale",
    dependsOn: ["i18n:plugin"],
    async setup(nuxtApp) {
        const i18n = nuxtApp.$i18n as RuntimeI18nLocaleApi;

        const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (isSupportedLocale(storedLocale) && storedLocale !== i18n.locale.value) {
            await i18n.setLocale(storedLocale);
        }

        watch(i18n.locale, (nextLocale) => {
            if (isSupportedLocale(nextLocale)) {
                window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
            }
        }, {immediate: true});
    },
});
