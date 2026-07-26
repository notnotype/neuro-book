import { defineConfig, presetUno, presetIcons } from "unocss";
import { icons as lucideIcons } from "@iconify-json/lucide";

export default defineConfig({
    presets: [
        presetUno(),
        presetIcons({
            collections: {
                lucide: () => lucideIcons,
            },
        }),
    ],
    safelist: Object.keys(lucideIcons.icons).map((iconName) => `i-lucide-${iconName}`),
});
