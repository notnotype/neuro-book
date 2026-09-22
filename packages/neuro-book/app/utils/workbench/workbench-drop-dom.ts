/**
 * 工作台拖放的 DOM 适配层：只回答两个问题——「这个落点元素此刻在视口里可见多少」，
 * 以及「指针现在是不是真的指着一个落点」。
 *
 * 为什么需要这一层：dnd-kit 自带的碰撞检测读 `droppable.shape`，那是元素的 bounding rect，
 * 既不看祖先的 `overflow` 裁剪（被裁掉的部分照样算命中），也不看指针位置上压着什么浮层；
 * `defaultCollisionDetection` 在指针没命中任何落点时还会退化成「与被拖 shape 相交」，
 * 于是出现「没指到也高亮」「被挡住也高亮」「高亮位置对不上松手位置」。这里的判定改成三步，
 * 缺一不可：指针落在**可见**矩形内、指针位置最上层的业务元素属于这个落点、库自己的
 * `disabled` / `accept` 过滤通过。
 *
 * 分工：本文件只有 DOM 与几何——不产生动作、不写状态、不认识 session / storage，
 * 也不另建命中登记（droppable 仍由宿主的 `useDroppable` 登记，`accept` / `disabled` 由库过滤）。
 * 坐标系与 `workbench-drop.ts` 的判定一致：**视口 client 坐标**。
 */
import {CollisionPriority, CollisionType, type Collision, type CollisionDetector} from "@dnd-kit/abstract";
import type {GridDropRect} from "@notnotype/nb-ui/layout";

/**
 * dnd-kit 贴在拖动反馈元素上的标记（安装版 `@dnd-kit/dom` 的 `data-dnd-dragging`）。
 *
 * 没配 `overlay` 时反馈元素就是源元素本身：它被弹成 `position: fixed` 并强制 `pointer-events: none`，
 * 子树同样不接收指针事件，所以 `elementsFromPoint` 本来就看不见它。显式跳过是为了让
 * 「拖动反馈不算遮挡、不算落点」这条合同不依赖那份注入样式；将来接 `DragOverlay` 也不会变。
 */
const DRAG_FEEDBACK_ATTRIBUTE = "data-dnd-dragging";

/**
 * 声明式隐藏 / 惰性化的子树：`hidden`（含 `hidden="until-found"` 这种仍占位的情况）与 `inert`。
 * 它们都不该接收落点——库不认识这两个属性，只按矩形算。
 */
const HIDDEN_SELECTOR = "[hidden], [inert]";

/** 会裁剪后代的 overflow 计算值。 */
const CLIPPING_OVERFLOW = /(auto|scroll|hidden|clip)/u;

/** 两个矩形求交：空交集（含零面积）返回 `null`，因为零面积不是有效的落点矩形。 */
function intersect(a: GridDropRect, b: GridDropRect): GridDropRect | null {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? {left, top, right, bottom} : null;
}

/** `DOMRect` → 落点矩形：四项有限且两轴为正才算量出来了，否则 `null`（零尺寸不参与命中）。 */
function finiteRect(rect: DOMRect): GridDropRect | null {
    const box: GridDropRect = {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
    const finite = Number.isFinite(box.left) && Number.isFinite(box.top) && Number.isFinite(box.right) && Number.isFinite(box.bottom);
    return finite && box.right > box.left && box.bottom > box.top ? box : null;
}

/**
 * 祖先的 client 内容盒（视口 client 坐标）：`clientLeft/clientTop` 扣掉边框，`clientWidth/clientHeight`
 * 再扣掉滚动条，因此被滚动条或边框挡住的部分不算可见。
 *
 * 轴对齐缩放（`transform: scale()`）下 rect 是视觉尺寸、`offset*` 是布局尺寸，比例就是缩放系数，
 * 乘回位移与尺寸即折成视口单位。没有 `transform` 时 `rect` 与 `offset` 的差只是取整误差，不能当比例用，
 * 所以只在真的有 transform 时才换算。`offset*` 只有 HTML 元素有，SVG 等其它 `Element` 上取不到布局
 * 尺寸，这种元素按未缩放算——与「比值取不出来」是同一档处理。
 */
function clientRect(element: Element, style: CSSStyleDeclaration): GridDropRect {
    const rect = element.getBoundingClientRect();
    const transformed = typeof style.transform === "string" && style.transform !== "none" && style.transform !== "";
    const layout = transformed && element instanceof HTMLElement ? element : null;
    const scaleX = layout !== null && layout.offsetWidth > 0 ? rect.width / layout.offsetWidth : 1;
    const scaleY = layout !== null && layout.offsetHeight > 0 ? rect.height / layout.offsetHeight : 1;
    const left = rect.left + element.clientLeft * scaleX;
    const top = rect.top + element.clientTop * scaleY;
    return {
        left,
        top,
        right: left + element.clientWidth * scaleX,
        bottom: top + element.clientHeight * scaleY,
    };
}

/**
 * 读元素这一刻**真正可见**的视口 client 矩形；量不出来、被声明隐藏、或裁成空集时返回 `null`。
 *
 * 逐轴把 bounding rect 与视口及所有会裁剪的祖先的 client 盒相交，因此 `overflow: hidden` 的
 * 面板边缘、滚动容器以外、`parking` 中的零尺寸根都不会被当成可落点。`transform` / `backdrop-filter`
 * 本身不裁剪，不参与相交。
 *
 * **不缓存**：判定每帧重新量一次，滚动、尺寸变化、折叠展都在同一帧生效，不会用上一帧的矩形命中。
 *
 * @param element 落点根元素（内容盒 / 标签带 / 条目标签）；`null` / 已断连返回 `null`。
 */
export function readWorkbenchDropRect(element: Element | null | undefined): GridDropRect | null {
    if (element === null || element === undefined || !element.isConnected) {
        return null;
    }
    if (element.closest(HIDDEN_SELECTOR) !== null) {
        return null;
    }
    const ownerDocument = element.ownerDocument;
    const view = ownerDocument.defaultView;
    if (view === null) {
        return null;
    }
    // 计算值已经解析过继承：祖先 `visibility: hidden` 而这一层显式 `visible` 时，它是真的可见。
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return null;
    }
    let box = finiteRect(element.getBoundingClientRect());
    if (box === null) {
        return null;
    }
    const root = ownerDocument.documentElement;
    box = intersect(box, {left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight});
    if (box === null) {
        return null;
    }
    for (let ancestor = element.parentElement; ancestor !== null && ancestor !== root; ancestor = ancestor.parentElement) {
        const ancestorStyle = view.getComputedStyle(ancestor);
        const clipping = CLIPPING_OVERFLOW.test(`${ancestorStyle.overflow} ${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`);
        // `display: contents` 没有盒子，它的 overflow 裁不到任何东西。
        if (!clipping || ancestorStyle.display === "contents") {
            continue;
        }
        box = intersect(box, clientRect(ancestor, ancestorStyle));
        if (box === null) {
            return null;
        }
    }
    return box;
}

