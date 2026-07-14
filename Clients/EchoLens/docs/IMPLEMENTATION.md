# EchoLens — 实现方案（Implementation Design）

> 状态：草案 v1（待评审）
> 作者：Echo
> 日期：2026-06-20
> 配套文档：[`PRODUCT_DESIGN.md`](./PRODUCT_DESIGN.md)（产品定位/交互/边界）
> 本文职责：把产品文档翻译成"照着就能 build"的工程方案——perception crate 的真实 API、复用 EchoWork 的逐文件清单、热键/托盘/overlay 这些净新增部分的设计、以及 capture 时序这个最大落地坑。

---

## 0. 阅读指南

- 本文**只是设计文档**。当前仓库里只有 `spike/`（已验证可行性的探针代码）和两份 docs。本文不脚手架、不写产品代码——把"做什么、怎么做、复用谁"讲清楚，等志伟拍板后再按里程碑开工。
- 所有"复用 EchoWork 的 XX 文件 / 函数"都经过实仓核对（路径 + 符号都真实存在），见 §9 验证清单。
- 所有 Rust capture 代码基于 `spike/` 实测配方 + `uiautomation` v0.25 真实 API 签名（已对照 crate 源码）。
- **§2.3.3 / §2.4 / §3.6 的 Windows 交互与 UIA 裁剪设计，借鉴自精读 `Sylinko/Everywhere`（BSL-1.1）真实源码**——它是同类产品里把 Windows 召唤式交互做得最成熟的。**只借鉴思路、用 Rust 重写**（BSL-1.1 不可抄码；但 DWM Cloak / best-first 裁剪 / token 预算 / 热键双路径都是公开 Win32 工程常识）。这些是读了它生产代码后**修正/强化**的设计，不是凭空臆造。

---

## 1. 总览：一个护城河 + 60% 复用

EchoLens 是 EchoWork 的"镜像兄弟"——同一个 EchoAI gateway 大脑，换一双能看整个 Windows 桌面的眼睛。工程上这意味着：

```
┌──────────────────────────────────────────────────────────────────┐
│  EchoLens.exe  (Tauri 2 桌面应用，与 EchoWork 同级)                  │
│                                                                    │
│  ┌────────────────────────┐     ┌──────────────────────────────┐  │
│  │  Renderer (React 18)    │     │  Rust 后端 (Tauri core)        │  │
│  │                         │     │                              │  │
│  │  🆕 SpotlightOverlay    │◄───►│  🆕 ① 全局热键 + overlay 窗口   │  │
│  │  🆕 感知预览/编辑面板     │ IPC │  🆕 ② 托盘 + single-instance   │  │
│  │  ♻️ chat 渲染 (markdown) │     │  🆕 ③ echolens-perception crate│  │
│  │  ♻️ gateway client       │     │  ♻️ ④ echobot_manager (gateway)│  │
│  └────────────────────────┘     └──────────────────────────────┘  │
└───────────────────────────────────────────┬────────────────────────┘
                                             │ JSON-RPC / WebSocket
                                             ▼
                                  ┌────────────────────────┐
                                  │  EchoAI gateway (已有)   │ ← 零改动
                                  │  chat.completions       │
                                  └────────────────────────┘

🆕 = 净新增（本产品独有）    ♻️ = 从 EchoWork 搬（verbatim 或小改）
```

**工作量分布**（粗估，对齐产品文档 ~9 天 MVP）：

| 层 | 新增 vs 复用 | 说明 |
|---|---|---|
| **perception crate** | 🆕 100% 新写 | 唯一护城河。spike 已验证地基（48ms/150 节点） |
| **热键/托盘/overlay 窗口** | 🆕 100% 新写 | EchoWork **完全没有**这些（已核实），无参考实现 |
| **gateway client（连大脑）** | ♻️ ~95% 搬 | `echobot-client.ts` + `ai-service.ts` + `protocol.ts` 几乎 verbatim |
| **chat 渲染（markdown/代码块）** | ♻️ ~90% 搬 | `TextMessageBubble` 等只需去掉 IDE 点击副作用 |
| **gateway 进程管理（spawn/lock/自更新）** | ♻️ ~95% 搬 | `echobot_manager.rs` wholesale |
| **config / 日志 / 窗口控制 / 自更新 CI** | ♻️ ~90% 搬 | `config_manager.rs` / `log.rs` / `window.rs` / updater 套路 |

结论：**真正要从零造的只有"眼睛"（perception）和"召唤交互"（overlay/热键/托盘）两块**，其余全是 EchoWork 现成零件的搬运 + 解耦。

---

## 2. 核心新增：`echolens-perception` crate

这是整个产品的护城河，也是唯一需要认真写算法的部分。设计目标：**capture 层薄、平台相关；builder 层厚、平台无关、可纯单测**。

### 2.1 模块树

```
echolens-perception/                 # 独立 Rust crate（被 src-tauri 依赖）
├── Cargo.toml                       #   uiautomation = "0.25"（仅 capture 用）
├── src/
│   ├── lib.rs                       #   PerceptionContext::capture(scope) 对外唯一入口
│   ├── model.rs                     #   VisualNode —— 平台无关的 owned 中间模型（核心解耦点）
│   ├── error.rs                     #   PerceptionError
│   ├── capture/                     #   ★ 平台相关层（Windows-only，唯一碰 COM 的地方）
│   │   ├── mod.rs                   #     VisualSource trait（抽象，为未来跨平台留口）
│   │   └── windows.rs               #     uiautomation crate 实现：UIA 树 → VisualNode
│   └── builder/                     #   ★ 平台无关层（纯算法，可 #[cfg(test)] 单测，无 OS 依赖）
│       ├── mod.rs                   #     ContextBuilder::build(root, anchor, budget) -> String
│       ├── scoring.rs               #     元素评分：方向权重 × 距离衰减 × 类型权重
│       ├── traversal.rs             #     best-first 扩散 + 节点预算 + 深度限制
│       ├── prune.rs                 #     压缩术：单子容器折叠 / 连续 Label 合并 / 长文挖空
│       └── serialize.rs             #     VisualNode 子集 → 紧凑 XML（带 elementId）
└── tests/
    └── builder_tests.rs             #   builder 全套单测（喂手写 VisualNode，断言 XML 输出）
```

**关键设计决策（解耦）**：capture 层一旦把 COM 的 `CachedTree` 抽完，立刻转成自有的 `VisualNode`（纯 owned 数据，**不持有任何 COM 句柄**）。builder 层只吃 `VisualNode`，因此：
1. builder 可以脱离 Windows、脱离真实屏幕，用手写的 `VisualNode` 树做**纯单元测试**（评分/预算/压缩/序列化逻辑全部可验证）。
2. 未来要做 macOS（AX API）/ Linux（AT-SPI），只需新增一个 `capture/macos.rs` 产出同样的 `VisualNode`，builder 一行不改。

### 2.2 `model.rs` — 平台无关的中间模型

```rust
//! 平台无关的视觉元素模型。capture 层产出它，builder 层消费它。
//! 不含任何 COM/OS 句柄 —— 纯数据，可 Clone/Debug/序列化、可在单测里手搓。

/// 一个 UI 元素（已从 OS 无障碍树抽离，owned）。
#[derive(Debug, Clone)]
pub struct VisualNode {
    /// 稳定 id（来自 UIA runtime_id 的 hash，供 LLM「主动展开」时回引，见 §5.2）。
    pub id: u32,
    /// 控件类型（已归一化为跨平台枚举，而非 UIA 原始 ControlType）。
    pub role: Role,
    /// 元素名/文本（Name 属性；可能为空）。
    pub name: String,
    /// 屏幕坐标包围盒（用于评分的距离计算 + 截图兜底裁剪）。
    pub rect: Rect,
    /// 子节点（capture 时已按 UIA 子序填好）。
    pub children: Vec<VisualNode>,
}

/// 跨平台归一化的控件角色。映射表见 capture/windows.rs。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Window, Pane, Group, Text, Edit, Button, Link, List, ListItem,
    Tab, TabItem, MenuItem, CheckBox, Image, Table, Row, Cell, Document,
    Other,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Rect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }

impl Rect {
    /// 中心点（评分用）。
    pub fn center(&self) -> (i32, i32) { (self.x + self.w / 2, self.y + self.h / 2) }
    /// 面积（容器折叠判断用）。
    pub fn area(&self) -> i64 { self.w as i64 * self.h as i64 }
}

impl Role {
    /// 类型权重：文本 > 可交互 > 容器 > 图片。供 scoring 用。
    pub fn weight(self) -> f32 {
        match self {
            Role::Text | Role::Document | Role::Cell | Role::ListItem => 1.0,
            Role::Edit | Role::Button | Role::Link | Role::MenuItem
                | Role::Tab | Role::TabItem | Role::CheckBox          => 0.8,
            Role::List | Role::Table | Role::Row                     => 0.5,
            Role::Group | Role::Pane | Role::Window                  => 0.3,
            Role::Image                                              => 0.2,
            Role::Other                                              => 0.1,
        }
    }
    /// 是否是「纯容器」（无自身文本时可被折叠，见 prune.rs）。
    pub fn is_container(self) -> bool {
        matches!(self, Role::Group | Role::Pane | Role::Window | Role::List | Role::Table | Role::Row)
    }
}
```

