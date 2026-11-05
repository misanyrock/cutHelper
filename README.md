<p align="center">
  <img src="public/icon.png" alt="CutHelper 图标" width="112" height="112" />
</p>

<h1 align="center">CutHelper</h1>

<p align="center">剪掉冗长停顿，保留你的表达节奏。</p>
<p align="center">离线口播自动粗剪 · macOS / Windows · 无账号 · 素材不上传</p>

CutHelper 是一个桌面端剪辑辅助工具，适合课程、访谈、自媒体口播。导入一段视频，自动找出长停顿，检查保留或删除，再导出粗剪视频或可继续编辑的时间线。

## 应用界面

![CutHelper 桌面工作台](docs/images/workspace.png)

*真实桌面应用截图：静音片段检查、视频预览、参数调整、波形时间线和多格式导出。画面中的视频为自动生成的测试素材。*

<details>
<summary>查看导入界面</summary>

![CutHelper 导入界面](docs/images/import.png)

</details>

## 主要功能

- **自动粗剪**：根据音量和停顿时长检测静音，为语音两侧保留可调保护区。
- **检查与恢复**：片段列表、波形和播放位置联动，逐段保留或删除。
- **真实预览**：切换原片与粗剪；人工修改后重新生成预览，避免播放旧结果。
- **五种导出**：MP4、Premiere XML、达芬奇 XML、Final Cut Pro FCPXML、剪映分段素材包。
- **本地项目**：保存参数和人工选择，素材移动后可重新定位。
- **常见素材处理**：保留 29.97 fps 等有理数帧率，处理可变帧率和手机旋转信息。

## 获取桌面版

当前为 **v0.1.1 本地验证版**。源码与构建配置已提供；本次 GitHub 推送不包含安装包，尚未发布 GitHub Release。

在项目目录运行 `npm run dist:mac` 或 `npm run dist:win` 可生成安装包。Mac 包为未签名本地构建；Windows 和专业剪辑软件实际导入兼容性仍待对应环境验证。

## 开发与运行

使用 Node.js 22 LTS 和 npm：

```sh
git clone https://github.com/misanyrock/cutHelper.git
cd cutHelper
npm ci
npm run dev
```

首次安装需联网下载 Electron、FFmpeg 和 npm 依赖；安装完成后运行无需网络。安装包自带 FFmpeg、FFprobe。`npm run dev` 会启动 Vite 并打开真实桌面窗口，关闭桌面窗口后开发服务器退出。修改主进程或 preload 后需重启开发命令。

```sh
npm test                 # 区间与格式单元测试、真实 FFmpeg 集成测试
npm run build            # TypeScript 检查、前端和主进程编译
npm run test:desktop     # 构建后用 Playwright 测试真实 Electron 工作流
npm run pack             # 本机可运行的应用目录
npm run dist:mac         # 在 Mac 上生成 DMG
npm run dist:win         # 在 Windows 上生成 NSIS 安装包
```

桌面测试需要可用的图形桌面会话，测试对话框由自动化适配，不会操作用户素材。测试样本创建在系统临时目录。构建产物位于 `release/`，不进入 Git。支持当前 macOS 的 Apple Silicon 开发与打包；Windows x64 构建配置见 `.github/workflows/build.yml`。跨平台安装包需在对应系统构建、验证，不将本机 Mac 验证等同于 Windows 验证。

## 使用

1. 点击「导入视频」或拖入一个 MP4、MOV、MKV。导入会检查帧率、读取波形并生成浏览器可播放的预览，长视频可能需要等待。
2. 默认以 −35 dB 检测至少 0.6 秒的静音，在语音两侧各保留 0.12 秒。点「分析停顿」。轻声被切掉时降低阈值，停顿太碎时增大最短停顿。
3. 在左侧或波形选择候选静音，切换保留/删除；也可恢复全部。波形点击定位，方向键以 1 秒移动播放位置。
4. 点「粗剪」生成并播放真实粗剪预览。修改片段后回到原片，下次切换粗剪会重新生成；参数变化需重新分析后才会改变片段。
5. 顶部保存图标将当前参数、分析参数和人工选择保存为 `.cuthelper.json`。打开项目时，若原素材缺失或发生变化，按提示重新定位同一视频。项目引用素材，不嵌入视频。
6. 点「导出」选择需要的格式。导出前请确认保留区间；全静音时需恢复至少一段。任务可取消，失败不会将未完成文件写成最终成片。

## 导出兼容

| 输出 | 使用方式 | 保留裁切余量 |
| --- | --- | --- |
| MP4 | H.264 / AAC，可直接播放；重新编码，源分辨率 | 否 |
| Premiere XML | Premiere 的文件 → 导入，传统 FCP 7 XML | 是 |
| 达芬奇 XML | DaVinci Resolve 的文件 → 导入 → 时间线 | 是 |
| Final Cut Pro FCPXML | Final Cut Pro 的文件 → 导入 → XML，FCPXML 1.9 | 是 |
| 剪映素材包 | 批量导入按文件名编号的 MP4 并依次拖入时间线 | 否 |

时间线文件旁附导入说明，原素材需保持可访问，移动后在编辑器中重新链接。Premiere 使用的传统 XML 与 Final Cut Pro FCPXML 是不同格式。剪映输出为真实独立视频片段，不是私有原生草稿。

