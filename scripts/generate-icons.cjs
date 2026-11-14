// Render the vector source in a hidden sandboxed window; no external service.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', path.resolve('.local/icon-renderer'));
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const svg = fs.readFileSync(path.resolve('public/codeguard.svg'), 'utf8');
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`,
    );
    const rendered = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1024;
        canvas.getContext('2d').drawImage(image, 0, 0, 1024, 1024);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => reject(new Error('Cannot render CodeGuard SVG'));
      image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
    })`);
    const painted = nativeImage.createFromDataURL(rendered);
    assert.ok(!painted.isEmpty());
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const frames = sizes.map((size) =>
      painted.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    );
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const entry = 6 + 16 * index;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(frames[index].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += frames[index].length;
      assert.deepEqual(nativeImage.createFromBuffer(frames[index]).getSize(), {
        width: size,
        height: size,
      });
    });
    const directory = path.resolve('electron/assets');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'codeguard.png'), frames.at(-1));
    fs.writeFileSync(path.join(directory, 'codeguard.ico'), Buffer.concat([header, ...frames]));
    assert.ok(!nativeImage.createFromPath(path.join(directory, 'codeguard.ico')).isEmpty());
    console.log('Generated CodeGuard PNG and ICO: ' + sizes.join(', '));
    window.destroy();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode || 0));