### 2.3 `capture/` — 平台相关层（已验证配方）

#### 2.3.1 `capture/mod.rs` — trait 抽象

```rust
use crate::model::VisualNode;
use crate::error::PerceptionError;

/// 三种感知范围（对应产品文档 §3.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// 焦点元素 + 涟漪邻域（默认）。
    Focus,
    /// 整个前台窗口的元素树。
    Window,
    /// 所有可见顶层窗口的浅层概览。
    Screen,
}

/// 一次抓取的产物：根树 + 锚点 id（焦点元素，builder 以它为扩散中心）。
pub struct CaptureResult {
    pub root: VisualNode,
    /// 焦点锚点的 VisualNode.id；Screen scope 下为 None（无单一焦点）。
    pub anchor_id: Option<u32>,
}

/// 平台抽象：未来 macOS/Linux 各实现一份，产出同样的 VisualNode。
pub trait VisualSource {
    fn capture(&self, scope: Scope) -> Result<CaptureResult, PerceptionError>;
}
```

#### 2.3.2 `capture/windows.rs` — UIA 实现（核心配方，spike 已验证）

下面是 spike 实测、性能达标（48ms/150 节点）的配方，已对照 `uiautomation` v0.25 真实 API 签名：

```rust
use uiautomation::{UIAutomation, UIElement};
use uiautomation::types::{TreeScope, UIProperty, Point, Handle};
use uiautomation::controls::ControlType;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
use crate::model::{VisualNode, Role, Rect};
use crate::capture::{Scope, CaptureResult, VisualSource};

pub struct WindowsSource {
    automation: UIAutomation,
}

impl WindowsSource {
    pub fn new() -> Result<Self, PerceptionError> {
        Ok(Self { automation: UIAutomation::new()? })
    }

    /// 构建一次性 cache 请求：一次 COM 调用拉整棵子树的结构 + 属性。
    /// 这是 spike 验证的「正解」——零额外 IPC（对照实时遍历快 3 倍）。
    fn cache_request(&self) -> Result<uiautomation::UICacheRequest, PerceptionError> {
        let req = self.automation.create_cache_request()?;
        req.add_property(UIProperty::Name)?;
        req.add_property(UIProperty::ControlType)?;
        req.add_property(UIProperty::BoundingRectangle)?;
        req.set_tree_scope(TreeScope::Subtree)?;
        Ok(req)
    }
}

impl VisualSource for WindowsSource {
    fn capture(&self, scope: Scope) -> Result<CaptureResult, PerceptionError> {
        match scope {
            Scope::Window => self.capture_window(),
            Scope::Focus  => self.capture_focus(),
            Scope::Screen => self.capture_screen(),
        }
    }
}

impl WindowsSource {
    /// Window scope：抓整个前台窗口的子树。
    /// 用 GetForegroundWindow() 而非光标点 —— 召唤时前台窗口才是用户「正在看」的。
    fn capture_window(&self) -> Result<CaptureResult, PerceptionError> {
        let hwnd = unsafe { GetForegroundWindow() };
        let window: UIElement = self.automation.element_from_handle(Handle::from(hwnd))?;
        let req = self.cache_request()?;
        // ★ 一次 COM 调用缓存整棵子树（spike 实测 48ms/150 节点）
        let cached_root = window.build_updated_cache(&req)?;
        let root = convert_cached(&cached_root, &mut IdGen::default());
        Ok(CaptureResult { root, anchor_id: None })
    }

    /// Focus scope：以焦点元素为锚点，抓其所在窗口子树（builder 再做涟漪扩散）。
    /// anchor 让 builder 知道「从哪开始向外扩散」。
    fn capture_focus(&self) -> Result<CaptureResult, PerceptionError> {
        // get_focused_element 必须在「热键瞬间、overlay 显示前」调用，否则焦点已被 overlay 夺走。
        // 时序见 §3.4。这里假设调用方已在正确时机触发。
        let focused = self.automation.get_focused_element()?;
        let focus_runtime = focused.get_runtime_id().unwrap_or_default();

        // 向上找顶层窗口（spike 验证过的 walker 上溯法）
        let walker = self.automation.get_control_view_walker()?;
        let mut top = focused.clone();
        loop {
            match walker.get_parent(&top) {
                Ok(p) => { if walker.get_parent(&p).is_err() { break; } top = p; }
                Err(_) => break,
            }
        }

        let req = self.cache_request()?;
        let cached_root = top.build_updated_cache(&req)?;
        let mut idgen = IdGen::default();
        let root = convert_cached(&cached_root, &mut idgen);
        // 在已转好的 VisualNode 树里，按 runtime_id 找回焦点节点的 id 作锚点
        let anchor_id = find_anchor_id(&cached_root, &focus_runtime, &root);
        Ok(CaptureResult { root, anchor_id })
    }

    /// Screen scope：枚举所有顶层窗口，但每个只抓浅层（深度限制），合成一个虚拟根。
    fn capture_screen(&self) -> Result<CaptureResult, PerceptionError> {
        let root_el = self.automation.get_root_element()?;        // desktop
        let walker = self.automation.get_control_view_walker()?;
        let mut idgen = IdGen::default();
        let mut top_windows = Vec::new();
        if let Ok(first) = walker.get_first_child(&root_el) {
            let mut cur = first;
            loop {
                // 每个顶层窗口只抓浅层（深度 2~3），避免全量爆炸
                if let Ok(node) = capture_shallow(&cur, &mut idgen, 2) {
                    top_windows.push(node);
                }
                match walker.get_next_sibling(&cur) { Ok(n) => cur = n, Err(_) => break }
            }
        }
        let root = VisualNode {
            id: 0, role: Role::Other, name: "Desktop".into(),
            rect: Rect::default(), children: top_windows,
        };
        Ok(CaptureResult { root, anchor_id: None })
    }
}

/// 递归把已缓存的 UIA 子树转成 owned VisualNode（纯本地 get_cached_*，零 IPC）。
fn convert_cached(el: &UIElement, idgen: &mut IdGen) -> VisualNode {
    let node = VisualNode {
        id: idgen.next(),
        role: map_role(el.get_cached_control_type().unwrap_or(ControlType::Custom)),
        name: el.get_cached_name().unwrap_or_default(),
        rect: el.get_cached_bounding_rectangle().map(to_rect).unwrap_or_default(),
        children: Vec::new(),
    };
    let mut node = node;
    if let Ok(children) = el.get_cached_children() {
        for c in &children {
            node.children.push(convert_cached(c, idgen));
        }
    }
    node
}

/// UIA ControlType → 跨平台 Role 归一化。
fn map_role(t: ControlType) -> Role {
    match t {
        ControlType::Window                       => Role::Window,
        ControlType::Pane                         => Role::Pane,
        ControlType::Group                        => Role::Group,
        ControlType::Text                         => Role::Text,
        ControlType::Edit | ControlType::Document => Role::Edit,
        ControlType::Button                       => Role::Button,
        ControlType::Hyperlink                    => Role::Link,
        ControlType::List                         => Role::List,
        ControlType::ListItem                     => Role::ListItem,
        ControlType::Tab                          => Role::Tab,
        ControlType::TabItem                      => Role::TabItem,
        ControlType::MenuItem                     => Role::MenuItem,
        ControlType::CheckBox                     => Role::CheckBox,
        ControlType::Image                        => Role::Image,
        ControlType::Table | ControlType::DataGrid=> Role::Table,
        _                                         => Role::Other,
    }
}

fn to_rect(r: uiautomation::types::Rect) -> Rect {
    Rect { x: r.get_left(), y: r.get_top(), w: r.get_width(), h: r.get_height() }
}

/// 单调递增 id 生成器（同一次 capture 内稳定）。
#[derive(Default)]
struct IdGen(u32);
impl IdGen { fn next(&mut self) -> u32 { self.0 += 1; self.0 } }
```

> 注：`find_anchor_id` / `capture_shallow` 是辅助函数（按 runtime_id 比对 / 限深抓取），实现直接，文中省略。关键是上面三个 scope 入口与 `convert_cached` 配方，全部基于 spike 实测 + crate 真实 API。

#### 2.3.3 capture 层必补的盲区（来自 Everywhere 生产踩坑）

Everywhere 在生产里抽了几年 UIA，下面几个坑我们必须在 `capture/windows.rs` 里一开始就处理，否则数据质量会出问题：

