# S-Notes

S-Notes is an Electron desktop application for private, always-on-top floating notes. On Windows, private mode excludes the window from screen capture using the native `SetWindowDisplayAffinity` API.

## Features

- Frameless, resizable floating notes window
- System tray controls and `Ctrl+M` / `Cmd+M` visibility toggle
- Optional always-on-top behavior
- Configurable opacity, font size, and font family
- Persistent local notes and window settings
- Private mode for excluding the note window from screen sharing and recordings on Windows
- Resume text extraction and OCR support
- Groq and Gemini AI integrations

## Requirements

- Node.js 18 or newer
- Windows is required for native screen-capture exclusion; other features work wherever Electron is supported.

## Run Locally

```bash
npm install
npm start
```

The app is accessible from the system tray and does not appear in the Windows taskbar. Use `Ctrl+M` to show or hide it.

## Build

```bash
npm run build
```

This creates a Windows x64 packaged application in the `build` directory.

## Configuration

Application settings and notes are stored in Electron's per-user application data directory. API keys for supported AI providers are entered through the application and are not stored in this repository.

## License

MIT