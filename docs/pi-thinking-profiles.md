# 思考档位与 `thinkingLevelMap`

这份文档说明 OMP 的思考档位怎么用，以及 OMP Switch 预设里的 `thinkingLevelMap` 是什么、现在做到哪一步。映射的取值参考了 CC Switch 的 Pi 思考画像整理。

## 1. 思考档位

OMP 的档位从低到高是：

```text
off < minimal < low < medium < high < xhigh < max
```

不同位置接受的档位不一样：

- **全局默认档位**（`config.yml` 里的思考设置）：`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，外加 `auto`，不接受 `off`。
- **角色后缀**（`provider/model:level`）：`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 六档，不接受 `off` 和 `auto`。写成 `:off` 或 `:auto` 会被 OMP 当成模型 ID 的一部分，OMP Switch 会在角色页提示这个问题。
- **模型自己的 `thinking.defaultLevel`**：`off` 加上面的六档。

这些规则来自 `packages/core/src/validation.ts` 里的 `SETTINGS_THINKING_LEVELS` 和 `ROLE_THINKING_LEVELS`。

## 2. `thinkingLevelMap` 是什么

各家接口表达「思考强度」的方式不一样：OpenAI 用 `reasoning_effort`，Gemini 用大写的 `LOW` / `HIGH`，有的模型干脆没有某一档。`thinkingLevelMap` 写在 `models.yml` 的模型上，告诉 OMP 每个档位对应什么实际参数：

```yaml
thinkingLevelMap:
  minimal: null
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

- **键**：OMP 的档位，七个里的任意几个。
- **没写的键**：按 OMP 自己的默认规则处理。
- **值是 `null`**：这个模型不支持该档位。
- **值是字符串**：发给上游接口的实际取值。

OMP Switch 现在做的事：

- 预设里的部分模型自带 `thinkingLevelMap`，套用预设时一并写入 `models.yml`。
- 校验器检查它的结构：键必须是上面七个档位之一，值只能是字符串或 `null`。

OMP Switch 现在还没做的事：界面还不会根据 `thinkingLevelMap` 禁用某些档位。角色页的思考档位控件目前对所有模型一视同仁，某个档位不被支持时，要靠你自己或 OMP 来处理。后续如果加上，会写进 CHANGELOG。

## 3. 内置画像

画像定义在 `packages/core/src/thinking-profiles.ts`。目前预设里有 17 个模型使用了它们：

| 画像 | 用在哪些预设模型 | 内容 |
| --- | --- | --- |
| `xhighAndMax` | OpenAI o3、Claude 3.7 Sonnet、Claude Sonnet 4.5、QwQ 32B | 只声明 `xhigh` 和 `max` 可用 |
| `lowMediumHighOnly` | OpenAI o3-mini | 只有 `low` / `medium` / `high` 可用 |
| `deepseekV4` | DeepSeek reasoner、SiliconFlow 和 PPIO 的 DeepSeek R1 | `minimal` / `low` / `medium` 不支持，`high` 和 `max` 可用 |
| `offUnsupportedXhighAndMax` | Claude Opus 5.5 | 不能关闭思考，`xhigh` 和 `max` 可用 |
| `kimi3` | Kimi k1.5 | 只有 `low` / `high` / `max` 可用 |
| `openCodeGoGlm52` | GLM-Zero-Preview | 只有 `high` / `max` 可用 |
| `openaiResponsesGpt5` | GPT-5 | `minimal` 到 `high` 可用 |
| `openaiResponsesGpt51` | GPT-5.1 | `off` 对应 `none`，`low` 到 `high` 可用 |
| `openaiResponsesGpt52To55` | GPT-5.2 | `off` 对应 `none`，`low` 到 `xhigh` 可用 |
| `openaiResponsesGpt56` | GPT-5.6 | `off` 对应 `none`，`low` 到 `max` 都可用 |
| `geminiLowHigh` | Gemini 2.5 Pro / Flash | `low` 对应 `LOW`，`high` 对应 `HIGH`，其余不支持 |

代码里还有 `offUnsupported`、`maxOnly`、`openaiResponsesGpt53CodexSpark`、`openaiResponsesGpt6Astra` 几个画像，暂时没有预设模型使用。

这些映射是参考 CC Switch 整理的，上游接口随时可能调整。如果你发现某个取值与供应商的实际行为不符，欢迎开 issue。

## 4. 与角色的关系

给角色指定模型时，OMP Switch 会把档位以 `provider/model:level` 的形式写进 `config.yml` 的 `modelRoles`。写入前会按第 1 节的规则检查后缀是否合法。`thinkingLevelMap` 不参与这一步，它只存在于 `models.yml` 的模型定义里。