| 盲区 | 问题 | 对策 |
|---|---|---|
| **DWM 窗口边界偏大** | Win10+ 顶层窗口有不可见阴影边距，UIA 的 `BoundingRectangle` 比"视觉边界"大一圈，导致评分的距离计算偏差 | 顶层窗口（有 `native_window_handle`）的 rect 改用 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 取视觉边界，而非 UIA rect |
| **Password 元素泄漏** | 密码框的内容/名字可能被抽进树发给 LLM | 读 `IsPassword`（`CurrentIsPassword`）属性，命中则 `name` 置空 + role 标 `Edit`，**绝不抽文本**（呼应 §6 隐私） |
| **Name 取不全** | 部分控件 `Name` 为空但有可读文本 | `name` 取值三级 fallback：`Name` → `ValuePattern.Value` → `LegacyIAccessiblePattern.Name`（Everywhere 实测顺序） |
| **装饰节点噪声** | RawView walker 会抽进一堆分隔符/装饰元素，污染树 | 用 `ContentViewWalker`（而非 RawView），UIA 自动过滤装饰性/不可见节点——免费的一层裁剪 |
| **RuntimeId 跨快照不稳定** | UIA RuntimeId 在元素销毁后会被复用，不能跨两次 capture 当稳定 id | 我们的 `id` 是**单次 capture 内**的单调序号（`IdGen`），只在一次感知会话内有效；主动展开（v1.5）的 elementId 也只在同一棵树内回引——不跨快照 |
| **COM 属性随时失效** | 元素所在窗口可能在抽取中途关闭，属性访问抛 COM 异常 | 每个 `get_cached_*` 都已是 `Result`，全程 `.unwrap_or_default()` 降级（spike 配方已如此）。注：`build_updated_cache` 缓存命中的属性不发 COM 调用、不会失败，这正是我们缓存路线相对 Everywhere「逐属性 live 调用」的**架构优势** |

> **路线差异说明（重要）**：Everywhere 生产用的是**实时 TreeWalker 懒遍历 + 逐属性 live COM 调用**，靠 best-first 提前剪枝来"少访问节点"；它**没有用** `build_updated_cache`。我们 spike 验证的是**一次性缓存子树 + 本地零成本递归**。两者正交：
> - 我们的路线在"子树不大、要读全"时更快（一次 COM 往返 vs N 次）。
> - 它的路线在"树巨大、只要焦点附近一小撮"时更省（根本不碰无关分支）。
>
> **本方案选择"缓存 + 裁剪"混合**：先 `build_updated_cache(Subtree)` 把焦点窗口子树一次性拉进本地内存（48ms），再在内存里跑 builder 的 best-first 评分裁剪。COM 往返 = O(1)，评分/压缩/序列化全在本地——拿到了两条路线各自的优势。代价：Window scope 下若窗口极大（数千节点）缓存本身会变慢，此时可退化为「`build_updated_cache(Subtree, depth=N)` 限深缓存焦点邻域」。

### 2.4 `builder/` — 平台无关的上下文构建（核心算法）

spike 数据证明这层"必需"：582 节点全量序列化要 1.25s 且 token 爆炸，必须裁剪到 ~120 节点。builder 全部吃 `VisualNode`、不碰 OS，因此可纯单测。

#### 2.4.1 `builder/scoring.rs` — 元素评分

```rust
use crate::model::{VisualNode, Role};

/// 评分上下文：锚点中心 + 屏幕对角线（距离归一化用）。
pub struct ScoreCtx {
    pub anchor_center: (i32, i32),
    pub screen_diag: f32,
}

/// 双距离（借鉴 Everywhere 的 TraverseDistance，防止「换方向后无限钻」）：
///   global = 离锚点多远（跨方向累加，全局惩罚）
///   local  = 离当前发起节点多远（同方向累加；换方向时归 1）
/// 涟漪是「换方向要付代价」的——从兄弟节点又往下钻 child 时 local 重置但 global 继续涨。
#[derive(Clone, Copy)]
pub struct Distance { pub global: u32, pub local: u32 }

/// 给一个节点打分：决定 best-first 扩散时谁先被纳入预算。
/// 公式（对照 Everywhere 生产实测 + 产品文档 §4.2.2）：
///   topology = 方向基础分 / local 距离 − (global − local) 全局距离惩罚
///   final    = topology × 类型权重
/// ★ 注意：兄弟方向「不乘类型权重」——否则一个低权重兄弟会挡住它后面所有兄弟的枚举
///   （这是用枚举器实现 best-first 才会遇到的微妙坑，Everywhere 注释明确踩过）。
pub fn score(node: &VisualNode, ctx: &ScoreCtx, dir: Direction, dist: Distance) -> f32 {
    let topology = dir.base_score() / dist.local.max(1) as f32
                   - (dist.global.saturating_sub(dist.local)) as f32;
    if matches!(dir, Direction::PrevSibling | Direction::NextSibling) {
        topology                              // 兄弟方向：不乘类型权重
    } else {
        topology * node.role.weight()         // 父/子方向：乘类型权重
    }
}

/// 四个扩散方向（不是笼统的"兄弟/父/子"，而是分前兄/后兄，与 Everywhere 一致）。
#[derive(Clone, Copy)]
pub enum Direction { Parent, PrevSibling, NextSibling, Child }
impl Direction {
    /// 方向基础分：兄弟 > 父 > 子（同级上下文最相关，Everywhere 实测值同量级）。
    pub fn base_score(self) -> f32 {
        match self {
            Direction::PrevSibling | Direction::NextSibling => 10000.0,  // 兄弟最相关
            Direction::Parent                               => 2000.0,
            Direction::Child                                => 1000.0,
        }
    }
}
```

> ⚠️ **两个来自 Everywhere 的反直觉教训（必须吸收）**：
> 1. **别用 rect 面积做权重**。Everywhere 试过用元素面积加权，但因 UIA `BoundingRectangle` 经常不可靠（容器自身 rect 无效但子节点有效）而**主动放弃并注释警告**。我们的 `score` 也只用距离 + 类型，不碰面积。
> 2. **兄弟方向不乘类型权重**（见上 `score` 注释），否则枚举会被低权重兄弟提前掐断。

#### 2.4.2 `builder/traversal.rs` — best-first 扩散 + 节点预算

```rust
use std::collections::BinaryHeap;
use crate::model::VisualNode;
use crate::builder::scoring::{score, ScoreCtx, Direction};

/// 抓取预算 —— ★ 用 token 预算而非节点数（借鉴 Everywhere 的核心正确决策）。
///
/// 为什么不是节点数：喂给 LLM 的真正约束是 token，一个富文本节点（一段长文）
/// 可能顶 50 个空 panel。按节点数裁剪会在「焦点旁边正好是大段文本」时爆 context，
/// 或在「全是空容器」时浪费预算。Everywhere 生产实测验证了这点（按 token 截断）。
pub struct Budget {
    pub max_tokens: usize,     // 默认按档位：Minimal 1024 / Balanced 4096 / Detailed 10240
    pub max_depth: usize,      // 深度仍留软上限做兜底，默认 ~16
}
impl Default for Budget {
    fn default() -> Self { Self { max_tokens: 4096, max_depth: 16 } }
}

/// 单节点的 token 成本估算（纯本地，无需真 tokenizer）：
///   结构成本（标签 + 属性，~3 token）+ 内容成本（name/text 长度 / 4，英文经验值）。
/// 精度足够裁剪用；要更准可换 tiktoken o200k_base（Everywhere 用的就是真 tokenizer）。
pub fn node_token_cost(node: &VisualNode) -> usize {
    let struct_cost = 3;
    let text_cost = node.name.chars().count() / 4;
    struct_cost + text_cost
}

/// 扩散结果：被选中的节点 id 集合 + 是否有 omitted（截断提示用）。
pub struct Selection {
    pub kept: std::collections::HashSet<u32>,
    pub omitted: usize,
}

/// best-first：从锚点出发，按评分优先级把节点纳入预算，token 累加超限即停。
/// 没有锚点（Window/Screen scope）时退化为「从根 BFS + 评分」。
pub fn select(root: &VisualNode, anchor_id: Option<u32>, budget: &Budget, ctx: &ScoreCtx) -> Selection {
    // 优先队列里放 (评分, 节点引用, 方向, 距离)。Rust BinaryHeap 是大顶堆，正好要高分先出。
    // 实现要点（借鉴 Everywhere VisualContextBuilder.Traversal 的成熟算法）：
    //   1. 锚点及其祖先链「无条件纳入」（保证上下文锚定，焦点元素 score = +∞ 最先出队）
    //   2. 出队一个节点 → 累加它的 node_token_cost；累计超 max_tokens 即停
    //   3. 出队后向「四个方向」扩散邻域入堆：父 / 前兄 / 后兄 / 子（不是笼统的"邻居"）
    //   4. 队列里没来得及处理的节点 → 其父标记 HasOmittedChildren，序列化时输出 expand 提示
    //   5. 深度超 max_depth 的分支软剪（兜底，正常靠距离衰减自然淘汰远处节点）
    // 完整实现见单测对照（builder_tests.rs）。
    todo!("best-first expansion —— 纯算法，单测覆盖")
}
```

> traversal 是 builder 里唯一稍复杂的算法，但它**完全平台无关**：输入是手搓的 `VisualNode` 树，输出是 id 集合，单测直接断言"给定这棵树 + 这个预算，选中了哪些节点"。这是把它放在平台无关层的全部理由。

#### 2.4.3 `builder/prune.rs` — 压缩术

