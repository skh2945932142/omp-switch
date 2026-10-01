# Oh My Pi (OMP) 模型思考档位与映射规范 (Thinking Profiles)

> 规范对齐：吸纳 CC Switch `piThinkingProfiles` 规范与 Oh My Pi v18.x 角色推理契约

---

## 1. 思考档位体系概览

Oh My Pi 在处理支持推理思考（Reasoning / Thinking）的模型时，采用结构化的档位语义：

```text
off < minimal < low < medium < high < xhigh < max
```

但在实际配置场景下，这三处语义有严格区别：
- **全局默认档位 (`defaultThinkingLevel`)**：接受除 `off` 之外的所有 6 级档位以及 `auto`（即 `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `auto`）。
- **角色后缀 (`@role:level` 或 `provider/model:level`)**：接受除 `off` 和 `auto` 之外的 6 个离散档位（`minimal`, `low`, `medium`, `high`, `xhigh`, `max`）。
- **命令行模式 (`omp --model`)**：完整接受包含 `off` 在内的所有档位。

---

## 2. 思考档位映射表 (`thinkingLevelMap`)

不同模型提供商（如 OpenAI、Anthropic、Google、DeepSeek、Qwen、Kimi、GLM）对“思考等级”的 API 传参方式存在巨大差异：
- OpenAI (GPT-5/o3)：使用 `reasoning_effort` (`low`, `medium`, `high`) 或布尔开关；
- Anthropic (Claude 3.7 / 4.5)：使用 `budget_tokens` 或自适应思考等级；
- DeepSeek (R1)：仅允许纯推理模式或特定档位，低档位不支持；
- Google AI Studio (Gemini 2.5)：使用 `LOW`、`HIGH` 等大写参数。

为了屏蔽这种异构性，OMP Switch 完整吸纳了 CC Switch 的 `thinkingLevelMap` 机制：

```json
"thinkingLevelMap": {
  "minimal": null,
  "low": "low",
  "medium": "medium",
  "high": "high",
  "xhigh": "xhigh",
  "max": "max"
}
```

- **键 (Key)**：OMP 标准思考档位（`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`）。
- **缺失键**：使用上游默认规则映射。
- **值为 `null`**：明确指示该模型**不支持**此档位，OMP Switch 界面会自动禁用对应档位，防止用户选择导致请求 400。
- **值为 `string`**：传向下游 API 时的实际入参映射字符串。

---

## 3. 内置精选思考画像 (Curated Profiles)

OMP Switch 在 `packages/core/src/thinking-profiles.ts` 中内置了经过社区测试的最佳思考画像：

| 画像 ID | 适用代表模型 | 典型映射规则 |
| --- | --- | --- |
| `xhighAndMax` | Claude 3.7/4.5 Sonnet, OpenAI o3, QwQ-32B | 支持超高推理，`xhigh` -> "xhigh", `max` -> "max" |
| `deepseekV4` | DeepSeek-R1 (官方与 PPIO/硅基流动) | 禁用低档思考：`minimal: null`, `low: null`, `medium: null`, `high: "high"`, `max: "max"` |
| `offUnsupportedXhighAndMax` | Claude 5.5 Opus | 常开思考（`off: null`），支持 `xhigh` 与 `max` |
| `kimi3` | Kimi k1.5, Kimi for Coding | `off: null`, `minimal: null`, `low: "low"`, `high: "high"`, `max: "max"` |
| `openCodeGoGlm52` | GLM-Zero-Preview, GLM-5 | 强化高档推理：仅开启 `high` 与 `max` |
| `openaiResponsesGpt5` | GPT-5 / GPT-5.1 / GPT-5.6 | 完整支持 OpenAI Responses 协议的思考档位分发 |
| `geminiLowHigh` | Gemini 2.5 Pro / Flash | 映射为大写规范：`low` -> "LOW", `high` -> "HIGH" |

---

## 4. 与 OMP 角色联动

在 OMP Switch 的「角色」工作区中：
1. 为角色指派模型时，系统自动读取该模型绑定的 `thinkingLevelMap`；
2. 界面仅点亮该模型合法支持的思考档位滑块；
3. 一旦用户保存角色分配，系统将以 `@role:level` 语法无缝写入 `~/.omp/agent/config.yml` 的 `modelRoles` 节点中。
