/** nb-layout 自带的英文目录（命名空间 `nb-layout`，源语言，没有注入时组件用它），写法见同目录的 `index.ts`。 */
export default {
    splitter: {
        resizeWidth: "Resize width between {{before}} and {{after}}",
        resizeHeight: "Resize height between {{before}} and {{after}}",
        collapsed: "Collapsed",
        pixels: "{{size}} pixels",
    },
    floatWindow: {
        resize: "Resize the floating window with the arrow keys",
        move: "Move the floating window with the arrow keys",
    },
    sortable: {
        handle: "Move {{name}}",
        hint: "Drag to reorder, or press Space to pick up, arrow keys to move, and Enter to drop",
        placeholder: "Drop here",
        picked: "Picked up {{name}}, position {{index}} in {{section}}",
        moved: "Position {{index}} in {{section}}",
        dropped: "Moved {{name}} to position {{index}} in {{section}}",
        cancelled: "Cancelled; {{name}} is back where it was",
        unchanged: "{{name}} stays at position {{index}} in {{section}}",
    },
};
