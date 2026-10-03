import enUS from "nbook/app/i18n/locales/en-US";
import zhCN from "nbook/app/i18n/locales/zh-CN";

export default defineI18nConfig(() => ({
    legacy: false,
    locale: "zh-CN",
    fallbackLocale: "zh-CN",
    messages: {
        "zh-CN": zhCN,
        "en-US": enUS,
    },
}));
