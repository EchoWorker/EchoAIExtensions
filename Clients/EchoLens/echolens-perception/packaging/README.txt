# EchoLens — Screen Perception Probe (体验版 / M1)

> 这是 EchoLens 的**第一阶段（M1）体验包**。EchoLens 是一个 Windows 屏幕感知 AI 助手——
> 它能"看懂"你屏幕上正在看的窗口，然后回答相关问题。
>
> **现在这一版还没有图形界面**（热键 + 托盘 + 悬浮窗是下一阶段 M2）。
> 这个小工具让你**直接体验它的"眼睛"**：它会把你正在看的任意窗口，
> 抽取成一棵结构化的 UI 树——也就是 EchoLens 将来会交给 AI 的那份"屏幕上下文"。

---

## 怎么玩（30 秒）

1. 双击 **`Run-EchoLens-Probe.bat`**（会弹出一个黑色控制台窗口）。
2. 它会给你 **3 秒倒计时**——这期间**切换到任何你想让它"看"的窗口**：
   浏览器、VS Code、设置页面、记事本、Office、聊天软件……
3. 倒计时结束，它就抓取那个窗口，并打印：
   - 窗口标题
   - 抓到多少个 UI 元素 / 裁掉多少个（为了塞进 AI 的 token 预算）
   - 耗时（毫秒）
   - 那棵结构化 UI 树的前 40 行（完整版写到了临时文件，路径会显示出来）
4. 按 **回车** 可以再抓一次（换个窗口试试），关窗口或 Ctrl+C 退出。

> 💡 看完整的树：完整 XML 每次都会写到 `%TEMP%\echolens-capture.xml`，
> 程序结束时会打印出完整路径，可以用记事本打开看全貌。

---

## 三种"感知范围"

默认是 `window`。想试别的，可以用命令行运行（在本文件夹里 `cmd` 打开）：

```
echolens-probe.exe focus     聚焦元素 + 它周围的邻居（最聚焦）
echolens-probe.exe window    整个前台窗口（默认，最常用）
echolens-probe.exe screen    所有顶层窗口的概览（最宏观）
```

其它参数：

```
echolens-probe.exe --delay 5    倒计时改成 5 秒
echolens-probe.exe --full       把完整 XML 直接打印到控制台（不只前 40 行）
echolens-probe.exe --once       只抓一次、不倒计时不循环
echolens-probe.exe --help       帮助
```

---

## 你会看到什么样的输出

```
+------------------ Captured ------------------
| Window : Release All - GitHub - Google Chrome
| Kept   : 142 elements
| Omitted: 47 (pruned to fit the AI token budget)
| Time   : 88 ms
+----------------------------------------------

<window name="Release All ..." id="1">
  <tab name="Tab bar" id="3">
    <text>build (windows) - failed</text>
    <button name="Re-run all jobs" id="7"/>
    ...
```

这棵树就是 EchoLens 将来会塞进 `<screen_context>` 交给 AI 的东西——
有了它，AI 就能回答"这个 CI 为什么挂了""这个报错什么意思"之类**跟你屏幕有关**的问题。

---

## 说明 / 已知边界

- **仅 Windows**。感知用的是 Windows UI Automation（无障碍）接口。
- **隐私**：全程**只在你本机运行**，不联网、不发送任何东西——这只是个本地探针。
  （正式版会在"发给 AI 之前"让你预览并可编辑这份上下文；密码框内容已经做了脱敏，不会被抽取。）
- **某些浏览器**（Chrome/Edge）默认暴露的无障碍信息有限，可能抓到的内容偏少——
  这是已知限制，正式版会用截图兜底。先拿 VS Code / 记事本 / 设置 / Office 这类原生窗口体验，效果最直观。
- 性能：常见窗口 70~160ms；超大网页/Electron 应用可能到 200~300ms。

---

## 这只是开始

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M1** | 感知核心（你正在玩的就是它） | ✅ 完成 |
| M2 | 桌面外壳：全局热键 + 托盘 + 半透明悬浮窗 | ⏳ 下一步 |
| M3 | 接通 AI：感知 → `<screen_context>` → 流式回答 | ⏳ |
| M4 | 设置页 / 三种范围切换 / 发送前隐私预览 | ⏳ |

有了 M2，就不用跑命令行了——按个热键，悬浮窗当场弹出，直接问。
