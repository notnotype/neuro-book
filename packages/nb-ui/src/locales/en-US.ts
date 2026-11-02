/** nb-ui 自带的英文目录（命名空间 `nb-ui`），键与 `zh-CN.ts` 相同。 */

import type {Catalog} from "../text";

export default {
    alertDialog: {
        title: "Confirm action",
        confirm: "OK",
        cancel: "Cancel",
    },
    banner: {
        close: "Close",
    },
    breadcrumb: {
        label: "Breadcrumb",
    },
    codeBlock: {
        empty: "No content",
        truncated: "Only part of the content is shown",
    },
    colorPicker: {
        value: "Color value",
        presets: "Preset colors",
    },
    colorSwatches: {
        label: "Color",
    },
    dialog: {
        untitled: "Dialog",
        cancel: "Cancel",
        confirm: "Confirm",
        close: "Close",
    },
    drawer: {
        untitled: "Panel",
        close: "Close",
    },
    emptyState: {
        title: "No data",
    },
    floatingWindow: {
        resizeWidth: "Resize window width",
        resizeHeight: "Resize window height",
        resize: "Resize window",
    },
    infoTip: {
        label: "Info",
    },
    input: {
        clear: "Clear input",
    },
    notification: {
        close: "Dismiss notification",
        inProgress: "In progress",
    },
    numberInput: {
        increase: "Increase",
        decrease: "Decrease",
    },
    searchSelect: {
        empty: "No matching options",
    },
    slider: {
        thumb: "Slider {{index}}",
    },
    spinner: {
        loading: "Loading",
    },
    splitter: {
        resizeWidth: "Resize width between {{before}} and {{after}}",
        resizeHeight: "Resize height between {{before}} and {{after}}",
        collapsed: "Collapsed",
        pixels: "{{size}} pixels",
    },
    table: {
        empty: "No data",
    },
    tabs: {
        more: "More",
    },
    toolbar: {
        label: "Toolbar",
    },
} satisfies Catalog;
