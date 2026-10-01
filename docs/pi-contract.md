# Oh My Pi (OMP) 原生契约与实现边界

> 状态：与 Oh My Pi v18.4+ 及 CC Switch 原生契约规范深度对齐  
> 原则：以用户拥有的配置文件为中心，保障无损写入与零信任安全。

本文档详细定义 **OMP Switch** 在管理 Oh My Pi 模型供应商配置时的技术契约、同步规则与安全实现边界。

---

## 1. 核心设计原则

OMP Switch 遵循一条根本原则：**它编辑的是用户自己拥有、而软件并不拥有的文件**。

- 核心目标文件：`~/.omp/agent/models.yml` 与 `~/.omp/agent/config.yml`（或遵循 `PI_CONFIG_DIR`、`OMP_PROFILE` 等环境变量解析路径）。
- 绝不损坏未知字段与注释：使用局部 YAML AST 操作，写入前必须展示行级 Diff。
- 零破坏保障：写入前校验文件内容 Hash，提交前自动生成还原快照；一旦检测到外部改动即刻拒绝盲写。
- 未知版本保守只读：遇到未在已验证列表（当前为 OMP 16/17/18）中的未来主版本，自动切换为只读保护模式。

---

## 2. 配置消费契约与数据映射

| 资源 / 字段 | OMP Switch 行为 | 说明 / 来源 |
| --- | --- | --- |
| `models.yml` (`providers`) | 核心可写区域：管理供应商节点定义、模型列表、API 格式、上下文参数与思考映射 | 保留 YAML 树状结构与未知字段 |
| `config.yml` (`modelRoles`) | 管理内置角色（`default`, `smol`, `slow`, `vision`, `plan`, `commit`, `tiny`, `task`, `advisor`）与自定义角色的模型指向 | 支持 `:thinkingLevel` 思考后缀 |
| `config.yml` (`retry.fallbackChains`) | 管理按角色或供应商/模型的故障转移备选链 | 校验选择器有效性，提供智能备选回退 |
| `config.yml` (`settings`) | 支持编辑思考等级、压缩（compaction）、垃圾回收（`gc.stale`）、工具配置（`tools.artifactMaxBytes`）等 | OMP v18.4+ 规范 |
| `agent.db` / `auth.json` | **绝不读取、不写入、不修改** | 保持与 OMP 内部运行时状态完全解耦 |
| 凭据密钥 (`apiKey`) | 密钥绝不以明文保存在 `models.yml`；配置中仅保存系统凭据库的引用命令 | Windows: safeStorage/DPAPI；Linux: libsecret/age |

---

## 3. 显式供应商同步与合并规范

参考 CC Switch 针对 Pi/OMP 生态沉淀的显式供应商管理规范，OMP Switch 实施以下同步机制：

1. **同名内置覆盖**：
   - 当用户在 `models.yml` 中声明 `openai`、`anthropic` 或 `deepseek` 时，这些条目作为显式覆盖节点处理，用户可以自由配置专属 BaseUrl、自定义请求头与专用模型列表。
2. **完整元数据丰富**：
   - 供应商预设不仅提供 `baseUrl` 与 `api`，还携带经过社区验证的模型元数据（`contextWindow`、`maxTokens`、`reasoning`、`thinkingLevelMap`）。
3. **发现（Discovery）集成**：
   - 支持 `openai-models-list`、`ollama`、`lm-studio`、`llama.cpp`、`litellm`、`proxy` 以及 OMP v18.4+ 新增的 `apple-foundation-models` 动态模型探测，并支持 `injectV1: false` 规避子路径拼接。

---

## 4. 安全信任边界

1. **凭据安全隔离**：
   - Windows：采用 Electron `safeStorage`（基于 DPAPI 用户级密钥），由独立 C# 进程桥接解析。
   - Linux：采用系统的 `libsecret` Keyring 条目，冷启动毫秒级无桥接运行；若缺少桌面 Keyring 服务，自动安全降级为本地 age 强加密文件。
2. **无云端遥测与回传**：
   - 所有的模型调用、历史快照、诊断日志与配置均留在本地，绝不向任何第三方服务器上传 API 密钥或配置文件。
3. **只读保护与防冲突**：
   - 项目目录叠加层（`.omp/`）默认作为只读参考；
   - 外部编辑器修改配置文件时，触发并发冲突告警对话框，提供快速重载与合并提示。
