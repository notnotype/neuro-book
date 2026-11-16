/*
 * 产品窗口的最小尺寸（docs/specs/runtime/desktop-shell.md 输出 10）。Electrobun 2.0.6 没有 minWidth/minHeight，它的窗口过程只给
 * WS_POPUP 处理 WM_GETMINMAXINFO。壳（win32.ts 的 setMinimumSize）在运行时用 bun:ffi 的 cc（Bun 内嵌的 TinyCC）编译这份源码，
 * 用 SetWindowLongPtrW(GWLP_WNDPROC) 把下面的窗口过程装到产品窗口上：每条消息先原样交给 Electrobun 原来的过程，WM_GETMINMAXINFO
 * 再把 ptMinTrackSize 抬到最小值。为什么是子类化而不是消息钩子、为什么这样编译，见 w00046 t18 的 evidences/min-size-probe-r1.txt。
 *
 * 写法上的约束（改之前先看）：
 * - 不 #include、不链接任何库：用户机器上没有头文件，TinyCC 怎么找到 user32 也没有保证。用到的 user32 函数由 win32.ts 经
 *   GetProcAddress 取地址，换窗口过程之前经 nb_init 一次交进来，之后只读。
 * - 只支持 Windows x64（Electrobun 的 Windows 目标只有 x64）：结构体按 x64 布局手写，下面有大小断言。
 * - 原过程与最小值存成窗口属性（名字与 win32.ts 的 PROP_* 一致），不用跨线程共享的表：属性由系统串行化、随窗口销毁。
 * - 窗口过程跑在 Electrobun 的 UI 线程，每条消息都经过它：出错就是整个应用崩，所以只改 WM_GETMINMAXINFO 的一个字段，其余原样交下去。
 * - 定义了 NB_MIN_SIZE_PURE 时只编纯函数 nb_min_track（Linux 上的单元测试，src/desktop/min-size.test.ts）。
 */

typedef long long nb_i64;
typedef unsigned long long nb_u64;

/*
 * 拖动改大小时的最小外框（物理像素），宽在高 32 位、高在低 32 位。
 * logical_*：最小客户区（逻辑像素）；dpi：窗口所在显示器的 DPI，0 按 96；frame_*：此刻外框比客户区多出的部分，负值按 0；
 * work_*：所在显示器的工作区，0 为不知道（不夹）；current_*：系统已经给的最小跟踪尺寸，结果不小于它。
 * 先按 DPI 向上取整、加外框，再夹到工作区（工作区比最小值小的屏幕上，拖一下不至于让窗口跳出屏幕），最后与系统值取较大。
 */
nb_i64 nb_min_track(int logical_w, int logical_h, unsigned dpi, int frame_w, int frame_h, int work_w, int work_h, int current_w, int current_h) {
    unsigned scale = dpi == 0 ? 96 : dpi;
    int w = (int)(((nb_u64)logical_w * scale + 95) / 96);
    int h = (int)(((nb_u64)logical_h * scale + 95) / 96);
    w += frame_w > 0 ? frame_w : 0;
    h += frame_h > 0 ? frame_h : 0;
    if (work_w > 0 && w > work_w) w = work_w;
    if (work_h > 0 && h > work_h) h = work_h;
    if (w < current_w) w = current_w;
    if (h < current_h) h = current_h;
    return ((nb_i64)w << 32) | (nb_i64)(unsigned)h;
}

#ifndef NB_MIN_SIZE_PURE

typedef unsigned short nb_wchar;
typedef struct { int x, y; } NB_POINT;
typedef struct { NB_POINT reserved, max_size, max_position, min_track_size, max_track_size; } NB_MINMAXINFO;
typedef struct { int left, top, right, bottom; } NB_RECT;
typedef struct { unsigned size; NB_RECT monitor, work; unsigned flags; } NB_MONITORINFO;
_Static_assert(sizeof(NB_MINMAXINFO) == 40, "MINMAXINFO is 40 bytes on Windows x64");
_Static_assert(sizeof(NB_MONITORINFO) == 40, "MONITORINFO is 40 bytes on Windows x64");

typedef nb_i64 (*NB_WNDPROC)(void*, unsigned, nb_u64, nb_i64);

