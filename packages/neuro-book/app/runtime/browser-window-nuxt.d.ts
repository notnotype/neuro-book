import type {BrowserWindowHost} from "./browser-window";

declare module "nuxt/app" {
    interface NuxtApp {
        $browserWindow: BrowserWindowHost;
    }
}

export {};
