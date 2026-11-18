/** nb-layout 自带的中文目录（命名空间 `nb-layout`，源语言），写法见同目录的 `index.ts`。 */
export default {
    splitter: {
        resizeWidth: "调整 {{before}} 与 {{after}} 的宽度",
        resizeHeight: "调整 {{before}} 与 {{after}} 的高度",
        collapsed: "已收起",
        pixels: "{{size}} 像素",
    },
    floatWindow: {
        resize: "用方向键调整浮动窗大小",
        move: "用方向键移动浮动窗",
    },
    sortable: {
        handle: "移动{{name}}",
        hint: "拖动排序；也可以按空格拿起，用方向键移动，回车放下",
        placeholder: "拖到这里",
        picked: "已拿起{{name}}，在{{section}}第 {{index}} 位",
        moved: "{{section}}第 {{index}} 位",
        dropped: "已把{{name}}放到{{section}}第 {{index}} 位",
        cancelled: "已取消，{{name}}回到原处",
    },
};
