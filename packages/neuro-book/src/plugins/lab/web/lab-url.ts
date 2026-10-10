/**
 * Lab 地址栏参数（docs/specs/ui/component-lab.md 的输出“地址栏参数”与“地址栏就是标签页的会话状态”）。组件、场景、
 * 画布、缩放与检视 tab 只在地址栏，刷新与分享出去的链接打开就是同一个画面；地址里的主题与配色只作用于这个标签页。
 */

/** 画布尺寸预设；宽高都为 0 表示随窗口。 */
export const LAB_VIEWPORT_PRESETS: Record<string, readonly [number, number]> = {
    free: [0, 0],
    tablet: [768, 1024],
    phone: [390, 844],
};

const MAX_CANVAS_SIZE = 16384;

/** 地址栏里的主题、配色与画布；组件、场景等会话状态见 `sessionFromQuery`。 */
export type LabUrlParams = {
    themeId?: string;
    colorwayId?: string;
    canvasSize?: {width: number; height: number};
};

/** `vp=phone|tablet|free` 或 `vp=<宽>x<高>`；不认识或越界时返回 undefined。 */
export function parseLabViewport(value: string | null): {width: number; height: number} | undefined {
    if (value === null) {
        return undefined;
    }
    const preset = LAB_VIEWPORT_PRESETS[value];
    if (preset !== undefined) {
        return {width: preset[0], height: preset[1]};
    }
    const match = /^(\d{1,5})x(\d{1,5})$/u.exec(value);
    if (match === null) {
        return undefined;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width <= MAX_CANVAS_SIZE && height <= MAX_CANVAS_SIZE ? {width, height} : undefined;
}

/**
 * `cw` 可以写配色 id，也可以写 `light` / `dark`，取第一套外观相符的配色。
 * 主题与配色是否真的存在由偏好恢复按登记表再校验一次。
 */
export function parseLabUrl(search: string, colorways: Record<string, {appearance: "light" | "dark"}>): LabUrlParams {
    const params = new URLSearchParams(search);
    const colorway = params.get("cw");
    const byAppearance = colorway === "light" || colorway === "dark"
        ? Object.entries(colorways).find(([, meta]) => meta.appearance === colorway)?.[0]
        : undefined;
    return {
        themeId: params.get("theme") ?? undefined,
        colorwayId: byAppearance ?? colorway ?? undefined,
        canvasSize: parseLabViewport(params.get("vp")),
    };
}

/** 检视面板的 tab；`doc` 是缺省。 */
export const LAB_INSPECT_TABS = ["doc", "element", "events", "data", "variables"] as const;

/** 标签页的会话状态：全部来自地址栏。 */
export type LabSession = {
    readonly component: string;
    /** 空串表示没有指定，打开组件的首个场景。 */
    readonly scene: string;
    readonly canvas: {readonly width: number; readonly height: number};
    readonly zoom: number;
    readonly tab: string;
};

export type LabSessionCatalog = {
    readonly componentNames: readonly string[];
    readonly zooms: readonly number[];
    readonly defaults: {readonly component: string; readonly zoom: number; readonly tab: string};
};

/** 宿主路由给的查询参数：一个键可能出现多次或没有值，取第一个字符串。 */
export type LabQuery = Readonly<Record<string, string | null | ReadonlyArray<string | null> | undefined>>;

/** Lab 自己的参数与旧别名：写回地址栏时由规范写法替换，其余参数原样保留。 */
const OWN_PARAMS = ["c", "s", "component", "scene", "vp", "zoom", "tab"];
const LOOK_PARAMS = ["cw", "theme"];
const SCENE_ID = /^[a-zA-Z0-9_.-]{1,100}$/u;

function first(query: LabQuery, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = query[key];
        const text = Array.isArray(value) ? value.find((item): item is string => typeof item === "string") : value;
        if (typeof text === "string") return text;
    }
    return undefined;
}

/** 地址栏到会话：不认识或越界的参数回到缺省，其余参数照常生效。 */
export function sessionFromQuery(query: LabQuery, catalog: LabSessionCatalog): LabSession {
    const component = first(query, "c", "component");
    const scene = first(query, "s", "scene");
    const zoom = Number(first(query, "zoom"));
    const tab = first(query, "tab");
    return {
        component: component !== undefined && catalog.componentNames.includes(component) ? component : catalog.defaults.component,
        scene: scene !== undefined && SCENE_ID.test(scene) ? scene : "",
        canvas: parseLabViewport(first(query, "vp") ?? null) ?? {width: 0, height: 0},
        zoom: catalog.zooms.includes(zoom) ? zoom : catalog.defaults.zoom,
        tab: tab !== undefined && (LAB_INSPECT_TABS as readonly string[]).includes(tab) ? tab : catalog.defaults.tab,
    };
}

/** `vp` 的规范写法：预设名，或 `宽x高`；随窗口（0×0）不写。 */
export function viewportParam(canvas: {readonly width: number; readonly height: number}): string | undefined {
    if (canvas.width === 0 && canvas.height === 0) return undefined;
    const preset = Object.entries(LAB_VIEWPORT_PRESETS).find(([, [width, height]]) => width === canvas.width && height === canvas.height);
    return preset?.[0] ?? `${String(canvas.width)}x${String(canvas.height)}`;
}

/**
 * 会话到查询参数：不认识的参数原样保留；Lab 自己的参数与旧别名换成规范写法，等于缺省的不写。主题与配色（`theme`、
 * `cw`）：`look` 不给时原样保留地址里的；为 null 时去掉（在界面上换了主题，地址里的已过时）；给出时写上（复制场景
 * 链接要带上画面的样子）。
 */
export function queryFromSession(session: LabSession, current: LabQuery, catalog: LabSessionCatalog, look?: {readonly themeId: string; readonly colorwayId: string} | null): Record<string, string | string[]> {
    const kept: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(current)) {
        if (OWN_PARAMS.includes(key) || (look !== undefined && LOOK_PARAMS.includes(key)) || value === undefined || value === null) continue;
        kept[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : value as string;
    }
    const vp = viewportParam(session.canvas);
    return {
        ...kept,
        ...(session.component === "" ? {} : {c: session.component}),
        ...(session.scene === "" ? {} : {s: session.scene}),
        ...(vp === undefined ? {} : {vp}),
        ...(session.zoom === catalog.defaults.zoom ? {} : {zoom: String(session.zoom)}),
        ...(session.tab === catalog.defaults.tab ? {} : {tab: session.tab}),
        ...(look === undefined || look === null ? {} : {theme: look.themeId, cw: look.colorwayId}),
    };
}
