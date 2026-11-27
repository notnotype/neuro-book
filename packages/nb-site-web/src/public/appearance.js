/*
 * 首帧的明暗（`src/host/theme.ts` 的文件头）：在 `<head>` 里同步跑，整页画出来之前读用户在“外观”里存下的选择，写到根元素上，
 * 选了暗色而系统是亮色（或反过来）的人打开任何一页都不先闪系统的底色。应用启动后由 `host/theme.ts` 接手。
 *
 * 不经构建：放在 Vite 的 public 目录里原样发出，不能导入站点的模块，键照抄 `host/storage.ts` 的 `APPEARANCE_KEY`
 * （`site.dom.test.ts` 用那个常量存值再跑本文件，两边不一致时那条失败）。内容安全策略只许自家脚本，所以是外部文件、不内联。
 * 只认 `light`、`dark`：跟随系统、没存过、存了别的值时什么都不写，交给 `index.html` 的 `color-scheme` 按系统明暗画。
 */
(function () {
    try {
        var stored = window.localStorage.getItem("nb-site.appearance");
        if (stored !== "light" && stored !== "dark") return;
        var root = document.documentElement;
        root.style.colorScheme = stored;
        root.dataset.nbAppearance = stored;
    } catch (error) {
        // 存储被禁用时取 `localStorage` 就抛。这里在应用之前跑，没有地方报告，也不该挡住页面：吞掉，按系统明暗画；
        // 应用启动后读同一项时会经 `host/storage.ts` 打警告。
    }
})();
