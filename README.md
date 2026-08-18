# OMP Switch

[English documentation](README.en.md)

Windows 优先的桌面伴侣应用，用于安全管理 [Oh My Pi](https://github.com/can1357/oh-my-pi) 的模型供应商配置。

> 当前仓库是 `0.1.0` 开发快照。尚未提供受支持的公开下载版，也不会发布 `v0.1.0` Release；首个受支持发行版计划为 `v0.2.0`。

![OMP Switch 供应商工作区](docs/images/provider-workspace.png)

## 已实现能力

- 读取默认和命名 OMP Profile。
- 管理 `models.yml` / `models.yaml` 供应商定义，并检测旧 `models.json`。
- 将 `modelRoles` 与供应商配置分离写入对应的 `config.yml`。
- 使用 YAML AST 局部修改，尽量保留未知字段、顺序和注释。
- 在写入前进行文件冲突检测、原子替换和本机快照恢复。
- 通过 OpenAI-compatible `GET /models` 发现模型，并提供常见供应商预设。
- 将 API key 存入 Windows 用户级安全存储，并向 OMP 写入命令解析的密钥引用。
- 提供 OpenAI Codex 与 Anthropic 的 OMP CLI OAuth 状态和登录入口。

## 不会做什么

- 不读取或修改 OMP 的 `agent.db`、OAuth refresh token 或账号轮换状态。
- 不自动写入项目目录中的 `.omp` 覆盖配置。
- 不把 API key、快照、诊断日志或默认导出上传到云端。
- 当前不提供本地请求代理、故障转移、成本统计或系统托盘切换。

## 从源码运行

### 前提

- Windows 10/11
- Node.js 24 或更高版本
- pnpm 11 或更高版本
- .NET SDK 10.0，用于构建 Windows console secret bridge

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## 验证与打包

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm package:win
```

`pnpm package:win` 会在 `dist/` 生成 NSIS 安装包和 portable 包。它们是本地构建产物，不会提交到 Git。

## 凭据安全

API key 由 Electron `safeStorage` 在 Windows 上使用用户级 DPAPI 保护。OMP Switch 只在应用自己的数据目录保存密文，并将类似下面的命令引用写入 OMP 配置：

```yaml
apiKey: '!"...\\omp-switch-secret.exe" --secret-get "credential-id" --data-dir "..."'
```

随应用提供的 `omp-switch-secret.exe` 是 Windows console 程序：成功时只向 stdout 输出密钥，失败时只向 stderr 输出错误并返回非零状态。它不会在日志中记录密钥，且 GUI 退出后仍可供 OMP 调用。

不要提交 OMP 配置、应用数据目录、截图、Issue 或日志中的 API key、OAuth token、完整会话内容或个人路径。

## Profile 与恢复

OMP Switch 管理以下用户级路径：

- 默认 Profile：`~/.omp/agent/`
- 命名 Profile：`~/.omp/profiles/<name>/agent/`

每次写入前都会创建本机快照。若检测到其他工具或手工编辑在读取后修改了文件，应用会停止写入并要求重新载入，而不是静默覆盖。

## v0.2 路线

- OMP catalog 优先的模型目录、扩展 discovery 与可审计预设导入。
- 稳定 JSON CLI、脱敏/加密导出、增强诊断和严格迁移恢复。
- 可选的 loopback 独立网关、健康检查、API-key 故障转移与本地用量摘要。
- GitHub Release 校验和、构建溯源和安全更新检查。

这些能力在实现和验证完成前不会被标记为已支持功能。

## 贡献与安全

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告；不要在公开 Issue 中粘贴任何密钥或完整配置。

## 许可证

本项目采用 [MIT License](LICENSE)。