```rust
use crate::model::{VisualNode, Role};

/// 三种压缩（在序列化前对「被选中的子树」做）：
/// 1. 单子容器折叠：Group 只有一个孩子且自身无 name → 跳过该层，直接挂孩子
/// 2. 连续 Label 合并：相邻多个 Text 节点 → 合并成一个（用空格连接）
/// 3. 超长文本中段挖空："前 200 字…[省略 N 字]…后 200 字"
pub fn prune(node: &mut VisualNode) {
    collapse_single_child_containers(node);
    merge_adjacent_text(node);
    truncate_long_text(node, 500);   // 单节点文本超 500 字符即挖空
}

fn collapse_single_child_containers(node: &mut VisualNode) {
    for c in &mut node.children { collapse_single_child_containers(c); }
    // 自顶向下：若本节点是纯容器、无 name、恰好一个孩子 → 用孩子替换自己
    if node.role.is_container() && node.name.is_empty() && node.children.len() == 1 {
        let child = node.children.remove(0);
        *node = child;
    }
}
// merge_adjacent_text / truncate_long_text 同理，纯字符串处理，全可单测。
```

#### 2.4.4 `builder/serialize.rs` — 紧凑 XML 输出

```rust
use crate::model::{VisualNode, Role};
use crate::builder::traversal::Selection;

/// 把「被选中的子树」序列化成紧凑 XML（LLM 最易读），带 elementId 供主动展开。
/// 产品文档 §4.2.3 的输出样例就是它产的。
pub fn to_xml(root: &VisualNode, sel: &Selection) -> String {
    let mut out = String::new();
    write_node(&mut out, root, sel, 0);
    if sel.omitted > 0 {
        out.push_str(&format!(
            "  <!-- {} more elements omitted; use expand(elementId=N) -->\n", sel.omitted));
    }
    out
}

fn write_node(out: &mut String, node: &VisualNode, sel: &Selection, depth: usize) {
    if !sel.kept.contains(&node.id) { return; }
    let indent = "  ".repeat(depth);
    let tag = role_tag(node.role);
    let name_attr = if node.name.is_empty() { String::new() }
                    else { format!(" name={:?}", node.name) };
    // 纯文本类节点：用 <text>内容</text> 形式，比属性更省 token
    if matches!(node.role, Role::Text | Role::Document) && !node.name.is_empty() {
        out.push_str(&format!("{}<text>{}</text>\n", indent, xml_escape(&node.name)));
        return;
    }
    let has_kept_children = node.children.iter().any(|c| sel.kept.contains(&c.id));
    if has_kept_children {
        out.push_str(&format!("{}<{}{} id=\"{}\">\n", indent, tag, name_attr, node.id));
        for c in &node.children { write_node(out, c, sel, depth + 1); }
        out.push_str(&format!("{}</{}>\n", indent, tag));
    } else {
        out.push_str(&format!("{}<{}{} id=\"{}\"/>\n", indent, tag, name_attr, node.id));
    }
}

fn role_tag(r: Role) -> &'static str {
    match r {
        Role::Window => "window", Role::Button => "button", Role::Link => "link",
        Role::Edit => "edit", Role::Tab | Role::TabItem => "tab", Role::List => "list",
        Role::ListItem => "item", Role::Group | Role::Pane => "group",
        Role::Image => "image", Role::Table => "table", Role::Row => "row",
        Role::Cell => "cell", Role::MenuItem => "menuitem", Role::CheckBox => "checkbox",
        Role::Text | Role::Document => "text", _ => "node",
    }
}
```

输出长这样（与产品文档 §4.2.3 一致）：

```xml
<window name="Release All · EchoWorker/EchoAIStore" id="1">
  <tab name="Tab bar" id="3">
    <text>Summary</text>
    <button name="Re-run all jobs" id="7"/>
    <group name="Jobs" id="9">
      <text>build (windows) — failed</text>
      <text>build (macos) — success</text>
    </group>
  </tab>
  <!-- 47 more elements omitted; use expand(elementId=9) -->
</window>
```

### 2.5 `lib.rs` — 对外唯一入口

```rust
mod model; mod error; mod capture; mod builder;
pub use model::{VisualNode, Role, Rect};
pub use capture::Scope;
pub use error::PerceptionError;

use builder::traversal::Budget;

/// 一次感知的最终产物（供 src-tauri 命令直接 emit 给前端）。
pub struct PerceptionResult {
    /// 喂给 LLM 的紧凑 XML（被包进 <screen_context>）。
    pub xml: String,
    /// 实际纳入的节点数（UI 显示「已感知 N 个元素」）。
    pub node_count: usize,
    /// 被省略的节点数（>0 时提示「还有更多，可主动展开」）。
    pub omitted: usize,
}

/// 产品入口：给定 scope，抓屏 → 裁剪 → 序列化。
/// 平台分发在内部：Windows 走 WindowsSource，未来 macOS/Linux 各自实现。
pub fn capture(scope: Scope) -> Result<PerceptionResult, PerceptionError> {
    #[cfg(windows)]
    let source = capture::windows::WindowsSource::new()?;
    #[cfg(not(windows))]
    compile_error!("EchoLens perception is Windows-only for now (see PRODUCT_DESIGN §1.3)");

    use capture::VisualSource;
    let cap = source.capture(scope)?;
    let budget = Budget::default();

    // builder 全程平台无关
    let ctx = builder::scoring::ScoreCtx::from_capture(&cap);
    let mut tree = cap.root;
    builder::prune::prune(&mut tree);
    let sel = builder::traversal::select(&tree, cap.anchor_id, &budget, &ctx);
    let xml = builder::serialize::to_xml(&tree, &sel);

    Ok(PerceptionResult {
        node_count: sel.kept.len(),
        omitted: sel.omitted,
        xml,
    })
}
```

### 2.6 单测边界（builder 全覆盖）

`tests/builder_tests.rs` 喂手搓的 `VisualNode` 树，断言：
- **scoring**：近锚点的兄弟文本分 > 远处容器分；类型权重生效（Text > Button > Group > Image）；兄弟方向不乘类型权重（低权重兄弟不掐断后续兄弟枚举）。
- **traversal**：token 预算 = N 时累加到刚好不超 N 即停，剩余节点 omitted = 总数 - kept；锚点祖先链无条件保留；超深分支被软剪。
- **prune**：单子容器折叠掉一层；相邻 3 个 Text 合并成 1 个；600 字文本被挖成"前 200…省略…后 200"。
- **serialize**：给定 Selection，输出 XML 结构正确、含 elementId、omitted 注释出现。

这些**不需要真实屏幕、不需要 Windows**，`cargo test -p echolens-perception` 在任何平台都能跑（capture 层用 `#[cfg(windows)]` 隔离，单测只测 builder）。

---

## 3. Tauri 外壳：复用 + 净新增

EchoLens 的 Rust 后端 = **搬 EchoWork 的 gateway 管理/配置/日志/窗口控制** + **从零造热键/托盘/overlay 窗口**。

### 3.1 复用清单（从 EchoWork 搬，逐文件）

| 文件（EchoWork `src-tauri/src/`） | 处置 | 说明 |
|---|---|---|
| `echobot_manager.rs`（466 行）| ♻️ **wholesale** | gateway 进程的 spawn-detached + `gateway.lock` 轮询 + bundled 自更新。这是复用这套外壳的**全部理由**。函数 `gateway_lock_path`/`find_echoai_exe`/`deploy_echoai_if_needed`/`spawn_detached`/`echobot_start_gateway` 全部照搬（已核实存在） |
| `config_manager.rs`（379 行）+ `config_types.rs` | ♻️ 改路径 | `~/.echoai` 配置目录解析、读写 `echocode.toml`。EchoLens 不需要 workspace 配置，可裁剪到只读 gateway 相关 |
| `window.rs`（33 行）| ♻️ verbatim | `window_minimize/maximize/close`——给设置窗的自定义标题栏用 |
| `log.rs`（88 行）| ♻️ verbatim | tracing → `~/.echoai/logs` 按日滚动 + 7 天清理 |
| `menu.rs`（64 行）| ♻️ verbatim | macOS 应用菜单（Windows 上 no-op，无害） |
| `screenshot.rs`（49 行）+ `xcap` 依赖 | ♻️ verbatim | **给 M6 图片兜底用**——图片类元素转截图喂多模态 |
| `main.rs`（7 行）| ♻️ verbatim | 入口 + `windows_subsystem="windows"` |
| `lib.rs`（161 行）| ♻️ 作骨架改 | `tauri::Builder` 注册插件/状态/命令的模板，EchoLens 在此基础上**加**热键/托盘/overlay（见 §3.3） |
| `windows/hooks.nsh` | ♻️ 改进程名 | NSIS pre-install 杀旧进程（`EchoLens.exe` + `echoai.exe`） |
| `capabilities/default.json` | ♻️ 加 overlay 窗口 | 权限文件，需把 overlay 窗口 label 加进 `windows` 白名单 |
| `tauri.conf.json` 的 updater/bundle 块 | ♻️ 改 endpoint | updater 指向 EchoAIStore 的 `echolens-latest`（见 §7.4） |
| `git.rs` / `ext_manager.rs` / `watcher.rs` / `fs.rs` / 大部分 `mcp.rs` | ❌ 跳过 | IDE 专属，EchoLens 不需要 |

### 3.2 净新增依赖

`src-tauri/Cargo.toml` 在 EchoWork 基础上**加**：

