# m3u8-box

基于 [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) 的流媒体下载工具箱，提供简洁的图形界面。

## 功能

- HLS / DASH / MSS 流媒体下载
- 批量下载队列
- 直播录制（实时合并、管道混流）
- 剪贴板自动检测 m3u8 链接
- 完整的下载参数配置
- 实时进度、速度、日志展示
- 下载历史记录
- 白色清新 UI

## 截图

> 启动后可见白色简洁界面

## 前置要求

1. **Node.js** >= 18
2. **N_m3u8DL-RE** — 需要先编译或下载 release 版本的 exe

## 安装

```bash
git clone https://github.com/Joftal/m3u8-box.git
cd m3u8-box
npm install
```

## 开发

```bash
npm run dev
```

## 构建

```bash
npm run build
```

## 打包

```bash
npm run package
```

## 使用

1. 启动 `npm run dev`
2. 进入 **设置**，配置 `N_m3u8DL-RE.exe` 路径
3. 配置默认保存目录
4. 回到首页，粘贴 m3u8 链接即可下载

## 技术栈

- Electron
- React 19 + TypeScript
- Tailwind CSS
- Zustand
- Vite

## 相关项目

- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) — 核心下载引擎

## License

MIT
