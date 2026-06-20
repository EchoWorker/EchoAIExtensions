# EchoLens

> **Windows 屏幕感知 AI 助手** — EchoAI 生态中与 EchoWork 同级的独立桌面应用。
> 状态：设计阶段（可行性已验证）

按一个全局热键，EchoLens 立刻"看懂"你当前屏幕上任何 App 的内容（报错、网页、邮件、表格），
就地回答——不用截图、不用复制、不用切窗口。

- **EchoWork** 在 IDE 里帮你写代码（workspace 内）
- **EchoLens** 在整个桌面帮你理解任意 App（workspace 外）

两者共享同一个 EchoAI gateway 大脑。

## 核心原理

读操作系统的**无障碍树（UI Automation Tree）**而非截图——拿到结构化的元素
（类型/文本/位置/层级），裁剪后喂给 LLM。快、准、省 token、带语义。

## 文档

- [`docs/PRODUCT_DESIGN.md`](docs/PRODUCT_DESIGN.md) — 完整产品设计文档

## 可行性验证

UIA Rust spike 已跑通（见设计文档 §2）：
- crate：`uiautomation` v0.25（Apache-2.0）
- 性能：`build_updated_cache(Subtree)` 一次性缓存，**150 节点 48ms**
- 入口：`element_from_point`（光标命中）21ms

## 状态

| 里程碑 | 状态 |
|--------|------|
| M0 可行性验证 | ✅ 完成 |
| M1 perception crate | ⏳ 待开工 |
| M2 App 外壳 | ⏳ |
| M3 打通链路 | ⏳ |
| M4 MVP 收尾 | ⏳ |

## 合规

仅借鉴 `Sylinko/Everywhere`（BSL-1.1）的**架构思想**，不复制源码，用 Rust 全新实现。
依赖均为 Apache-2.0 / MIT。
