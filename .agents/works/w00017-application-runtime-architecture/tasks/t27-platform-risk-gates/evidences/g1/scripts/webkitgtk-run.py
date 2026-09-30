#!/usr/bin/env python3
"""G1 WebKitGTK 驱动：用系统 webkit2gtk-4.1（Tauri 在 Linux 上的引擎）加载页面，
文档开始时注入监听器探针，加载完成后执行 g1-inpage.js，轮询 window.__G1_RESULT__ 写入 JSON。
用法：webkitgtk-run.py <url> <out.json>"""
import json
import sys
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

url, out = sys.argv[1], sys.argv[2]
here = Path(__file__).resolve().parent
probe = (here / "listener-probe.js").read_text()
inpage = (here / "g1-inpage.js").read_text()
state = {"started": False, "result": None}

ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript.new(probe, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView.new_with_user_content_manager(ucm)
window = Gtk.Window()
window.set_default_size(1280, 900)
window.add(view)
window.show_all()


def finish(payload):
    payload["webkitgtk"] = f"{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}"
    Path(out).write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    Gtk.main_quit()


def on_poll(webview, result, _data):
    try:
        value = webview.evaluate_javascript_finish(result).to_string()
    except Exception as error:  # noqa: BLE001
        finish({"fatal": f"evaluate failed: {error}"})
        return
    if value in ("null", "undefined", ""):
        GLib.timeout_add(500, poll)
        return
    finish(json.loads(value))


def poll():
    view.evaluate_javascript("JSON.stringify(window.__G1_RESULT__ ?? null)", -1, None, None, None, on_poll, None)
    return False


def start():
    view.evaluate_javascript(inpage, -1, None, None, None, None, None)
    GLib.timeout_add(500, poll)
    return False


def on_load_changed(_view, event):
    if event == WebKit2.LoadEvent.FINISHED and not state["started"]:
        state["started"] = True
        GLib.timeout_add(1000, start)


view.connect("load-changed", on_load_changed)
view.load_uri(url)
GLib.timeout_add(240000, lambda: (finish({"fatal": "timeout"}), False)[1])
Gtk.main()
