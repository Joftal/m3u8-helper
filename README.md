<div align="center">

# 🎬 m3u8-helper

<p>
  <img src="https://img.shields.io/badge/Electron-35-2b2d30?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS-Supported-0078d4?logo=apple&logoColor=white" alt="Windows and macOS" />
</p>

<p>
  <a href="README.md">English</a> | <a href="README.zh-CN.md">中文</a>
</p>

A desktop media downloader built on [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE),
turning command-line power into a cleaner, calmer, more usable download experience 🚀

</div>

<p align="center">
  <img src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80" alt="Video downloader" width="1000" />
</p>

## ✨ What is this?

`m3u8-helper` is a desktop app for downloading streaming media on Windows and macOS.

In simple terms:

- paste a link
- set the options
- click start
- monitor speed, logs, and progress in real time
- recover interrupted work without losing the flow

It wraps the power of a command-line downloader into a desktop app that feels much easier to use every day.

## 🧠 Why it exists

- a unified download parameter entry, so you do not keep tweaking CLI flags
- real-time task status, including speed, progress, logs, and ETA
- recovery support for interrupted tasks after app restarts
- better handling for live recording scenarios with explicit close/quit choices
- a more complete local workflow for settings, history, and scheduled jobs

## 🏗️ Architecture

```text
React UI
   ↓
Electron IPC
   ↓
Main process (download / record / schedule / storage)
   ↓
N_m3u8DL-RE + ffmpeg + mp4decrypt
```

## 🏃 Quick start

### Install

```bash
git clone https://github.com/Joftal/m3u8-helper.git
cd m3u8-helper
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Package

```bash
npm run package:win   # Windows
npm run package:mac   # macOS
```

### CI build and release (GitHub Actions)

- Auto release: push a tag like `v1.0.0`
- Manual release: run workflow **Build and Release** and provide:
  - `tag` (required)
  - `draft` (`true` = draft release)
  - `prerelease` (`true` = prerelease)
- Release notes are generated automatically from commits/PRs
- Workflow file: `.github/workflows/build-and-release.yml`

## 🧪 Requirements

- Node.js >= 18
- Windows 11+ or macOS 12+
- `N_m3u8DL-RE` executable (`N_m3u8DL-RE.exe` on Windows, `N_m3u8DL-RE` on macOS)
- for decryption / remuxing: `ffmpeg` / `mp4decrypt`

## 📁 Project structure

```text
m3u8-helper/
├── electron/        # main process: download, IPC, task management
├── src/             # frontend: state and types
├── resources/       # app icons and assets
├── README.md
├── README.zh-CN.md
├── package.json
├── electron.vite.config.ts
├── tsconfig*.json
└── ...
```

## 💡 How to use

1. Open the app
2. Configure the `N_m3u8DL-RE` / `ffmpeg` / `mp4decrypt` paths
3. Set the default save directory
4. Paste a m3u8 / MPD / ISM link
5. Click start
6. Watch the task list for progress, logs, and speed updates

## 📌 Final thought

If you want a streaming download helper that feels more like a real desktop tool than a black-terminal script, `m3u8-helper` is built for that. 😎

---

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>