/* 顺序与 win32.ts 的 MIN_SIZE_IMPORTS 一致。 */
static struct {
    nb_i64 (*CallWindowProcW)(NB_WNDPROC, void*, unsigned, nb_u64, nb_i64);
    nb_i64 (*DefWindowProcW)(void*, unsigned, nb_u64, nb_i64);
    void* (*GetPropW)(void*, const nb_wchar*);
    void* (*RemovePropW)(void*, const nb_wchar*);
    unsigned (*GetDpiForWindow)(void*);
    int (*GetWindowRect)(void*, NB_RECT*);
    int (*GetClientRect)(void*, NB_RECT*);
    int (*IsZoomed)(void*);
    int (*IsIconic)(void*);
    void* (*MonitorFromWindow)(void*, unsigned);
    int (*GetMonitorInfoW)(void*, NB_MONITORINFO*);
} user32;

#define WM_GETMINMAXINFO 0x0024
#define WM_NCDESTROY 0x0082
#define MONITOR_DEFAULTTONEAREST 2

static const nb_wchar PROP_WNDPROC[] = {'n', 'b', 'o', 'o', 'k', '.', 'w', 'n', 'd', 'p', 'r', 'o', 'c', 0};
static const nb_wchar PROP_MINSIZE[] = {'n', 'b', 'o', 'o', 'k', '.', 'm', 'i', 'n', 's', 'i', 'z', 'e', 0};

void nb_init(void** table) {
    void** slot = (void**)&user32;
    for (unsigned i = 0; i < sizeof(user32) / sizeof(void*); i++) slot[i] = table[i];
}

/* 最大化与最小化时窗口矩形不是正常的外框（最小化时在 -32000 处），这时不改：这两种状态下不能拖动改大小，恢复后系统会再问一次。 */
static void raise_min_track(void* hwnd, NB_MINMAXINFO* info) {
    nb_u64 packed = (nb_u64)user32.GetPropW(hwnd, PROP_MINSIZE);
    if (packed == 0 || user32.IsZoomed(hwnd) || user32.IsIconic(hwnd)) return;
    NB_RECT window, client;
    if (!user32.GetWindowRect(hwnd, &window) || !user32.GetClientRect(hwnd, &client)) return;
    int frame_w = (window.right - window.left) - (client.right - client.left);
    int frame_h = (window.bottom - window.top) - (client.bottom - client.top);
    int work_w = 0, work_h = 0;
    void* monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    NB_MONITORINFO mi;
    mi.size = sizeof(mi);
    if (monitor != 0 && user32.GetMonitorInfoW(monitor, &mi)) {
        work_w = mi.work.right - mi.work.left;
        work_h = mi.work.bottom - mi.work.top;
    }
    nb_i64 track = nb_min_track((int)(packed >> 16), (int)(packed & 0xffff), user32.GetDpiForWindow(hwnd), frame_w, frame_h, work_w, work_h, info->min_track_size.x, info->min_track_size.y);
    info->min_track_size.x = (int)(track >> 32);
    info->min_track_size.y = (int)(track & 0xffffffff);
}

nb_i64 nb_window_proc(void* hwnd, unsigned msg, nb_u64 wparam, nb_i64 lparam) {
    NB_WNDPROC prev = (NB_WNDPROC)user32.GetPropW(hwnd, PROP_WNDPROC);
    /* 正常不会发生（属性先于过程装上、销毁时最后才删）；万一取不到原过程，交给系统的缺省过程，不调空指针。 */
    if (prev == 0) return user32.DefWindowProcW(hwnd, msg, wparam, lparam);
    nb_i64 result = user32.CallWindowProcW(prev, hwnd, msg, wparam, lparam);
    if (msg == WM_GETMINMAXINFO) {
        raise_min_track(hwnd, (NB_MINMAXINFO*)lparam);
    } else if (msg == WM_NCDESTROY) {
        user32.RemovePropW(hwnd, PROP_MINSIZE);
        user32.RemovePropW(hwnd, PROP_WNDPROC);
    }
    return result;
}

void* nb_window_proc_address(void) {
    return (void*)nb_window_proc;
}

#endif
