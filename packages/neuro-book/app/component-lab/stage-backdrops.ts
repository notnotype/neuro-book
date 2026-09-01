/**
 * 画布底：被测组件**背后**那层东西。
 *
 * 它不是装饰。半透明的组件（玻璃主题下的浮层、侧栏、工具条）只有背后有高频细节时才看得出
 * 折射与模糊；压在一片纯色上，模糊等于没开。所以这里给的几档是按「能不能验出问题」选的：
 * 棋盘格验透明度，网点与极光验模糊，纯黑纯白验对比度，主题底纹验它自己那张壁纸。
 *
 * 全部用 CSS 生成，不引入图片资源：这是产品包，往 public/ 里塞几兆的壁纸要单独算账。
 */
export type LabBackdrop = {
    id: string;
    label: string;
};

export const labBackdrops: LabBackdrop[] = [
    {id: "panel", label: "面板底"},
    {id: "page", label: "页面底"},
    {id: "theme", label: "主题底纹"},
    {id: "checker", label: "棋盘格"},
    {id: "grid", label: "网点"},
    {id: "mesh", label: "极光"},
    {id: "light", label: "纯白"},
    {id: "dark", label: "纯黑"},
];

export const LAB_DEFAULT_BACKDROP = "panel";

/** 画布缩放。倍率只影响呈现，组件拿到的仍是画布声明的那个尺寸。 */
export const labZooms = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const LAB_DEFAULT_ZOOM = 1;