```toml
[dependencies]
# ...（沿用 EchoWork 的 tauri / tauri-plugin-{dialog,fs,shell,updater,process} / serde / tokio / sysinfo / xcap ...）
tauri-plugin-global-shortcut = "2"     # 🆕 全局热键（EchoWork 完全没有）
tauri-plugin-single-instance = "2"     # 🆕 单实例（热键聚焦已有实例，避免多开）
window-vibrancy = "0.5"                 # 🆕 overlay 毛玻璃（acrylic/mica），借鉴 Everywhere AcrylicBlur
echolens-perception = { path = "../echolens-perception" }   # 🆕 自研感知 crate

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_UI_Input_KeyboardAndMouse",
    "Win32_UI_WindowsAndMessaging",    # GetForegroundWindow / SetWindowPos（capture + cloak 用）
    "Win32_Graphics_Dwm",              # DwmSetWindowAttribute(DWMWA_CLOAK)（§3.6.1 瞬现隐藏）
] }
```

> 已核实：EchoWork 的 Cargo.lock/Cargo.toml/package.json/全部源码里 **没有任何** `global-shortcut`/`single-instance`/`tray`/`TrayIconBuilder` 痕迹——这三块是真·从零。

### 3.3 净新增：`lib.rs` setup 注册骨架

```rust
use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

pub fn run() {
    tauri::Builder::default()
        // 🆕 单实例：第二次启动只是「触发热键」，不开新窗
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = toggle_overlay(app.clone());
        }))
        // ♻️ 沿用 EchoWork 的 5 个插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // 🆕 全局热键插件 + handler
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && is_summon_hotkey(shortcut) {
                        // ★ 关键时序：handler 里「先 capture 再 show」，见 §3.4
                        on_summon(app.clone());
                    }
                })
                .build(),
        )
        .manage(EchoLensState::default())          // spawning guard + 最近一次感知结果缓存
        .invoke_handler(tauri::generate_handler![
            // ♻️ gateway 管理（搬 echobot_manager.rs）
            echobot_start_gateway, echobot_stop_gateway, echobot_restart_gateway,
            // ♻️ 窗口控制（搬 window.rs）
            window_minimize, window_maximize, window_close,
            // ♻️ 配置 / 日志（搬 config_manager.rs / log.rs）
            config_check, config_read_echocode, config_write_echocode, log_write,
            // 🆕 EchoLens 独有命令
            capture_perception,      // 跑感知，返回 PerceptionResult（XML + 计数）
            toggle_overlay,          // 显示/隐藏 overlay
            hide_overlay,            // Esc 收起
            set_summon_hotkey,       // 设置页改热键
        ])
        .setup(|app| {
            // 🆕 注册默认热键（可被设置覆盖，见 §3.5）
            register_summon_hotkey(app, default_hotkey())?;
            // 🆕 建托盘
            build_tray(app)?;
            // 🆕 预建 overlay 窗口（隐藏态，热键时 show——比每次新建快）
            build_overlay_window(app)?;
            // ♻️ gateway 在前端 checkConfig 通过后由 invoke 拉起（沿用 EchoWork 时序）
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running EchoLens");
}

/// 🆕 程序化创建 overlay 窗口（EchoWork 只有静态 JSON 窗口，这是净新增）。
/// transparent + 无边框 + 置顶 + 不进任务栏 + 不可缩放 = Spotlight 风格。
/// 注：窗口建好后立即 set_cloaked(true) 隐身（§3.6.1），召唤时 uncloak——比 show/hide 顺滑。
fn build_overlay_window(app: &tauri::App) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html".into()))
        .title("EchoLens")
        .inner_size(720.0, 480.0)
        .decorations(false)        // 无系统标题栏
        .transparent(true)         // 透明背景（圆角浮层 + 毛玻璃，前端 window-vibrancy 可加 acrylic）
        .always_on_top(true)       // 盖在所有 App 上
        .skip_taskbar(true)        // 不出现在任务栏 / Alt+Tab
        .resizable(false)
        .center()
        .focused(false)            // 见 §3.4：不立刻夺焦，等 capture 完
        .build()?;
    // 建好即隐身（DWM cloak），召唤时 uncloak
    if let Ok(hwnd) = w.hwnd() { set_cloaked(HWND(hwnd.0), true); }
    Ok(())
}

/// 🆕 托盘：左键 toggle overlay，右键菜单（设置/退出）。
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 EchoLens", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "settings" => { open_settings_window(app); }
            "quit"     => { app.exit(0); }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击 = toggle overlay
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                let _ = toggle_overlay(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}
```

### 3.4 ★ 关键落地坑：capture 时序（产品文档没提）

这是整个产品**最容易翻车**的地方，必须在热键 handler 里严格按序：

```
用户按下热键（如 Ctrl+Shift+Space）
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ on_summon(app)  —— 全部在 overlay 显示「之前」完成        │
│                                                          │
│  1. snapshot = GetForegroundWindow()                     │ ← 此刻前台仍是用户的 App
│     focused  = get_focused_element()                     │   （overlay 还没抢焦点）
│                                                          │
│  2. result = echolens_perception::capture(scope)         │ ← 用 snapshot/focused 抓树
│     （48ms，用户无感）                                     │
│                                                          │
│  3. state.last_perception = result                       │ ← 缓存，供前端 invoke 拉取
│                                                          │
│  4. overlay.show() + overlay.set_focus()                 │ ← 现在才显示并夺焦
│     overlay.emit("perception-ready", result.summary)     │   前端渲染输入条 + 感知预览
└─────────────────────────────────────────────────────────┘
```

**为什么必须这个顺序**（两个致命问题）：
1. **overlay 自己会进 UIA 树**：如果先 `show()` 再 capture，`GetForegroundWindow()` 返回的就是 EchoLens overlay 自己，抓到一堆"输入框/回答卡"垃圾，而不是用户原本在看的 App。
2. **焦点被夺走**：`get_focused_element()`（Focus scope 用）一旦 overlay 显示就指向 overlay 的输入框，焦点锚点全错。

所以 `build_overlay_window` 里 `.focused(false)` + handler 里"先 capture 后 show"是**硬约束**，不是优化。

```rust
fn on_summon(app: tauri::AppHandle) {
    // 1+2+3：抓屏（overlay 尚未显示，前台仍是用户 App）
    let scope = current_default_scope(&app);          // 从设置读，默认 Window
    let result = match echolens_perception::capture(scope.into()) {
        Ok(r) => r,
        Err(e) => { log_capture_error(e); return; }   // 抓失败也别弹空窗
    };
    let state = app.state::<EchoLensState>();
    *state.last_perception.lock().unwrap() = Some(result.clone());

    // 4：现在才显示 + 夺焦 + 通知前端
    //    ★ 用 DWM Cloak（§3.6.1）而非 show()，瞬现无动画、焦点更稳
    if let Some(w) = app.get_webview_window("overlay") {
        if let Ok(hwnd) = w.hwnd() { set_cloaked(HWND(hwnd.0), false); }
        let _ = w.set_focus();
        let _ = w.emit("perception-ready", PerceptionSummary::from(&result));
    }
}
```

### 3.5 命令清单（前端可 invoke）

| 命令 | 签名 | 来源 | 说明 |
|---|---|---|---|
| `capture_perception` | `(scope: String) -> Result<PerceptionResult, String>` | 🆕 | 前端切 scope 后重抓；返回 XML + 计数 + omitted |
| `toggle_overlay` | `() -> Result<(), String>` | 🆕 | 托盘点击 / 第二实例触发 |
| `hide_overlay` | `() -> Result<(), String>` | 🆕 | Esc 收起 |
| `set_summon_hotkey` | `(accelerator: String) -> Result<(), String>` | 🆕 | 设置页改热键，重新 register |
### 3.6 ★ Windows 交互细节：借鉴 Everywhere 生产实现

> 产品文档 §0 关联调研的 `Sylinko/Everywhere`（.NET 10 + Avalonia，BSL-1.1）是同类产品里把 Windows 召唤式交互做得最成熟的。**只借鉴思路、用 Rust 重写**（BSL-1.1 不可抄码，但这些手法都是公开的 Win32 工程常识）。本节把它的真实做法翻译成 EchoLens 的实现要点——这些是我读了它 `Everywhere.Windows/Interop/` 源码后**修正/强化**的设计。

#### 3.6.1 召唤窗用 DWM Cloak「瞬现/瞬隐」，而非 show/hide

Everywhere 的召唤窗（`ChatWindow`）**从不真正关闭**：常驻 + 预加载，靠 **`DwmSetWindowAttribute(DWMWA_CLOAK)`** 实现"唰一下出现/消失"。这比 `show()/hide()` 更好：

| | `show()/hide()`（我原方案） | DWM Cloak（升级方案） |
|---|---|---|
| 显隐速度 | webview 可能重排/重绘，有微延迟 | 瞬时，窗口一直活着 |
| 系统动画 | 可能触发最小化/还原动画 | 无任何动画，纯 Spotlight 感 |
| 任务栏 | 需 `skip_taskbar` 压制 | cloak 时天然不闪烁 |
| 焦点抖动 | hide 时焦点归属可能乱跳 | cloak + `SetWindowPos(HWND_BOTTOM)` 沉底，干净 |

