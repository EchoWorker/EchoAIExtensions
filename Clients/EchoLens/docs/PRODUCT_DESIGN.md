# EchoLens — 产品设计文档

> 状态：草案 v1（待评审）
> 作者：Echo
> 日期：2026-06-19
> 定位：EchoAI 生态的 **Windows 屏幕感知 AI 助手**，与 EchoWork 同级的独立桌面应用
> 关联调研：`Sylinko/Everywhere`（屏幕感知，BSL-1.1，仅借鉴思路不抄代码）
> 可行性验证：`C:\Users\zhiweigao\uia-spike`（UIA Rust spike，已跑通）

---

## 0. 一句话定义

**按一个全局热键，EchoLens 立刻"看懂"你当前屏幕上任何 App 的内容（报错、网页、邮件、表格、聊天），就地回答或操作——不用截图、不用复制、不用切窗口。**

它是 EchoWork 的"镜像兄弟"：
- **EchoWork** = 在 IDE 里帮你**写代码**（workspace 内）
- **EchoLens** = 在**整个桌面**帮你**理解和操作任意 App**（workspace 外）

两者共享同一个 EchoAI gateway 大脑，只是"眼睛"和"战场"不同。

---

## 1. 为什么做这个（动机与边界）

### 1.1 EchoWork 的盲区
EchoWork 是 coding agent，能力边界在 workspace 内——它能读文件、跑终端、改代码。但它**看不见 IDE 之外的世界**：
- 你浏览器里报的错、看的文档
- 你正在写的邮件、聊天对话
- 设计稿、Excel、PDF 阅读器里的内容
- 任何非代码的桌面 App

这些场景下，用户今天的做法是：**截图 → 切到 AI → 粘贴 → 描述上下文 → 提问**。EchoLens 把这个流程压缩成**一个热键**。

### 1.2 与"截图问 AI"的本质区别
EchoLens 不是又一个截图工具。核心差异是**它读的是操作系统的"无障碍树"（Accessibility Tree），不是像素**：
- 截图 → 多模态模型 OCR → 猜测结构（慢、贵、易错、丢失语义）
- **EchoLens → UIA 抽取结构化元素树（类型/文本/位置/层级）→ 喂给 LLM**（快、准、省 token、带语义）

> 截图只作为"图片类元素"的兜底（比如设计稿、图表）。文本和控件一律走结构化抽取。

### 1.3 明确边界（不做什么）
- **不做跨平台**：只做 Windows。macOS 的 AX API、Linux 的 AT-SPI 是另一个量级的工作量，留到验证产品价值之后。
- **不抄 Everywhere 代码**：Everywhere 是 BSL-1.1（商用受限）。我们只借鉴它的**架构思路**（无障碍树抽取 + 上下文裁剪），用 Rust 全新实现。算法和 OS API 都是公开知识，重写无法律风险。
- **MVP 不做"操作"**：先做**只读感知 + 问答**，不做点击/输入自动化。后者带来安全/权限/失败恢复的复杂度，留到 v2。

---

## 2. 可行性已验证（关键事实）

在写这份文档前，已做完 Rust UIA spike（`C:\Users\zhiweigao\uia-spike`），结论：

| 验证项 | 结果 |
|---|---|
| Rust 调 Windows UIA | ✅ `uiautomation` crate v0.25（Apache-2.0，31万下载，持续维护）封装好 COM，无需裸调 |
| 抓元素树（类型/名字/位置/层级）| ✅ 实测完整抓到整个桌面所有窗口 |
| 光标命中入口 `element_from_point` | ✅ 21ms |
| **性能**（唯一风险点）| ✅ **150 节点 48ms** |

**性能关键发现（决定核心架构）**：
- 瓶颈是 **TreeWalker 逐节点导航的跨进程 COM IPC**（占 ~57%），不是读属性
- 错误解法：`find_all_build_cache` + TrueCondition（返回扁平 Vec，反而更慢）
- ✅ **正解：`build_updated_cache(TreeScope::Subtree)`** 一次 COM 调用把整棵子树结构+属性拉进本地内存，再用 `get_cached_children` / `get_cached_*` 本地递归——**零额外 IPC，150 节点 48ms，比实时遍历快 3 倍**

