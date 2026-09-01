import * as vscode from 'vscode';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * VS Code sidebar view.
 *
 * Like the browser side panel, this frames the panel the daemon already serves
 * rather than reimplementing it. `portMapping` lets the webview reach
 * 127.0.0.1 despite its sandboxed origin.
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ShortsViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeShorts.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('claudeShorts.open', () => {
      void vscode.commands.executeCommand('claudeShorts.panel.focus');
    }),
    vscode.commands.registerCommand('claudeShorts.reload', () => provider.refresh()),
  );
}

export function deactivate(): void { /* the daemon outlives the editor on purpose */ }

class ShortsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private context: vscode.ExtensionContext) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    const port = this.port();

    view.webview.options = {
      enableScripts: true,
      // Without this, 127.0.0.1 is unreachable from inside the webview.
      portMapping: [{ webviewPort: port, extensionHostPort: port }],
    };

    await this.render();
  }

  refresh(): void { void this.render(); }

  private port(): number {
    return vscode.workspace.getConfiguration('claudeShorts').get<number>('port', 8787);
  }

  private cli(): string {
    return vscode.workspace.getConfiguration('claudeShorts').get<string>('command', 'shorts');
  }

  private async render(): Promise<void> {
    if (!this.view) return;
    const port = this.port();

    let token: string | null = null;
    try {
      token = await this.token();
    } catch {
      token = null;
    }

    if (!token) {
      this.view.webview.html = errorHtml(
        'The claude-shorts CLI was not found.',
        'Install it with <code>npm i -g claude-shorts</code>, then run <code>Shorts: Reconnect to daemon</code>.',
      );
      return;
    }

    if (!(await this.daemonUp(port))) {
      const auto = vscode.workspace.getConfiguration('claudeShorts').get<boolean>('autoStartDaemon', true);
      if (auto) {
        spawn(this.cli(), ['serve'], { detached: true, stdio: 'ignore' }).unref();
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!(await this.daemonUp(port))) {
        this.view.webview.html = errorHtml(
          `No daemon on port ${port}.`,
          'Run <code>shorts serve</code> in a terminal, then <code>Shorts: Reconnect to daemon</code>.',
        );
        return;
      }
    }

    const src = `http://127.0.0.1:${port}/panel?token=${encodeURIComponent(token)}`;
    this.view.webview.html = frameHtml(src, port);
  }

  private async token(): Promise<string> {
    const { stdout } = await run(this.cli(), ['token'], { timeout: 5000 });
    return stdout.trim();
  }

  private async daemonUp(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

function frameHtml(src: string, port: number): string {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src http://127.0.0.1:${port} http://localhost:${port}`,
  ].join('; ');

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body><iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe></body>
</html>`;
}

function errorHtml(title: string, body: string): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { font: 13px/1.6 var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h2 { font-size: 13px; margin: 0 0 8px; }
  p { color: var(--vscode-descriptionForeground); }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body><h2>${title}</h2><p>${body}</p></body></html>`;
}