**EchoLens 实现**：overlay 窗启动即建好（`visible:true` 但立刻 cloak），召唤 = uncloak，收起 = cloak。Tauri 没有内置 cloak API，在 Rust 侧用 `windows` crate 调：

```rust
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
use windows::Win32::Foundation::{HWND, BOOL};

/// cloak=true 隐藏（瞬隐），false 显示（瞬现）。比 Tauri show/hide 更顺滑。
fn set_cloaked(hwnd: HWND, cloak: bool) {
    let v: BOOL = cloak.into();
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd, DWMWA_CLOAK,
            &v as *const _ as *const _, std::mem::size_of::<BOOL>() as u32,
        );
    }
    if cloak {
        // 沉底，避免 cloak 残留挡点击（Everywhere 的做法）
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_BOTTOM, SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE};
        unsafe { let _ = SetWindowPos(hwnd, HWND_BOTTOM, 0,0,0,0, SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE); }
    }
}
```

> `on_summon` 的第 4 步从 `w.show()` 改为 `set_cloaked(hwnd, false) + w.set_focus()`；`hide_overlay` 从 `w.hide()` 改为 `set_cloaked(hwnd, true)`。overlay 窗 `build_overlay_window` 里 `.visible(true)` + setup 末尾立即 `set_cloaked(true)`。

#### 3.6.2 全局热键：`RegisterHotKey` 优先 + 低级钩子降级

Everywhere 的热键是**双路径**：先 `RegisterHotKey`（系统级原子，干净、低开销），**失败**（被别的 App 抢注）才降级到 `WH_KEYBOARD_LL` 低级钩子。MVP 我们先用 `tauri-plugin-global-shortcut`（底层就是 `RegisterHotKey`），但要知道两个坑，留作 v1.5 增强：

| 坑 | Everywhere 的解法（留作增强） |
|---|---|
| **热键被其他 App 抢注** → `RegisterHotKey` 失败 | 降级 `SetWindowsHookEx(WH_KEYBOARD_LL)`，钩子里手动比对组合键（100% 拿得到，代价是侵入性高） |
| **Win 键组合松开弹出开始菜单** | 钩子里注入一个假 KeyUp（VK 0xFF）抵消 |
| **钩子自注入回环** | 用 `dwExtraInfo` 魔数标记自己注入的事件并过滤 |
| **钩子必须独立线程跑消息循环** | 否则超时被系统摘除 |

> MVP 决策：用插件的 `RegisterHotKey` 路径即可（默认 `Ctrl+Shift+Space` 冲突概率低）。若用户反馈热键被吞，再上低级钩子降级（这是 v1.5 的 `set_summon_hotkey` 增强项，非 MVP 阻塞）。

#### 3.6.3 capture 时序 — Everywhere 印证了我的判断

我在 §3.4 写的"先抓屏后显示窗口"时序坑，**正是 Everywhere 的真实做法**：它在热键回调里**先**同步调 UIA `GetFocusedElement()` 抓住目标元素，**再** `Dispatcher.Post` 到 UI 线程显示窗口。两个额外印证：
- 它**不用 `GetForegroundWindow` 也不用 `SetWinEventHook`** 追前台——纯靠"热键回调时前台还没切走"这个时序窗口，同步抓 UIA 焦点。我们 Window scope 用 `GetForegroundWindow` 是等价手段（都在显示窗口前取），保留。
- 它显示后会 `chatWindowHandle == hWnd` 判断**防止选中自己**——我们 §2.3.2 `capture_focus` 里 `if chat_window_handle == hwnd { element = None }` 应补这个自检（防极端情况下抓到自己）。

#### 3.6.4 托盘 + Pin 三态（交互增强，M4）

Everywhere 的两个交互细节值得抄进 M4：
- **托盘单击 = 召唤 overlay，双击 = 打开设置**（300ms 去抖区分）。比"左键 toggle / 右键菜单"更顺手。
- **Pin 三态**（`IsWindowPinned: bool?`）：`true`=钉住且置顶 / `null`=钉住不置顶 / `false`=不钉、**失焦即自动 cloak 收起**。再加一条"**一开始输入就自动钉住**"（PinOnInput）——防止用户打字时不小心点别处导致浮层消失。这套交互直接映射到 EchoLens：`WindowEvent::Focused(false)` 时若非 pin 则 `set_cloaked(true)`。

#### 3.6.5 划词即问（Text Selection，v1.5 非 MVP）

Everywhere 有一套**生产级**的"选中文字后快速召唤"：`WH_MOUSE_LL` 钩子检测拖拽/双击/Shift+Click 选区 → 优先 UIA `TextPattern` 取选中文本 → 失败回退"备份剪贴板 → 模拟 Ctrl+Insert/Ctrl+C → 读取 → 还原剪贴板"，外加一长串应用黑名单和"防止干扰用户自己复制"的判断。这是中文 Windows 桌面"划词"绕不开的脏活。**MVP 不做**，但记录为 v1.5 的高价值增强（思路可借鉴，代码须重写）。

#### 3.6.6 开机自启（M4 可选）

Everywhere 双轨：普通用户写注册表 `HKCU\...\Run` 键（值 `"exe" --autorun`）；管理员用任务计划程序（`schtasks` + `RunLevel=HighestAvailable`）。EchoLens MVP 用注册表 Run 键即可（最简单）。⚠️ 若将来用任务计划"最高权限"自启 + 加密存 API key，会踩 DPAPI 1312 坑（需 `LoadUserProfileW`）——这是 Everywhere `Program.cs` 里专门处理的，记录备查。

---

## 4. 前端：Spotlight overlay UI

前端 = **搬 EchoWork 的 gateway client + chat 渲染** + **从零造 overlay 交互壳**。技术栈完全对齐 EchoWork：React 18 + Vite + Tailwind 3.4 + Zustand 5 + react-markdown 10。

### 4.1 gateway 层复用（verbatim / 极小改）

来自实仓核实（三大 gateway 文件**零 IDE 耦合**）：

| 文件（EchoWork `src/`）| 处置 | 说明 |
|---|---|---|
| `types/protocol.ts`（173 行）| ♻️ **verbatim** | 纯类型，零依赖。可选裁掉 Skill/Channel 类型 |
| `core/echobot-client.ts`（772 行）| ♻️ **verbatim** | WebSocket/JSON-RPC 客户端 + `dispatchChatEvent` 解码器。整套搬 |
| `core/event-bus.ts` | ♻️ verbatim | EchoBotClient 构造依赖，tiny |
| `core/ai-service.ts`（183 行）| ♻️ **verbatim** | ★ 现成的"发 prompt → 流式收文本"API，临时 session + 私有监听，**零 IDE 耦合**。EchoLens 的主用 API |
| `core/logger.ts` | ♻️ 降级 | 可 stub 成 `console`，去掉 Tauri 依赖 |
| `bridges/auto-connect.ts` → **只抽 `readGatewayLock()`** | ♻️ 抽 1 函数 | 读 `~/.echoai[.dev]/gateway.lock` 拿 `{url, token}`（已核实导出） |
| `core/connection-controller.ts`（174 行）| ♻️ 自带 deps | DI 设计，注入自己的回调：`syncSessions` 传 no-op、`getPluginName` 返回 `'echolens'`（已核实 `ConnectionControllerDeps` 接口） |

**最小连通代码**（EchoLens 启动时）：

```ts
import { EchoBotClient } from './core/echobot-client'
import { EventBus } from './core/event-bus'
import { AIService } from './core/ai-service'
import { readGatewayLock } from './core/gateway-lock'   // 抽自 auto-connect.ts

const bus = new EventBus()
const client = new EchoBotClient(bus)
const lock = await readGatewayLock()                    // {url, token}
client.setCredentials(lock.token, 'echolens', '')       // ★ pluginName = 'echolens'
await client.connect(lock.url)
await client.authenticate()                             // auth + plugin.connect
export const ai = new AIService(client)
```

### 4.2 chat 渲染复用（去掉 IDE 点击副作用）

来自实仓核实——IDE 耦合极浅，集中在"点链接打开预览面板""按 workspace 解析路径"两处副作用：

