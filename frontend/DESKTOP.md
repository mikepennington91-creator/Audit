# Desktop build (Windows 11)

This project can be packaged as a Windows 11 desktop app using Electron.

## Prerequisites
- Windows 11 machine
- Node.js 20.x
- Yarn 1.x (or npm)

## Install dependencies
```bash
cd frontend
npm install
```

## Run desktop app in development
```bash
cd frontend
npm run desktop:dev
```
This starts the React dev server and launches Electron pointed at `http://localhost:3000`.

## Build Windows installer
```bash
cd frontend
npm run desktop:dist
```
Artifacts are placed in `frontend/dist/` as an NSIS installer.

## Notes
- The production build loads the `build/` folder bundled with the installer.
- Update the app name or icon in `frontend/package.json` under the `build` section if needed.
