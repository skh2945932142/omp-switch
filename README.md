# OMP Switch

[English](README.en.md) · [安装与下载](docs/install.md) · [功能一览](docs/features.md) · [安全说明](docs/security.md) · [架构说明](CLAUDE.md)

OMP Switch 是 [Oh My Pi](https://github.com/can1357/oh-my-pi)（下称 OMP）的桌面配置工具，用来管理模型供应商、模型角色和相关设置。支持 Windows 和 Linux，另有命令行（CLI）和终端界面（TUI）两种用法。

它改的是你自己的文件：`~/.omp/agent/models.yml` 和 `config.yml`。这些文件不归 OMP Switch 所有，所以它写得很小心：

- 写入前先检查文件有没有被别的工具改过，改过就停下，让你重新载入；
- 只改你动过的那几处，YAML 里的注释和它不认识的字段原样保留；
- 每次写入前自动留一份快照，随时可以恢复；
- 遇到它没验证过的 OMP 大版本，只读不写。

![OMP Switch 模型工作区](docs/images/provider-workspace.png)

![角色页（暗色主题）](docs/images/roles-dark.png)

## 最近更新（v1.0.0）

v1.0.0 把兼容性基线推进到 OMP v18.8，并补齐 CLI 快照恢复与字段级 schema 漂移监测：

- CLI/TUI 可按快照 ID 恢复配置；默认拒绝覆盖快照之后的外部编辑，只有显式 `--force` 才覆盖。
- 类型和校验覆盖 OMP v18.8 的模型级压缩阈值、usage-aware retry 字段，并同步 `judge` 角色。
- 周度同步检查除了 OMP 主版本，也检查固定上游 schema 源的 hash；源码变化需要人工审查，不会自动放开兼容。
- Linux 与 Windows packaged CLI 的 CI 回归覆盖冲突拒绝和显式强制恢复。

完整说明见 [v1.0.0 发布说明](docs/releases/v1.0.0.md)、[功能一览](docs/features.md) 和 [CHANGELOG](CHANGELOG.md)。

> 安装包没有做代码签名，Windows 的 SmartScreen 会弹警告。请用发布页上的 `SHA256SUMS.txt` 和 build provenance 核对下载的文件，方法见 [安装文档](docs/install.md)。

## 下载哪一种

| 形态 | Windows | Linux | 能做什么 |
| --- | --- | --- | --- |
| 桌面应用 | 有 | 有（AppImage / deb / rpm） | 全部功能：图形界面、凭据库、本地网关、Prompts / Skills / Sessions |
| 命令行 `omp-switch-cli` | 有 | 有 | 读写配置、校验、快照，输出稳定的 JSON，适合写脚本 |
| 终端界面 `omp-switch-tui` | 从源码构建 | 从源码构建 | 在终端里交互式编辑配置（`pnpm build:tui`） |

CLI 和 TUI 不依赖 Electron，有 Node.js 24 就能跑。它们打不开凭据库：API key 只有封存它的那台机器能解开，所以 CLI 管的是配置，不是密钥。

API key 的存放方式按系统区分：

- **Windows**：用 Electron `safeStorage` 加密（绑定当前用户的 DPAPI），OMP 通过一个很小的 C# 程序取回。
- **Linux**：每个 key 单独存进系统的 libsecret 钥匙串，OMP 通过 `secret-tool` 取回。没有 Secret Service 的环境会退回到 age 加密文件，这是个明确的降级，细节见 [docs/security.md](docs/security.md)。

不管哪个系统，key 都不会写进 `models.yml`，配置里只留一条取 key 的命令。

## 安装

Windows：

```powershell
# winget（已上架，当前收录到 0.9.0（[#446675](https://github.com/microsoft/winget-pkgs/pull/446675)）；1.0.0 待提交）
winget install skh2945932142.OMPSwitch

# Scoop（仓库自带 bucket，每次发布后自动同步）
scoop bucket add omp-switch https://github.com/skh2945932142/omp-switch
scoop install omp-switch
```

Linux：

```bash
# 从 Releases 页下载后任选其一
sudo dpkg -i OMP-Switch-1.0.0-linux.deb
sudo rpm -i OMP-Switch-1.0.0-linux.rpm
chmod +x OMP-Switch-1.0.0-linux.AppImage && ./OMP-Switch-1.0.0-linux.AppImage
```

你也可以直接去 [Releases](https://github.com/skh2945932142/omp-switch/releases/latest) 下载 Windows 安装包或便携版。Chocolatey 的包已经准备好，还没提交到官方源。

只想用 CLI 的话可以用 Docker：

```bash
docker run --rm -v "$HOME/.omp:/home/node/.omp" \
  ghcr.io/skh2945932142/omp-switch-cli:1.0.0 validate --profile default
```

镜像已推到 GHCR，但 GitHub 默认把新容器包设为私有，可见性只能由仓库所有者在设置里改。如果拉取时提示 `unauthorized`，看 [docs/install.md](docs/install.md#docker)；本地 `docker build` 不受影响。

校验和、provenance 验证等其余安装方式见 **[docs/install.md](docs/install.md)**。

## 功能概览

- **供应商与模型**：增删改供应商和模型，设置 `modelProviderOrder`、`enabledModels`、`disabledProviders` 和思考档位。81 个预设可一键套用，也支持 OpenAI、Ollama、llama.cpp、LM Studio、Proxy、LiteLLM 和 Apple Foundation Models 的模型发现。
- **模型角色**：「角色」页每行一个角色，显示实际指向的模型；`@引用` 成环、选择器写错、误用 `:off` / `:auto` 这类问题会就地提示。
- **保存即预览**：每次写入前先展示 `models.yml` / `config.yml` 的逐行 diff，确认后才写盘；快照可浏览、可恢复。
- **Prompts / Skills / Sessions**：浏览和管理 OMP 资源；Prompts 还提供本地提示词资料架，可搜索、收藏、标签、复制并安全采用为 Profile 副本。
- **其他**：用量统计、本地网关、Ctrl+K 命令面板、浅色 / 深色主题、中文 / English 界面。

逐项说明在 [docs/features.md](docs/features.md)。

## 它不会做的事

- 不读取、不修改 OMP 的 `agent.db`、OAuth refresh token 和账号轮换状态。
- 不自动写入项目目录里的 `.omp` 覆盖配置，只读取它们作参考。
- 不上传 API key、快照、诊断日志或导出文件。
- 不做云同步，不自动轮换账号，不下载来路不明的二进制。
- 不把 API key 放进 OMP 配置。这一条由 `packages/core` 的校验器强制执行，所以 CLI 同样受限。

详见 [SECURITY.md](SECURITY.md) 和 [docs/security.md](docs/security.md)。

## 从源码运行

需要 Node.js 24+ 和 pnpm 11+。

在 Windows 上还需要 .NET SDK 10.0，以及 Visual Studio 的「使用 C++ 的桌面开发」工作负载。凭据桥以 Native AOT 发布，要用 MSVC 链接器。Linux 不需要 .NET 和 MSVC。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

只构建 CLI 的话，两个系统都不需要 .NET 或 MSVC：

```bash
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/dist/main.js --help
```

## 检查与打包

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:win         # 生成 NSIS 安装包和便携 ZIP（在 Windows 上）
pnpm package:linux       # 生成 AppImage / deb / rpm（在 Linux 上，需要先装 rpm 提供 rpmbuild）
pnpm verify:package-cli  # 在临时 HOME 里运行打包后的 JSON CLI
pnpm render:packaging    # 用真实发布哈希生成 winget / Scoop / Chocolatey 清单
```

打包产物是本地构建结果，不提交到 Git。

## Profile 与恢复

- 默认 Profile：`~/.omp/agent/`
- 命名 Profile：`~/.omp/profiles/<name>/agent/`

OMP Switch 遵循 OMP 自己的 `PI_CONFIG_DIR`、`OMP_PROFILE`、`PI_PROFILE`、`PI_CODING_AGENT_DIR`，编辑的就是 OMP 实际读取的那份文件。

每次写入前都会在本机留一份快照。如果文件在载入之后被其他工具或手工改过，应用会停下来请你重新载入，不会悄悄覆盖。

## 文档

- [功能一览](docs/features.md)：每个页面能做什么
- [docs/install.md](docs/install.md)：所有安装方式和平台差异
- [docs/security.md](docs/security.md)：威胁模型和凭据处理
- [docs/pi-contract.md](docs/pi-contract.md)：OMP Switch 与 OMP 配置文件之间的约定
- [docs/pi-thinking-profiles.md](docs/pi-thinking-profiles.md)：思考档位与 `thinkingLevelMap`
- [docs/omp-schema-tracking.md](docs/omp-schema-tracking.md)：怎么跟进 OMP 上游格式变化
- [docs/releasing.md](docs/releasing.md)：发布流程
- [CLAUDE.md](CLAUDE.md)：架构、写入路径和各处不变量
- [CHANGELOG.md](CHANGELOG.md)：版本记录
- [CONTRIBUTING.md](CONTRIBUTING.md)：参与贡献

## 许可证

[MIT License](LICENSE)
