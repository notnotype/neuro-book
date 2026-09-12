import { defineConfig, presetUno, presetIcons } from "unocss";
import { icons as lucideIcons } from "@iconify-json/lucide";

export default defineConfig({
    presets: [
        presetUno(),
        presetIcons({
            // 显式声明图标集合：presetIcons() 的自动探测在本机取不到 @iconify-json/lucide，
            // 而它回退的 Iconify 网络 API 也不可达，结果是图标 CSS 一条都不生成、界面图标全部空白。
            collections: {
                lucide: () => lucideIcons,
            },
        }),
    ],
    safelist: Object.keys(lucideIcons.icons).map((iconName) => `i-lucide-${iconName}`),
});
