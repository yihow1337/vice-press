// Takes the screenshots in shots.json with headless Chrome (Node 22, standard library only: fetch and WebSocket
// speak the DevTools protocol directly). Each scene is opened at exactly the screenshot's pixel size, waited on
// until the page sets window.__shotReady, then photographed as a JPEG whose quality steps down until the file is
// inside the 256 KiB the scorer allows.
//
//   node serve.ts --port 8123 &
//   node shoot.ts --port 8123
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const servePort = Number(flag('port', '8123'));
const debugPort = Number(flag('debug-port', '9333'));
const maxBytes = 262144;
const only = flag('only', '');
const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'))
  .filter((shot: any) => !only || shot.name.includes(only));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = mkdtempSync(join(tmpdir(), 'vice-press-shots-'));
const chrome = spawn('google-chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--disable-lcd-text',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${debugPort}`,
  'about:blank',
], { stdio: 'ignore' });

/** Waits for the DevTools endpoint to answer. */
async function devtools(): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return await response.json();
    } catch {}
    await wait(250);
  }
  throw new Error('headless Chrome did not start');
}

/** A tiny DevTools protocol client over one WebSocket. */
function connect(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, (value: any) => void>();
  let nextId = 0;
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('devtools socket failed')));
  });
  socket.addEventListener('message', (event: any) => {
    const message = JSON.parse(String(event.data));
    const settle = pending.get(message.id);
    if (settle) {
      pending.delete(message.id);
      settle(message.result);
    }
  });
  return {
    ready: open,
    close: () => socket.close(),
    send(method: string, params: Record<string, unknown> = {}) {
      const id = ++nextId;
      return new Promise<any>((resolve) => {
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

const version = await devtools();
const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
const page = connect(target.webSocketDebuggerUrl);
await page.ready;
await page.send('Page.enable');
mkdirSync(join(here, 'screenshots'), { recursive: true });

for (const shot of shots) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: false, screenWidth: shot.w, screenHeight: shot.h,
  });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${servePort}/${shot.query}` });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    await wait(100);
    const result = await page.send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
    ready = result?.result?.value === true;
  }
  if (!ready) throw new Error(`${shot.name} never reported __shotReady`);
  await wait(120);
  let data = '';
  let quality = 92;
  for (; quality >= 60; quality -= 4) {
    const result = await page.send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
    data = result.data;
    if (Buffer.from(data, 'base64').byteLength <= maxBytes) break;
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.byteLength > maxBytes) throw new Error(`${shot.name} is ${bytes.byteLength} bytes, over the cap`);
  writeFileSync(join(here, 'screenshots', shot.name), bytes);
  console.log(`${shot.name}  ${shot.w}x${shot.h}  q${quality}  ${bytes.byteLength} bytes`);
}

page.close();
chrome.kill();
console.log(`shot with ${version.Browser}`);