| 组件（EchoWork `src/`）| 处置 | 改动 |
|---|---|---|
| `modules/chat-panel/TextMessageBubble.tsx` | ♻️ **改 3 处** | ① 删 `import { openFileInPreview }`（L28）② 删 `resolveFilePath`/`useWorkspaceStore` 来源的 `baseDir`（L29-30,66）改为 prop 或省略 ③ `handleLinkClick`（L42-49）去掉"文件路径→预览"分支，只保留 http(s) 外开。已核实这 3 个符号都在 |
| `components/CodeBlock.tsx` | ♻️ verbatim | 复制按钮 + 语言标签，拉入 `MermaidDiagram`/`HtmlSandbox`，零 IDE 依赖 |
| `components/Callout.tsx` / `MermaidDiagram.tsx` / `HtmlSandbox.tsx` / `ImageLightbox.tsx` | ♻️ verbatim | 纯展示，CSS-var 样式 |
| `lib/remark-callout.ts` / `lib/sanitize-schema.ts` | ♻️ verbatim | 纯函数 markdown 插件 |
| `stores/message.ts` 的 `appendToken` 模式（L71）| ♻️ 作模板 | 流式累积：原地 `content += token` + 新数组引用触发渲染（已核实） |
| markdown 全栈 npm 依赖 | ♻️ 同版本 | `react-markdown@10` / `remark-{gfm,breaks,math,directive}` / `rehype-{raw,sanitize,highlight,katex}` / `highlight.js@11` / `katex@0.16` / `mermaid@11`（与 EchoWork package.json 对齐） |
| `.chat-markdown` / `.eb-code-*` / `.eb-block-assistant` CSS 片段 + `--color-*` tokens | ♻️ 搬切片 | 来自 `chat-styles.css` + `globals.css`。overlay 可自由覆写 `--color-chat-bg` 和橙色 accent |
| `ToolCallCard.tsx` + `tool-views/{BashView,DefaultView}`（可选）| ♻️ tier2 | 未知工具自动降级 JSON 渲染，无结构耦合。v1.5 主动工具时才需要 |

**跳过**（IDE 专属，已核实）：`chat-bridge.ts`、`service-container.ts`、`fs-bridge.ts`、`mcp-bridge.ts`、`TurnFileSummary.tsx` + `turn_summary` 消息类型、`tool-views/open-file.ts`、workspace/git/preview stores、session tab chrome、`useChatSubmit` 里的 `selectedFile`/`workspace` 上下文附加。

### 4.3 净新增：overlay 交互壳

```
src/  (EchoLens 前端)
├── overlay/
│   ├── SpotlightOverlay.tsx       # 🆕 根容器：输入条 + 回答卡 + scope 切换
│   ├── InputBar.tsx               # 🆕 居中输入条（Spotlight 风格，Enter 提交 / Esc 收起）
│   ├── AnswerCard.tsx             # 🆕 浮动回答卡（复用 TextMessageBubble 渲染）
│   ├── ScopeSwitcher.tsx          # 🆕 焦点/窗口/全屏 三态切换
│   └── PerceptionPreview.tsx      # 🆕 「将发送的屏幕上下文」可展开/编辑（隐私，见 §6）
├── settings/
│   └── SettingsWindow.tsx         # 🆕 热键 / 模型 / 默认 scope / 黑名单 / 主题
├── core/                          # ♻️ 搬 gateway 层（§4.1）
├── components/                    # ♻️ 搬 chat 渲染零件（§4.2）
├── stores/
│   ├── conversation.ts            # 🆕 当前浮层对话（基于 useMessageStore 模式精简，单 session）
│   └── settings.ts                # 🆕 热键/scope/黑名单/主题持久化
└── styles/                        # ♻️ 搬 --color-* tokens + chat-markdown 切片
```

**核心交互流**（一次召唤问答）：

```
热键 → Rust on_summon（先 capture 后 show，§3.4）
   → overlay 显示 + emit('perception-ready', {nodeCount, omitted})
   → SpotlightOverlay 监听事件，输入条聚焦，显示「已感知 N 个元素 ▸」
   │
用户打字「这个报错啥意思」+ Enter
   → InputBar.onSubmit(question)
   → 从 Rust 取完整 XML：invoke('capture_perception') 已缓存，或用 perception-ready 时带的
   → 拼 user message：
        <screen_context scope="window">
          {XML}
        </screen_context>
        {用户问题}
   → ai.complete(fullPrompt, { onText, onEnd, onError })   ← 临时 session，自动清理
   │
流式 token → AnswerCard（复用 TextMessageBubble 100ms 节流 markdown 渲染）
   → 回答就地浮现在输入条下方
   │
Esc → invoke('hide_overlay')，回到隐身；浮层对话可「pin 成常驻小窗」（产品 §3.3）
```

### 4.4 主题与毛玻璃

沿用 EchoWork 的 **`data-theme` 属性 + CSS 变量**方案（无 React ThemeProvider）：`document.documentElement.setAttribute('data-theme', 'dark'|'light')`，搬 `globals.css` 的 `--color-*` token 块。

overlay 因为是透明浮层，毛玻璃有两种叠加做法（借鉴 Everywhere 的 `AcrylicBlur`）：
- **系统级 acrylic**（推荐）：Rust 侧用 `window-vibrancy` crate 的 `apply_acrylic(&window)`（Win11 可用 `apply_mica`），让窗口背景真正模糊穿透到下层桌面——这是 Everywhere `ChatWindow` 的 `TransparencyLevelHint="AcrylicBlur"` 的等价物。
- **CSS 兜底**：覆写 `--color-chat-bg` 为半透明 + 圆角 + `backdrop-filter: blur()`（acrylic 不可用时降级）。

---

## 5. gateway 集成：零改动

EchoLens 就是 gateway 的又一个 client，和微信 channel 同理——**EchoAI gateway 不动一行代码**。

### 5.1 被动注入（MVP）

感知结果包进 user message 的 `<screen_context>` 块，随用户问题一起发：

```
<screen_context scope="window" elements="118" omitted="47">
<window name="Release All · EchoWorker/EchoAIStore" id="1">
  <tab name="Tab bar" id="3">
    <text>build (windows) — failed</text>
    ...
  </tab>
  <!-- 47 more elements omitted; use expand(elementId=9) -->
</window>
</screen_context>

这个 CI 页面里 windows 的 build 为什么失败？
```

gateway 收到的就是普通 user message，它不需要知道"屏幕"概念。走标准 `chat.completions`（`AIService.complete` → `client.chatCompletions(sessionKey, content, opts)`，已核实）。

### 5.2 主动工具（v1.5，非 MVP）

注册三个工具让 LLM 像 `read_file` 一样按需读屏，支持渐进式探索：

| 工具 | 作用 |
|---|---|
| `get_screen_tree(scope)` | 重新抓某个 scope 的概览 |
| `expand_element(elementId)` | 展开某个 `omitted` 节点的子树（用 §2.2 的稳定 id 回引） |
| `list_windows()` | 列当前所有顶层窗口 |

实现路径：这些工具走 EchoAI 的 MCP/plugin 工具机制（EchoLens 作为一个带工具的 client connect），LLM 调用时回到 EchoLens 本地跑 perception。**MVP 不做**——先验证被动注入的产品价值。

### 5.3 为什么用 AIService 临时 session（而非接 chat-bridge）

- `AIService.complete()` 自生成临时 session key（`ai_svc_<ts>_<rand>`）+ `registerSessionListener` 私有监听 + 结束自动 `deleteSession`（已核实 ai-service.ts L131-158）。
- 好处：**不污染任何共享 store**，事件只回到 EchoLens 自己的回调，最省事、最干净。
- EchoLens 的"追问多轮"用 `AIService.createConversation()`（同一 session 多轮上下文，已核实 L180）。

---

## 6. 隐私与信任（落地）

EchoLens 能"看屏幕"是强能力，必须有匹配的信任设计。产品文档 §6 的 5 条，逐条落地：

| 承诺 | 落地实现 |
|---|---|
| **完全本地抽取** | perception crate 全在本机跑，只有用户提问时才把"裁剪后的 XML"发 gateway（和平时聊天发的内容同级别） |
| **发送前可见** | `PerceptionPreview.tsx`（§4.3）展开"将发送的屏幕上下文"，渲染 XML，用户可**删改**后再发。数据流：`perception-ready` 事件带 summary → 用户点"▸ 查看上下文" → invoke 取完整 XML → 可编辑 textarea → 编辑后的 XML 才进 user message |
| **App 黑名单** | `settings.ts` 存黑名单（窗口标题正则 + 进程名）。capture 入口先查：`GetForegroundWindow()` 的标题/进程命中黑名单 → 直接返回空感知 + 提示"该应用已被排除"。默认预置：密码管理器（1Password/Bitwarden/KeePass）、银行类、`*--private*` 隐私窗 |
| **无后台偷窥** | 只在用户**主动按热键**时 capture，无任何常驻屏幕监听。代码层面：除 `on_summon` 外没有任何 capture 调用点（可被 §9 验证：grep `capture(` 只在 hotkey handler + `capture_perception` 命令里出现） |
| **不截图除非必要** | 默认只走结构化抽取（perception crate）。截图（`screenshot.rs`/`xcap`）仅在 M6 图片类元素兜底、且用户允许时触发 |

---

## 7. MVP 里程碑（M1–M4）

对齐产品文档 §5.2 的 ~9 天估算。每个里程碑给"新建 / 复用 / 验收"三栏。

### M1 — perception crate（~3 天）

| 新建 | 复用 | 验收 |
|---|---|---|
| `echolens-perception/` 全套：`model.rs` `capture/{mod,windows}.rs` `builder/{scoring,traversal,prune,serialize}.rs` `lib.rs` + `tests/builder_tests.rs` | spike 的 capture 配方 | ① `cargo test -p echolens-perception` builder 单测全绿（脱屏纯算法）② 写个 `examples/dump.rs` 实跑：`capture(Window)` 在真实前台窗口产出合法 XML，节点数 ≤ 预算，耗时 < 100ms ③ 三种 scope 都能跑通不 panic |