/**
 * 指针位置最上层的业务元素是否属于这个落点。
 *
 * `elementsFromPoint` 按绘制顺序从最上层给出命中栈：拖动反馈（源元素 / 反馈副本）不算业务元素，
 * 跳过继续往下看；第一层业务元素必须就是这个落点或它的后代，否则说明指针这里被菜单、对话框或
 * 别的面板挡住了——被挡住的目标不接收。祖先画在后代之上（滚动条命中、叠层技巧）不构成遮挡，
 * 也跳过：那种情况下继续往下才可能看到落点自己。
 */
function pointerReaches(element: Element, x: number, y: number, source: Element | null): boolean {
    for (const hit of element.ownerDocument.elementsFromPoint(x, y)) {
        // 拖动反馈不算业务元素：库标记的反馈元素（没配 `overlay` 时就是源元素本身）与它的子树，
        // 以及源元素子树本身。指针压在这上面时，命中该由它**下面**那一层决定。
        const feedback = hit.closest(`[${DRAG_FEEDBACK_ATTRIBUTE}]`) !== null
            || (source !== null && (hit === source || source.contains(hit)));
        if (feedback) {
            continue;
        }
        if (hit === element || element.contains(hit)) {
            return true;
        }
        if (hit.contains(element)) {
            continue;
        }
        return false;
    }
    return false;
}

/** dnd-kit 的 DOM 实体带 `element`，抽象基类的类型里没有；按结构读一次，不在调用点上撒类型断言。 */
function entityElement(entity: object): Element | null {
    const {element} = entity as {element?: unknown};
    return element instanceof Element ? element : null;
}

/** 碰撞检测器的输入类型：`CollisionDetectorInput` 没有从包里导出，按公开签名取一次。 */
type WorkbenchCollisionInput = Parameters<CollisionDetector>[0];

function detectPointerCollision(input: WorkbenchCollisionInput): Collision | null {
    // 指针坐标：安装版的 PointerSensor 把最新的 client 坐标写进 `position.current`，
    // 键盘拖动写的是元素中心——两处都当同一份只读坐标用，这里不另算一份。
    const {x, y} = input.dragOperation.position.current;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    const element = entityElement(input.droppable);
    if (element === null) {
        return null;
    }
    const rect = readWorkbenchDropRect(element);
    if (rect === null || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        return null;
    }
    const source = input.dragOperation.source;
    if (!pointerReaches(element, x, y, source === null ? null : entityElement(source))) {
        return null;
    }
    // `value` 沿用安装版 `pointerIntersection` 的约定：到落点中心的距离越近越大，同优先级的两条碰撞靠它排序。
    // 距离为 0 时用 `Number.EPSILON` 兜底，免得比较器拿到 `Infinity` 相减产生 `NaN`。
    const distance = Math.hypot(x - (rect.left + rect.right) / 2, y - (rect.top + rect.bottom) / 2);
    return {
        id: input.droppable.id,
        priority: CollisionPriority.High,
        type: CollisionType.PointerIntersection,
        value: 1 / Math.max(distance, Number.EPSILON),
    };
}

/**
 * 工作台的指针碰撞检测器：只把「指针真的在可见范围里」的落点算成命中。
 *
 * 交给 `useDroppable({collisionDetector: workbenchPointerCollision})`，或由会话层用
 * `manager.collisionObserver.computeCollisions(undefined, workbenchPointerCollision)` 同步取结果；
 * 两条路都仍然先按库的规则过滤掉 `disabled` 与不接受当前拖动源类型的落点。
 *
 * 与库自带 `pointerIntersection` 的两点差别：读的是**可见**矩形而不是 bounding rect；
 * 指针不命中就返回 `null`，没有「退化成与被拖 shape 相交」的兜底，所以不会出现「没指到也高亮」。
 * 返回的 `priority` 只是库的默认档（`High`）；宿主若在自己的 droppable 上写了 `collisionPriority`，
 * `computeCollisions` 会照旧用那一份覆盖它。
 */
export const workbenchPointerCollision: CollisionDetector = detectPointerCollision;
