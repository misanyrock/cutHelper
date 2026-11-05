# 第三方组件

应用界面与应用逻辑采用 Apache-2.0 许可证。第三方组件保留各自许可证。

- Electron：MIT，https://github.com/electron/electron
- React：MIT，https://github.com/facebook/react
- Lucide：ISC，https://lucide.dev/license
- ffmpeg-static：GPL-3.0-or-later；下载的 FFmpeg 构建包含 libx264 等 GPL 组件，不能视为纯 LGPL 构建。项目与构建说明：https://github.com/eugeneware/ffmpeg-static
- @ffprobe-installer/ffprobe：MIT（封装器）；ffprobe 二进制遵循其 FFmpeg 构建许可证，https://github.com/SavageCore/node-ffprobe-installer
- FFmpeg 源码与构建许可：https://ffmpeg.org/download.html 、https://ffmpeg.org/legal.html

安装包在 resources/media 中包含这份说明、构建来源以及依赖自带许可证。当前产物为本地开发/验证构建；向第三方分发包含 GPL 二进制的安装包时，须一并履行对应源码、构建脚本和许可证提供义务。应用未配置公开发布或自动更新。
