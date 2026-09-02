/**
 * Lab 里有**两层底**，它们是两件事，选项也是两套。这个文件是这两套的唯一登记处。
 *
 * 从下往上数，页面一共四层：
 *
 *   1. 桌面      —— 整页最底下那一层，三栏之间的缝、中栏的空白处看到的都是它。
 *                   顶栏的「桌面」选的就是这一层，取值见 labPageBackdrops。
 *   2. 栏        —— 三块浮板。左栏是玻璃（半透明，糊桌面），右栏按规范该是实心暖面、
 *                   眼下正在试也做成玻璃（见 LabShell 的 --lab-content-surface），
 *                   中栏**不给面**——它是一扇开向桌面的窗，所以中栏空白处看到的是第 1 层。
 *   3. 画布底    —— 被测组件**背后**那一层，只在画布盒子里面。中栏工具条的「画布底」选它，
 *                   取值见 labBackdrops。
 *   4. 组件自己的面 —— 组件自己画的，Lab 不管也管不着。
 *
 * 第 3 层与第 4 层容易看混：默认画布底是「面板底」，而仓库里大多数组件自己也画面板色，
 * 于是盒子里两层同色，看起来像一层。要看清组件自己的边界，把画布底换成「页面底」或「棋盘格」。
 *
 * 两层都用 CSS 生成，不引入图片资源：这是产品包，往 public/ 里塞几兆的壁纸每个终端用户都要下。
 * 唯一的例外是「自定义图片」，那一张由使用者当场选、只留在本机浏览器里，同样不进仓库。
 */
export type LabBackdrop = { id: string; label: string; };

/** 第 3 层：画布底，被测组件背后那一层。 */
export const labBackdrops: LabBackdrop[] = [
    {id: "panel", label: "面板底"},
    {id: "page", label: "页面底"},
    {id: "none", label: "透明"},
    {id: "theme", label: "主题底纹"},
    {id: "checker", label: "棋盘格"},
    {id: "grid", label: "网点"},
    {id: "mesh", label: "极光"},
    {id: "light", label: "纯白"},
    {id: "dark", label: "纯黑"},
];

export const LAB_DEFAULT_BACKDROP = "panel";

/**
 * 第 1 层：桌面。
 *
 * 这一套的用处与画布底不同：画布底是给**被测组件**当背景，桌面是用来看**Lab 自己**
 * 哪些面是透的。左栏是 26% 的玻璃、中栏根本没给面，压在纯色上完全看不出来；换成棋盘格
 * 或斜纹，透到什么程度、模糊糊掉多少，一眼就有了。
 *
 * 「主题底纹」默认要盖一层面纱压振幅，理由见 LabShell 的 --lab-backdrop-veil；
 * 「原强度」那一档就是不盖，用来判断面纱到底该压多少。
 *
 * 「自定义图片」由使用者当场选一张，存在本机浏览器里，见 lab-wallpaper-store.ts。
 * 照片能看出玻璃边缘的折射位移——那需要背后有硬边内容，CSS 图案给不了。
 */
export const labPageBackdrops: LabBackdrop[] = [
    {id: "theme", label: "主题底纹"},
    {id: "theme-raw", label: "主题底纹·原强度"},
    {id: "page", label: "页面底"},
    {id: "checker", label: "棋盘格"},
    {id: "stripes", label: "斜纹"},
    {id: "mesh", label: "极光"},
    {id: "custom", label: "自定义图片"},
    {id: "light", label: "纯白"},
    {id: "dark", label: "纯黑"},
];

export const LAB_DEFAULT_PAGE_BACKDROP = "theme";

/** 画布缩放。倍率只影响呈现，组件拿到的仍是画布声明的那个尺寸。 */
export const labZooms = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const LAB_DEFAULT_ZOOM = 1;
