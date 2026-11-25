import "./app.css";
import {applyColorway} from "@notnotype/nb-ui/colorway";
import {installTheme} from "@notnotype/nb-ui/theme";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {createApp} from "vue";
import App from "./App.vue";

/**
 * 不经 Nuxt 装 nb-ui 的默认主题 nbook（主题模块带 vars.css）：在 `<html>` 上写主题与明暗，再套同一明暗的配色。
 * 明暗跟随系统，系统切换时跟着换。
 */
installTheme(nbookTheme);
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function applyAppearance(): void {
    const appearance = darkScheme.matches ? "dark" : "light";
    const root = document.documentElement;
    root.dataset.nbTheme = "nbook";
    root.dataset.nbAppearance = appearance;
    applyColorway(root, nbookTheme.colorways![appearance === "light" ? "nbook-light" : "nbook-dark"]!);
}

applyAppearance();
darkScheme.addEventListener("change", applyAppearance);
createApp(App).mount("#app");
