# m3u8-helper

基于 [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) 的桌面端流媒体下载工具，提供简洁的图形界面与更稳定的参数配置入口。

## 功能

- HLS / DASH / MSS 流媒体下载
- 可配置的工具路径与默认保存目录
- 下载任务实时进度、速度与日志
- 下载历史记录
- 自定义参数扩展入口
- 任务参数与 CLI 选项保持一致
- 桌面化的标准工具界面

## 前置要求

1. **Node.js** >= 18
2. **N_m3u8DL-RE** — 需要准备可执行文件 `N_m3u8DL-RE.exe`
3. 如需解密功能，还需准备 `ffmpeg` / `mp4decrypt`（按实际需求）

## 安装

```bash
git clone https://github.com/Joftal/m3u8-helper.git
cd m3u8-helper
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
2. 进入 **设置**，配置 `N_m3u8DL-RE.exe`、`ffmpeg`、`mp4decrypt` 路径
3. 配置默认保存目录与参数模板
4. 返回首页，粘贴 m3u8 / MPD / ISM 链接即可下载

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
