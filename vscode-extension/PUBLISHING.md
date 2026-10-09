# Publishing

## Build a VSIX

```sh
npm ci
npm run package
```

This creates one universal VSIX. The extension bundles the same Python source on every platform and installs dependencies into a private environment using the user's Python installation, so separate VSIX files per OS, architecture, or Python version are not needed.

GitHub Actions checks dependency installation on Linux with Python 3.10–3.14, and on macOS and Windows with Python 3.12.

## Upload to the Marketplace

Sign in at the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/SEALab) and upload the VSIX to the SEALab extension.

## Run from source

```sh
npm ci
npm run debug
```

This builds the extension and opens a VS Code Extension Development Host with Rationale loaded. The first activation installs Python dependencies. You can also open this folder in VS Code and press **F5** to use the **Run Rationale Extension** launch configuration.
