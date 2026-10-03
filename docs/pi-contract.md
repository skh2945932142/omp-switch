# OMP Switch 与 OMP 配置文件之间的约定

这份文档写清楚 OMP Switch 读写 Oh My Pi（OMP）配置时遵守的规则：碰哪些文件、改哪些字段、不碰什么。它对照的是 OMP v18.4 的配置格式，并在 v18.5.0 发布后核对过 `models.yml` 的格式没有变化。

## 1. 基本原则

OMP Switch 编辑的是用户自己的文件，不是它自己的。所以：

- 目标文件是 `~/.omp/agent/models.yml` 和 `~/.omp/agent/config.yml`，路径会跟随 `PI_CONFIG_DIR`、`OMP_PROFILE`、`PI_PROFILE`、`PI_CODING_AGENT_DIR`。
- 只对 YAML 的相关节点做局部修改，注释和不认识的字段原样保留。写入前会展示逐行 diff。
- 写入前核对文件哈希，写入前留快照。发现文件被外部改动，就拒绝写入，请你重新载入。
- 遇到没验证过的 OMP 大版本（目前验证过的是 16、17、18），只读不写。

## 2. 各个文件和字段怎么处理

| 位置 | OMP Switch 的做法 |
| --- | --- |
| `models.yml` 的 `providers` | 可编辑：供应商、模型列表、接口类型、上下文参数、`thinkingLevelMap`。不认识的字段保留。 |
| `config.yml` 的 `modelRoles` | 可编辑：内置角色（`default`、`smol`、`slow`、`vision`、`plan`、`commit`、`tiny`、`task`、`advisor`）和自定义角色指向哪个模型，支持 `:level` 思考后缀。 |
| `config.yml` 的 `retry.fallbackChains` | 可编辑：按角色或 `provider/model` 设置备选链。`retry` 里的其他参数不动。 |
| `config.yml` 的思考、压缩等设置 | 部分可编辑，在界面的设置抽屉里。 |
| `config.yml` 的 `gc.stale`、`tools.artifactMaxBytes` | 会校验取值，但界面里还不能编辑；已有的值会原样保留。 |
| `agent.db`、OAuth 凭据 | 不读、不写、不改。 |
| API key | 不进入 `models.yml`。配置里只写一条取回 key 的命令。 |

## 3. 预设和模型发现

- **覆盖内置供应商**：如果 `models.yml` 里写了 `openai`、`anthropic`、`deepseek` 这类内置供应商的名字，OMP Switch 把它当成你的显式覆盖，允许你改 `baseUrl`、请求头和模型列表。
- **预设带什么**：除了 `baseUrl` 和 `api`，部分预设模型还带 `contextWindow`、`maxTokens`、`reasoning` 和 `thinkingLevelMap`。这些数据参考了 CC Switch 的预设整理，可能落后于供应商的实际变化，写入前请看一眼 diff。
- **模型发现**：支持 `openai-models-list`、`ollama`、`lm-studio`、`llama.cpp`、`litellm`、`proxy`，以及 OMP 18.4 新增的 `apple-foundation-models`。`openai-models-list` 可以设 `injectV1: false`，避免多拼一个 `/v1`。
- **OMP 18.4 的新字段**：`openrouter-decisions`、`typesafe` 两种接口类型，模型上的 `maxContextWindow`（必须不小于 `contextWindow`）、`supportsTools`、`promptCache`，校验器都认识。

## 4. 凭据和信任边界

- **Windows**：key 用 Electron `safeStorage` 加密（绑定当前用户的 DPAPI），OMP 通过一个独立的 C# 程序取回。
- **Linux**：每个 key 是系统 libsecret 钥匙串里的一个条目，OMP 通过 `secret-tool` 取回。没有 Secret Service 时退回 age 加密文件，这是降级，不如钥匙串，见 [security.md](security.md)。
- **不联网回传**：模型调用记录、快照、诊断日志和配置都留在本机，OMP Switch 不会把它们上传到任何地方。
- **项目里的 `.omp/`**：只当作只读的参考。
- **外部改动**：别的编辑器改了文件，OMP Switch 会弹出冲突提示，让你重新载入，不会合并也不会覆盖。