### M2 — App 外壳（~2 天）

| 新建 | 复用 | 验收 |
|---|---|---|
| `lib.rs` 注册热键/托盘/overlay（§3.3）；`build_overlay_window` / `build_tray` / `on_summon`（含 §3.4 时序 + §3.6.1 DWM cloak）；`set_cloaked` Win32 封装；命令 `capture_perception`/`toggle_overlay`/`hide_overlay`/`set_summon_hotkey` | `echobot_manager.rs`/`config_manager.rs`/`window.rs`/`log.rs`/`main.rs`/`hooks.nsh` | ① 按热键 DWM-uncloak 弹出透明置顶 overlay（无最小化动画），Esc 收起 ② 托盘图标在，左键 toggle、右键菜单可用 ③ **时序验证**：overlay 弹出后 capture 抓到的是用户原 App 而非 overlay 自己（在记事本里按热键，XML 里出现记事本内容、无 EchoLens 元素）④ 第二次启动只触发热键不开新窗（single-instance） |

### M3 — 打通链路（~2 天）

| 新建 | 复用 | 验收 |
|---|---|---|
| `core/gateway-lock.ts`（抽 readGatewayLock）；EchoLens 版 connection 装配（pluginName=echolens）；`SpotlightOverlay`/`InputBar`/`AnswerCard`；`<screen_context>` 拼装 | `echobot-client.ts`/`event-bus.ts`/`ai-service.ts`/`protocol.ts`/`TextMessageBubble`+markdown 全栈 | ① 召唤 → 打字 → 回答就地流式浮现（markdown 渲染正确）② gateway 侧零改动（grep 确认没碰 EchoAI 仓）③ 在浏览器 CI 页面按热键问"为什么 build 失败"，回答引用到页面真实内容 ④ 追问保留上下文 |

### M4 — MVP 收尾（~2 天）

| 新建 | 复用 | 验收 |
|---|---|---|
| `ScopeSwitcher`（三种 scope）；`SettingsWindow`（热键/模型/默认 scope/黑名单/主题）；`PerceptionPreview`（发送前可见可编辑）；Pin 三态 + 失焦自动 cloak + 托盘单击召唤/双击设置（§3.6.4）；错误处理（抓失败/gateway 断/无障碍不支持）；黑名单匹配 | `menu.rs`/updater 套路/`--color-*` 主题 | ① 三种感知范围都能切换并产出合理结果 ② 设置页改热键即时生效 ③ 黑名单 App（如记事本标题含"private"测试）被排除 ④ 发送前能展开/编辑屏幕上下文 ⑤ gateway 未启动时给清晰提示而非崩溃 ⑥ 浮层失焦自动收起（非 pin 态），Pin 后常驻 |

```
M0  可行性验证        ✅ 已完成（spike）
M1  perception crate  capture + builder + serialize + 单测     ~3 天
M2  App 外壳          热键 + overlay + 托盘 + capture 时序      ~2 天
M3  打通链路          gateway client + 感知注入 + 回答渲染      ~2 天
M4  MVP 收尾          设置 + 三 scope + 隐私预览 + 错误处理      ~2 天
────────────────────────────────────────────────────────────
    MVP 小计 ≈ 9 天（复用 EchoWork 零件后）

后续（非 MVP）：
M5  主动工具(v1.5)    get_screen_tree/expand_element/list_windows  ~3 天
M6  截图兜底          图片类元素转截图多模态（screenshot.rs 已备）  ~2 天
M7  操作能力(v2)      点击/输入 + 权限确认 + 失败恢复（单独立项）   大
```

---

## 8. 开放问题 — 推荐答案

逐条回应产品文档 §8：

1. **产品名**：推荐 **EchoLens** 保持不变。"Lens（镜头）"精准表达"看屏幕"，与 EchoWork（工作）形成"看/做"对仗，且 `echolens` 作为 pluginName/进程名/repo 名都干净。
2. **MVP 热键**：推荐默认 **`Ctrl+Shift+Space`**。`Alt+Space` 与 Windows 系统菜单 + 多家输入法冲突，召唤式工具不该赌冲突。设置页可改。
3. **MVP 是否含截图兜底**：推荐 **纯结构化先跑起来**（M1–M4 不含截图）。`screenshot.rs`/`xcap` 依赖先备好，M6 再接。理由：先验证"无障碍树抽取"这个核心假设的产品价值，截图是退路不是主路。
4. **浏览器内容**：推荐 MVP **不专门处理浏览器**，靠"窗口 scope + 提示"。Chrome/Edge 默认不暴露完整 AX 树是已知坑（产品 §5.3），但 ① 很多场景（地址栏/标签/部分内容）仍可抓 ② 专门处理（强制开 `--force-renderer-accessibility` 或截图）属 M6 范畴。MVP 先让非浏览器场景（IDE/邮件/Office/聊天/PDF 阅读器）跑顺。
5. **独立 repo 还是 EchoAIExtensions**：推荐**暂留 `EchoAIExtensions/Clients/EchoLens`**，自带 Cargo workspace（`echolens-perception` + `src-tauri`）+ 独立 `package.json`。理由：① 现在和微信 channel 一样是"扩展生态"成员，monorepo 便于跨仓引用 EchoWork 零件 ② 等它体量真正长成独立 App（有自己的 CI/release/版本节奏）再拆 repo，过早拆增加维护成本。**触发拆分的信号**：需要独立 release cadence、或 perception crate 要发布到 crates.io。

---

## 9. 依赖、许可与合规

- **核心依赖**：`uiautomation = "0.25"`（Apache-2.0，封装 Windows IUIAutomation COM，spike 已用）、`windows = "0.58"`（`GetForegroundWindow`）、Tauri 2 全家桶（沿用 EchoWork）、前端 react-markdown 10 全栈（沿用 EchoWork）。全部可商用。
- **与 Everywhere 的合规边界**（重申产品 §7）：`Sylinko/Everywhere` 是 BSL-1.1，**绝不复制源码**。本方案精读了它的真实源码（`Everywhere.Windows/Interop/` + `Chat/VisualContext/`）以**校准工程决策**，借鉴的全是公开 Win32/UIA 工程常识：① 无障碍树抽取优于截图 ② best-first + token 预算裁剪 ③ 被动注入 + 主动工具双通道 ④ DWM Cloak 瞬现隐藏 ⑤ 热键 `RegisterHotKey` 优先 + 低级钩子降级 ⑥ DWM 窗口边界特判 / Password 脱敏等抽取盲区。这些手法（DWM API、UIA API、优先队列、tokenizer 预算）都是微软公开文档或通用算法，用 Rust 全新实现无侵权。**没有任何一行 C#/Avalonia 代码被复制或翻译**——借鉴的是"该用哪个系统 API、该避哪个坑"，不是实现代码。
- **自更新 CI**（§3.1 复用）：沿用 EchoWork→EchoAIStore 套路，updater endpoint 指向 `EchoAIStore/releases/download/echolens-latest/latest.json`，签名密钥复用现有 minisign 体系。真实构建 pipeline 放 EchoAIStore 统一 workflow（与 EchoWork 一致）。

---

## 10. 验证设计的真实性（本文档自检）

本文所有"复用 EchoWork 的 XX"和"用 uiautomation 的 YY"都经实仓核对，可复现：

```powershell
# gateway 管理函数真实存在
grep "fn gateway_lock_path|fn deploy_echoai_if_needed|fn echobot_start_gateway" `
     EchoWork/src-tauri/src/echobot_manager.rs            # → 命中

# AIService API 真实
grep "async complete|createConversation|AICompletionCallbacks" `
     EchoWork/src/core/ai-service.ts                      # → 命中

# TextMessageBubble 的 3 个改动点真实
grep "openFileInPreview|resolveFilePath|useWorkspaceStore" `
     EchoWork/src/modules/chat-panel/TextMessageBubble.tsx # → 命中（L28-30）

# uiautomation v0.25 capture API 真实（对照 crate 源码）
#   element_from_handle / get_focused_element / get_root_element / create_cache_request
#   build_updated_cache / get_cached_children / set_tree_scope(TreeScope::Subtree)
#   Handle: From<HWND>                                     # → 全部命中

# spike 已验证配方一致
grep "build_updated_cache|element_from_point|get_cached_children|TreeScope::Subtree" `
     Clients/EchoLens/spike/src/bin/cached_tree.rs        # → 命中
```

---

## 11. 一句话总结

EchoLens 的实现 = **从零造一双眼睛（`echolens-perception` crate，spike 已验证地基）+ 一套召唤交互（热键/托盘/DWM-cloak 透明 overlay，EchoWork 没有的净新增）**，其余 gateway 连接、流式 markdown 渲染、进程管理、配置、自更新 CI 全部搬 EchoWork 现成零件。Windows 交互的关键手法（DWM Cloak 瞬现、热键双路径、token 预算裁剪、抽取盲区）借鉴自精读 `Everywhere`（BSL-1.1，只学思路不抄码）。最大的工程坑是 **capture 时序——必须"先抓屏后显示 overlay"**（Everywhere 的生产实现印证了这点），否则抓到自己。MVP 约 9 天，交付"只读屏幕问答"闭环。