可变帧率素材先生成 30 fps 恒定帧率工作副本，界面会提示；视频、预览和时间线共用工作副本。导出时间线时将完整工作副本复制到旁边的 `*-媒体` 目录，一起保留该目录。携带旋转信息的手机视频会先转换为正确方向的工作副本。恒定帧率素材保留源有理数帧率，例如 30000/1001。项目与编码区间内部以整数微秒表达，最终统一对齐视频帧。

## v0.1.1 修复

修复部分素材点击粗剪预览时报 `media.fpsNum` 超过 100 万的问题。帧率是分数，较大的分子、分母依然可能表示正常帧率；现在保留 FFmpeg 支持的合法有理数，读取时只做无损约分，并在平均帧率无效时回退到有效的轨道帧率。回归测试包含大分子/分母素材的真实预览编码。

## 首版边界

- 一次一个 SDR 视频，使用首个非封面视频轨与首个音轨，输出最多双声道。字幕、多机位、多音轨混音、特效和转场不在首版中。
- 静音检测按音量判断，不理解语义；带持续背景音乐的素材、口误和重复语句需要人工处理。
- 应用预览使用 720p 代理；最终 MP4 保持工作素材分辨率。HDR 会提示先转成 SDR。
- 应用数据在 Electron 的用户数据目录 `CutHelper/media`（开发模式可能为 `cuthelper/media`）。包含恒定帧率副本与临时预览；正常退出会清理本次预览。保存的项目可能引用工作副本，不应在使用项目期间删除整个数据目录。
- 首版为未签名本地构建，没有公开发布或自动更新。Windows、Premiere、Resolve、Final Cut Pro 的实际导入测试须在具备对应系统及软件的环境完成；结构测试不等同于软件导入兼容认证。

## 图标与品牌资源

新图标以青绿色圆角方形为底，将播放符号和剪切断口组合在一起。页头、Dock、窗口和安装包共用这一标识。

- `public/icon.svg`：可编辑的矢量源文件，同时用于界面和 favicon。
- `public/icon.png`：1024 × 1024 透明背景 PNG。
- `build/icon.icns` / `build/icon.ico`：Mac / Windows 安装包图标。

修改 SVG 后，使用已安装的 Google Chrome 运行 `npm run icons`，生成各平台资源。生成结果随源码提交，日常构建和 CI 不需要安装 Chrome。

## 验证与当前状态

| 检查 | 状态 |
| --- | --- |
| TypeScript 与生产构建 | 通过 |
| 剪辑模型、XML 与真实 FFmpeg 测试 | 14 项通过 |
| macOS 打包应用完整工作流 | 已验证导入、分析、恢复、播放、项目保存、五种导出和素材重定位 |
| 桌面和窄屏界面 | 已检查；桌面 1536 × 1024、窄屏 390 × 844 |
| Windows 运行 / 专业编辑器内导入 | 待对应环境验证 |

## 推送标签自动打包

推送 `v*` 标签会自动运行 `.github/workflows/build.yml`，也可在 [Actions → Build desktop](https://github.com/misanyrock/cutHelper/actions/workflows/build.yml) 手动运行。

每次构建先校验标签与 `package.json` 版本一致，再安装依赖、运行真实媒体测试，最后分别生成：

| 平台 | 安装包 | Actions 产物名称 |
| --- | --- | --- |
| macOS Apple Silicon | `.dmg` | `CutHelper-版本-macOS-arm64` |
| macOS Intel | `.dmg` | `CutHelper-版本-macOS-x64` |
| Windows x64 | `.exe`（NSIS） | `CutHelper-版本-Windows-x64` |

后续发布新版本，在干净的 `main` 分支运行：

```sh
npm version patch -m "chore: release %s"
git push origin main --follow-tags
```

`npm version patch` 会同步更新版本号、创建提交和版本标签（例如 `v0.1.2`）。标签必须指向包含新工作流的提交，旧标签不会自动回补构建；已推送的版本标签不应改写。

构建完成后，进入对应 Actions 运行页面，在 **Artifacts** 下载各平台安装包压缩包。产物保留 30 天；该工作流不自动创建 GitHub Release，也不发布自动更新，Mac 包仍为未签名构建。

## 仓库规则

`.gitignore` 排除依赖、编译结果、安装包、用户视频、项目文件、缓存、测试报告和本地凭据。文档截图、图标及必要设计参考保留在仓库中。请勿提交个人素材或 API 密钥。

## 代码结构

`electron/`：受限 IPC、媒体子进程、项目文件、XML 导出。`shared/`：项目校验、帧与时间换算、剪辑模型。`src/`：React 工作台及波形、参数、片段组件。`tests/`：纯逻辑及真实媒体测试。设计基准见 `docs/design/workspace.png` 和 `docs/design/spec.md`。

IPC 仅提供导入、分析、预览、保存、打开、导出、取消与任务进度；渲染进程无 Node.js 权限。播放 URL 使用内部令牌映射，不提供任意文件 URL。FFmpeg 以参数数组执行，无 shell 拼接。导出临时文件位于目标目录，成功后重命名完成写入。

应用源码遵循 [Apache-2.0](LICENSE)；媒体二进制及其他第三方许可见 [第三方说明](docs/THIRD_PARTY.md)。