> 核心配方（已验证可跑）：
> `element_from_point`（光标入口）→ 向上找顶层窗口 → `build_updated_cache(Subtree)` 一次性缓存 → 本地递归 + 节点上限裁剪 → 序列化喂 LLM

---

## 3. 产品形态与核心交互

### 3.1 交互范式：召唤式（Spotlight 风格）
- 平时**隐身**（托盘常驻，不占屏）
- 按**全局热键**（默认 `Alt+Space` 或 `Ctrl+Shift+Space`）→ 弹出一个**居中的轻量输入条**（类似 macOS Spotlight / Windows PowerToys Run）
- 弹出的**瞬间**，EchoLens 已经抓好了"你召唤前那一刻"的屏幕上下文
- 你打一句话（"这个报错啥意思""总结这页""把这段翻译成英文"）→ 回答**就地浮现**在输入条下方
- `Esc` 收起，回到隐身

### 3.2 三种感知范围（用户可切，默认智能选择）
| 范围 | 抓什么 | 适用 |
|---|---|---|
| **焦点元素**（默认）| 光标/焦点元素 + 其涟漪扩散邻域 | "这个按钮干嘛的""这段什么意思" |
| **当前窗口** | 整个前台窗口的元素树（裁剪后）| "总结这个网页""这个表单要填什么" |
| **全屏** | 所有可见顶层窗口的浅层概览 | "我现在屏幕上都开着啥""帮我整理待办" |

### 3.3 输出形态
- **默认**：输入条下方的浮动卡片，markdown 渲染（复用 EchoWork 的聊天渲染组件）
- **追问**：同一个浮层里多轮对话，上下文保留
- **可固定**：把浮层 pin 成一个常驻小窗（看长文时）

---

## 4. 技术架构

### 4.1 总览：四层 + 一个大脑

```
┌─────────────────────────────────────────────────┐
│  EchoLens.exe  (Tauri 桌面应用, 和 EchoWork 同级)   │
│                                                   │
│  ┌──────────────┐   ┌──────────────────────────┐ │
│  │ Renderer(React)│   │  Rust 后端 (Tauri core)   │ │
│  │  - 输入条 overlay │◄─►│  ① 全局热键 + overlay 窗口 │ │
│  │  - 浮动回答卡片   │   │  ② 屏幕感知 crate(核心)   │ │
│  │  - 设置          │   │     echolens-perception  │ │
│  └──────────────┘   │  ③ EchoBotClient(连gateway)│ │
│                      └──────────────────────────┘ │
└────────────────────────────────┬──────────────────┘
                                  │ JSON-RPC / WebSocket
                                  ▼
                       ┌──────────────────────┐
                       │  EchoAI gateway(已有)  │ ← 复用,零改动
                       │  chat.completions     │
                       └──────────────────────┘
```

### 4.2 核心：`echolens-perception` crate（自研，纯 Rust）

这是整个产品的护城河，拆成三个零依赖于平台之外的模块：

```
echolens-perception/
├── capture/          # 平台相关：抓 UIA 树（Windows-only）
│   ├── mod.rs        #   IVisualElement trait（抽象,为未来跨平台留口）
│   └── windows.rs    #   uiautomation crate 实现
├── builder/          # 平台无关：上下文构建（核心算法，借鉴 Everywhere）
│   ├── traversal.rs  #   best-first 扩散 + 节点预算 + 深度限制
│   ├── scoring.rs    #   元素评分（距焦点距离 × 类型权重）
│   ├── prune.rs      #   压缩术（容器折叠/Label合并/长文挖空）
│   └── serialize.rs  #   输出 XML/紧凑文本(给 LLM)
└── lib.rs            # PerceptionContext::capture(scope) -> String
```

