/**
 * /lab 画布底的取值。
 *
 * 原来这里有七张 jpg（共 29MB，在 playground/public/wallpapers/），现在全部撤掉：
 * 它们只为一个开发页服务，却让每次 clone 都多背 29MB。剩下的几档全部由 CSS 生成，
 * 配方见 assets/css/lab.css 里的 .lab-canvas--*。
 *
 * 要用真实照片验玻璃的边缘折射，看 NeuroBook 那边 /lab 的做法：由使用者当场选一张，
 * 存在本机浏览器的 IndexedDB 里，不进仓库。这里没有跟着做，因为 playground 目前用不上。
 */
export interface LabWallpaper {
    id: string;
    label: string;
}

export const labWallpapers: LabWallpaper[] = [
    {id: "mesh", label: "极光渐变 (Mesh)"},
    {id: "grid", label: "网点"},
    {id: "wallpaper", label: "深蓝渐变"},
    {id: "solid", label: "实心面板底"},
];
