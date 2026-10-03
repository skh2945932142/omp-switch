# 功能一览

这份文档按页面说明 OMP Switch 能做什么。安装方法在 [install.md](install.md)，安全相关的细节在 [security.md](security.md)。

## 配置编辑

- **OMP 版本**：`16.x`、`17.x`、`18.x` 可读可写。没验证过的更高主版本只读，不会动文件。
- **Profile**：支持默认 Profile 和命名 Profile，也认 OMP 自己的 `PI_CONFIG_DIR`、`OMP_PROFILE`、`PI_PROFILE`、`PI_CODING_AGENT_DIR`。碰到旧的 `models.json` 会先保护起来，不直接迁移。
- **可编辑的内容**：供应商、模型、`modelProviderOrder`、`enabledModels`、`disabledProviders` 和思考档位设置。
- **写入方式**：只对 YAML 的相关节点做局部修改，注释和不认识的字段原样保留；写入前核对文件哈希，原子写入；每次写入前留一份快照，恢复时同样会拒绝覆盖外部改动。
- **预设**：内置 81 个供应商预设，部分模型带有上下文长度、输出上限和 `thinkingLevelMap`。预设的整理参考了 CC Switch。
- **模型发现**：支持 OpenAI 兼容接口、Ollama、llama.cpp、LM Studio、Proxy、LiteLLM 和 Apple Foundation Models。

关于预设里 `thinkingLevelMap` 的含义，见 [pi-thinking-profiles.md](pi-thinking-profiles.md)。

## 模型角色

- 「角色」页每个角色占一行：中文说明、实际解析结果（`@default → provider/model = 具体模型`）、能力标签。`config.yml` 里的自定义角色也能看、能改。
- `@引用` 成环、选择器写错、误用 `:off` / `:auto` 时，会在对应行提示。
- 模型选择器可以搜索，按供应商分组，置顶 `@default`、`*` 和「清除」，思考档位用分段控件选（角色后缀只接受 OMP 认的六档），全程可用键盘操作。网关的上游选择也用同一个选择器。
- 在模型列表里把鼠标悬停到某一行，可以一键把它分给任意角色，原有的思考后缀会保留。
- 供应商卡片和角色选择器会标出 `enabledModels` 的覆盖情况；如果选中的模型会被 OMP 过滤掉，会就地提醒。

## 其他页面

- **Prompts / Skills / Sessions**：浏览索引，需要时再读原文。
- **用量**：花费、请求数、tokens、每日趋势，可按模型和供应商分组；成本会标明数据来源。
- **本地网关**：监听本机回环地址，提供 `/healthz`、`/v1/models`、Chat、Responses，支持流式响应开始前的故障转移。必须带 Bearer token，会校验 Host，拒绝跨源请求。
- **凭据与登录**：Windows 的 DPAPI 凭据桥、Linux 的 libsecret / age 凭据库（v0.6.0 起），以及 OMP OAuth 的状态查看和登录入口。孤儿凭据和引用追踪在两个系统上行为一致。
- **命令行**：稳定的 JSON 输出，命令有 `list`、`get`、`validate`、`snapshot`、`apply`。
- **终端界面（TUI）**：`omp-switch-tui` 有 providers、角色、快照、诊断四个页面，保存分两步（先看 diff，再确认）；`list`、`validate` 子命令可以直接写进脚本。需要从源码构建，见 [install.md](install.md)。

## 界面细节

- **视觉风格**（内部叫 “Quiet Instrument”）：中性灰为主，teal 只用来标记选中和焦点；主按钮是深底白字；状态用圆点加淡色文字表示。
- **主题与语言**：浅色、深色、跟随系统三种主题，原生标题栏按钮同步跟随；中文、English、跟随系统三种语言，首屏就按已保存的语言绘制。Windows 11 22H2 及以上会用 Mica 窗口材质，其他环境自动用纯色。
- **标题栏**：顶栏可以拖动窗口，窗口按钮是系统原生的（保留 Snap Layouts）。
- **供应商卡片**：点击卡片头部只展开或收起模型列表；鼠标悬停时出现编辑按钮；详情和编辑抽屉以浮层方式滑入，不挤占工作区。
- **保存**：角色和设置各自独立保存；有未保存改动时导航上会出现圆点，`Ctrl+S` 保存；切换 Profile 前会先确认是否丢弃。
- **保存即预览**：每次写入前显示 `models.yml` / `config.yml` 的逐行 diff，确认后才落盘。快照时间线可以浏览和恢复；外部修改造成的冲突会弹出对话框，一键重新载入。
- **快捷键**：`Ctrl+K` 打开命令面板（页面、Profile、供应商、动作），`Ctrl+1` 到 `Ctrl+7` 切换页面，`?` 查看全部快捷键。