#### 4.2.1 capture 层（已验证配方）
```rust
// 伪代码,基于 spike 实测
pub fn capture_focused() -> CachedTree {
    let automation = UIAutomation::new()?;
    // 1. 光标命中入口
    let hit = automation.element_from_point(cursor_pos())?;
    // 2. 向上找顶层窗口
    let window = find_top_window(&hit);
    // 3. 一次性缓存整棵子树(关键!48ms)
    let cache_req = automation.create_cache_request()?;
    cache_req.add_property(Name);
    cache_req.add_property(ControlType);
    cache_req.add_property(BoundingRectangle);
    cache_req.set_tree_scope(TreeScope::Subtree)?;
    let cached_root = window.build_updated_cache(&cache_req)?;
    CachedTree::new(cached_root, hit) // hit 作为"焦点锚点"
}
```

#### 4.2.2 builder 层（借鉴 Everywhere 的 VisualContextBuilder）
> 这是 spike 数据证明"必需"的部分——582 节点全量要 1.25s，必须裁剪。

核心算法（平台无关，可纯单测）：
- **以焦点元素为中心，best-first 扩散**：优先级队列，评分 = `方向权重(兄弟>父>子) × 距离衰减 × 类型权重(文本>容器>按钮>图片)`
- **节点预算**：抓满 N 个（默认 ~120，对应 token 预算）即停，剩余标记 `omitted`，留可展开提示
- **压缩术**：单子容器折叠、连续 Label 合并、超长文本中段挖空
- **序列化**：输出紧凑 XML（LLM 最易读），带 `elementId` 供后续主动展开

#### 4.2.3 输出示例（喂给 LLM 的样子）
```xml
<window name="Release All · EchoWorker/EchoAIStore" type="Window">
  <tab name="Tab bar">
    <text>Summary</text>
    <button name="Re-run all jobs"/>
    <group name="Jobs">
      <text>build (windows) — failed</text>
      <text>build (macos) — success</text>
    </group>
  </tab>
  <!-- 47 more elements omitted; use expand(elementId=12) -->
</window>
```

### 4.3 喂给 LLM 的两条通道（借鉴 Everywhere）
1. **被动注入**（MVP）：召唤时把感知结果包进 user message 的 `<screen_context>` 块，随用户问题一起发
2. **主动工具**（v1.5）：注册 `get_screen_tree` / `expand_element` / `list_windows` 工具，让 LLM 像 `read_file` 一样按需读屏，支持渐进式探索（先看概览，需要细节再展开某个 omitted 节点）

### 4.4 复用 EchoWork 的现成零件（省掉 60% 工作）
EchoLens 不从零造，直接搬 EchoWork 的：

| 复用 | 来源 | 说明 |
|---|---|---|
| ✅ **EchoBotClient** | EchoWork core | 连 gateway 的 WebSocket/JSON-RPC，整套搬 |
| ✅ **聊天渲染组件** | EchoWork chat-panel | 消息气泡、markdown、代码块、tool 卡片 |
| ✅ **配置系统** | EchoWork config | echocode.toml 读写、模型选择 |
| ✅ **Tauri 外壳 + build/release** | EchoWork + EchoAIStore | 全局热键、多窗口、托盘、自更新、CI |
| 🆕 **echolens-perception crate** | 新写 | 唯一的核心新增 |
| 🆕 **overlay 输入条 UI** | 新写 | Spotlight 风格浮层 |

### 4.5 gateway 侧：零改动
EchoLens 就是 gateway 的又一个 client，走标准 `chat.completions`。感知结果作为 user message 内容发送，gateway 无需知道"屏幕"概念。和微信 channel 一样，**EchoAI gateway 不动一行代码**。

---

## 5. MVP 范围与里程碑

### 5.1 MVP 定义（只读问答闭环）
**一句话**：热键召唤 → 抓当前窗口 → 问答 → 收起。不做操作、不做跨平台、不做主动工具。

MVP 必须有：
- [x] 可行性验证（已完成）
- [ ] echolens-perception：capture(windows) + builder(裁剪) + serialize(XML)
- [ ] 全局热键 + overlay 输入条
- [ ] 接 EchoBotClient，感知结果注入 user message
- [ ] 浮动回答卡片（复用 EchoWork 渲染）
- [ ] 托盘 + 基础设置（热键/模型/感知范围）

