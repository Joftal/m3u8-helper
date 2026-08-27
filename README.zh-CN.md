<div align="center">

# 🎬 m3u8-helper

<p>
  <img src="https://img.shields.io/badge/Electron-35-2b2d30?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS-%E6%94%AF%E6%8C%81-0078d4?logo=apple&logoColor=white" alt="Windows and macOS" />
</p>

<p>
  <a href="README.md">English</a> | <a href="README.zh-CN.md">中文</a>
</p>

基于 [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) 的桌面端流媒体下载工具，
把命令行能力做成更好用、更稳、更省心的下载助手 🚀

</div>

<p align="center">
  <img src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80" alt="视频下载工具" width="1000" />
</p>

## ✨ 这是什么

`m3u8-helper` 是一个支持 Windows 和 macOS 的桌面端流媒体下载工具。

简单来说：

- 粘贴链接
- 配置参数
- 一键开始下载
- 实时看进度、日志和速度
- 任务中断后还能自动恢复

它把命令行下载器的能力包装成了一个更适合日常使用的桌面应用。

## 🧠 项目亮点

- 统一下载参数入口，不再反复改命令行参数
- 实时展示任务状态，包括进度、速度、日志和 ETA
- 支持任务恢复，重启后不容易变成“僵尸任务”
- 支持直播录制场景，关闭应用时会给出明确选择
- 本地存储设置、历史记录、定时任务，整体体验更完整

## 🏗️ 架构

```text
React 前端
   ↓
Electron IPC
   ↓
主进程（下载 / 录制 / 定时 / 存储）
   ↓
N_m3u8DL-RE + ffmpeg + mp4decrypt
```

## 🏃 快速开始

### 安装

```bash
git clone https://github.com/Joftal/m3u8-helper.git
cd m3u8-helper
npm install
```

### 开发

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 打包

```bash
npm run package:win   # Windows
npm run package:mac   # macOS
```

### CI 构建与发布（GitHub Actions）

- 自动发布：推送标签，例如 `v1.0.0`
- 手动发布：在 Actions 中运行 **Build and Release**，并填写：
  - `tag`（必填）
  - `draft`（`true` 表示仅草稿发布）
  - `prerelease`（`true` 表示预发布）
- Release Notes（版本更新说明）会基于提交/PR 自动生成
- 工作流文件：`.github/workflows/build-and-release.yml`

## 🧪 前置要求

- Node.js >= 18
- Windows 11+ 或 macOS 12+
- `N_m3u8DL-RE` 可执行文件（Windows 为 `N_m3u8DL-RE.exe`，macOS 为 `N_m3u8DL-RE`）
- 如需解密 / 混流：`ffmpeg` / `mp4decrypt`

## 📁 项目结构

```text
m3u8-helper/
├── electron/        # 主进程：下载、IPC、任务管理
├── src/             # 前端：状态与类型定义
├── resources/       # 图标资源
├── README.md
├── README.zh-CN.md
├── package.json
├── electron.vite.config.ts
├── tsconfig*.json
└── ...
```

## 💡 使用方式

1. 打开应用
2. 配置 `N_m3u8DL-RE` / `ffmpeg` / `mp4decrypt` 路径
3. 设置默认保存目录
4. 粘贴 m3u8 / MPD / ISM 链接
5. 点击开始下载
6. 在任务列表里实时查看进度和日志

## 📌 一句话总结

如果你想要一个更像“桌面工具”而不是“命令行黑框”的流媒体下载助手，`m3u8-helper` 就是这个方向。 😎

---

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>