### 5.2 里程碑

```
M0  可行性验证            ✅ 已完成（uia-spike）
M1  perception crate     capture + builder + serialize + 单测   (~3天)
M2  App 外壳             Tauri + 热键 + overlay + 托盘          (~2天)
M3  打通链路             接 EchoBotClient + 感知注入 + 回答渲染   (~2天)
M4  MVP 收尾             设置页 + 三种感知范围 + 错误处理         (~2天)
─────────────────────────────────────────────────────────
    MVP 小计 ≈ 9 天（复用 EchoWork 零件后）

M5  主动工具(v1.5)        get_screen_tree/expand_element        (~3天)
M6  截图兜底             图片类元素转截图多模态                  (~2天)
M7  操作能力(v2)          点击/输入 + 权限确认 + 失败恢复         (大, 单独立项)
```

### 5.3 关键风险与对策
| 风险 | 等级 | 对策 |
|---|---|---|
| 性能（复杂窗口慢） | 中 | ✅ 已解：build_updated_cache + 节点预算，已验证 48ms |
| 某些 App 无障碍支持差（如部分 Electron/游戏）| 中 | 截图兜底（M6）；这类 App 本就少 |
| webview 内容抓不全（Chrome/Edge 默认不暴露完整 AX 树）| 中 | 需开浏览器 accessibility；或对浏览器特殊处理/截图兜底 |
| 隐私（抓屏可能含敏感信息）| 高 | 本地处理；发送前可预览/编辑感知内容；敏感 App 黑名单 |
| 热键冲突 | 低 | 可配置 |

---

## 6. 隐私与信任（重要）

EchoLens 能"看屏幕"，这是强能力，必须有匹配的信任设计：
- **完全本地抽取**：感知在本机完成，只有用户提问时才把"裁剪后的上下文"发给 gateway（和你平时聊天发的内容同级别）
- **发送前可见**：浮层可展开"将发送的屏幕上下文"，用户能看到/删改到底发了什么
- **App 黑名单**：密码管理器、银行 App 等默认不抓（按窗口标题/进程名匹配）
- **无后台偷窥**：只在用户**主动按热键**时抓，不常驻监听屏幕
- **不截图除非必要**：默认只抓结构化文本，截图仅在图片类元素且用户允许时

---

## 7. 与 Everywhere 的关系（合规声明）

- Everywhere（Sylinko/Everywhere）是 **BSL-1.1** 许可，**不可复制其源码**
- EchoLens **仅借鉴其架构思想**：① 无障碍树抽取优于截图 ② 上下文裁剪（best-first + 预算）③ 被动注入 + 主动工具双通道
- 这些都是**公开的技术常识**（UIA 是微软公开 API，上下文裁剪是通用工程），用 Rust 全新实现无侵权
- 依赖的 `uiautomation` crate 是 **Apache-2.0**，可商用

---

## 8. 开放问题（待志伟拍板）

1. **产品名**：EchoLens？还是别的（EchoEye / EchoView / EchoGlance）？
2. **MVP 热键**：默认 `Alt+Space`（和某些输入法冲突）还是 `Ctrl+Shift+Space`？
3. **MVP 是否含截图兜底**，还是纯结构化先跑起来？
4. **浏览器内容**：MVP 是否专门处理浏览器（需开 AX），还是先靠截图兜底？
5. **独立 repo 还是放 EchoAIExtensions**：它比微信 channel 重得多（是个完整 App），可能值得独立 repo。

---

## 9. 一句话总结

EchoLens 是 EchoWork 的"出 IDE"版本——同一个 EchoAI 大脑，换一双能看整个 Windows 桌面的眼睛。地基（UIA 抽取 + 性能）已用 spike 验证，核心新增只有一个 perception crate，其余全部复用 EchoWork。MVP 约 9 天，做的是"只读屏幕问答"，把"截图→切窗→粘贴→提问"压缩成一个热键。
