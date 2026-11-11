import * as path from 'path';
import * as vscode from 'vscode';

import { Preview, StyleConfiguration } from './preview-manager';
import { getCSP } from '../security/CSP';
import { initRPCExtensionSide } from '../rpc-extension';

const VIEW_TYPE = 'mdx.preview';
const MDX_PREVIEW_FOCUS_CONTEXT_KEY = 'mdxPreviewFocus';

let panel: (vscode.WebviewPanel | undefined);
let panelDoc: (vscode.TextDocument | undefined);
let disposables: vscode.Disposable[] = [];
let extensionContext: vscode.ExtensionContext | undefined;

function toWebviewUri(webview: vscode.Webview, fileUri: vscode.Uri): string {
    if (typeof webview.asWebviewUri === 'function') {
        return webview.asWebviewUri(fileUri).toString();
    }
    return fileUri.with({ scheme: 'vscode-resource' }).toString(true);
}

export function initWebviewAppHTMLResources(context: vscode.ExtensionContext) {
    extensionContext = context;
}

function getWebviewAppHTML(
    webview: vscode.Webview,
    baseHref: string,
    contentSecurityPolicy: string,
    styleConfiguration: StyleConfiguration
) {
    if (!extensionContext) {
        return;
    }
    const { extensionPath } = extensionContext;
    let mainScript = '';
    let mainStyle = '';
    let chunkPath = '';
    let runtimePath = '';

    try {
        const manifest = require(path.join(extensionPath, 'build', 'webview-app', 'asset-manifest.json'));
        mainScript = manifest['main.js'] || '';
        mainStyle = manifest['main.css'] || '';
        const chunkKey = Object.keys(manifest).find(key => key.endsWith('chunk.js'));
        chunkPath = chunkKey ? path.join(extensionPath, 'build', 'webview-app', manifest[chunkKey]) : '';
        runtimePath = manifest['runtime~main.js'] ? path.join(extensionPath, 'build', 'webview-app', manifest['runtime~main.js']) : '';
    } catch {
        // Build files might not exist during tests
    }

    const styleHref = mainStyle ? toWebviewUri(webview, vscode.Uri.file(path.join(extensionPath, 'build', 'webview-app', mainStyle))) : '';
    const runTimeMainSrc = runtimePath ? toWebviewUri(webview, vscode.Uri.file(runtimePath)) : '';
    const chunkSrc = chunkPath ? toWebviewUri(webview, vscode.Uri.file(chunkPath)) : '';
    const scriptSrc = mainScript ? toWebviewUri(webview, vscode.Uri.file(path.join(extensionPath, 'build', 'webview-app', mainScript))) : '';

    const {
      useVscodeMarkdownStyles,
      useWhiteBackground,
    } = styleConfiguration;
    let styleNodeHTML: string;
    let overrideBodyStyles = useWhiteBackground ? `body {
    color: black;
    background: white;
}`: '';
    let overrideDefaultStyles = (!useVscodeMarkdownStyles)
        ? `code {
  color: inherit;
}
blockquote {
  background: inherit;
}`: '';
    if (overrideBodyStyles || overrideDefaultStyles) {
        styleNodeHTML = `<style type="text/css">
  ${overrideBodyStyles}
  ${overrideDefaultStyles}
</style>`;
    } else {
        styleNodeHTML = '';
    }

    const webviewAppHTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MDX Preview</title>
        <link rel="stylesheet" type="text/css" href="${styleHref}">
        <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
        <base href="${baseHref}">
        ${styleNodeHTML}
    </head>
    <body>
        <div id="root"></div>
        <script crossorigin="anonymous" src="${runTimeMainSrc}"></script>
        <script crossorigin="anonymous" src="${chunkSrc}"></script>
        <script crossorigin="anonymous" src="${scriptSrc}"></script>
    </body>
</html>`;
    return webviewAppHTML;
}

function dispose() {
    if (panel) {
        panel.dispose();
    }
    while (disposables.length) {
        const disposable = disposables.pop();
        if (disposable) {
            disposable.dispose();
        }
    }
    panel = undefined;
}

function setPanelHTMLFromPreview(preview: Preview) {
    if (!panel) {
        return;
    }
    const { doc, styleConfiguration, securityConfiguration } = preview;
    const previewBaseHref = toWebviewUri(panel.webview, doc.uri);
    const cspSource = panel.webview.cspSource || 'vscode-resource:';
    const webviewAppHTML = getWebviewAppHTML(panel.webview, previewBaseHref, getCSP(securityConfiguration, cspSource), styleConfiguration);
    if (webviewAppHTML) {
        panel.webview.html = webviewAppHTML;
    }
}

export function createOrShowPanel(preview: Preview) {
    const activeTextEditorColumn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
    const previewColumn = (activeTextEditorColumn || vscode.ViewColumn.One) + 1;
    const previewTitle = `Preview ${path.basename(preview.doc.fileName)}`;

    if (!panel) {
        const localRoots = extensionContext ? [
            vscode.Uri.file(extensionContext.extensionPath),
            vscode.Uri.file(path.dirname(preview.doc.fileName))
        ] : undefined;
        if (localRoots && vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                localRoots.push(folder.uri);
            }
        }

        panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            previewTitle,
            previewColumn,
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
                localResourceRoots: localRoots
            }
        );
        panelDoc = preview.doc;
        setPanelHTMLFromPreview(preview);

        vscode.commands.executeCommand('setContext', MDX_PREVIEW_FOCUS_CONTEXT_KEY, true);

        panel.onDidDispose(() => {
            preview.active = false;
            dispose();
        }, null, disposables);
        panel.onDidChangeViewState(({ webviewPanel }) => {
            vscode.commands.executeCommand('setContext', MDX_PREVIEW_FOCUS_CONTEXT_KEY, webviewPanel.active);
        }, null, disposables);
        
        preview.initWebviewHandshakePromise();
        const webviewHandle = initRPCExtensionSide(preview, panel.webview, disposables);
        preview.webviewHandle = webviewHandle;
    } else {
        if (panelDoc !== preview.doc) {
            panel.title = previewTitle;
            setPanelHTMLFromPreview(preview);
            panelDoc = preview.doc;
        }
        panel.reveal(previewColumn);

        vscode.commands.executeCommand('setContext', MDX_PREVIEW_FOCUS_CONTEXT_KEY, true);
    }
    preview.active = true;
    return panel;
}

export function refreshPanel(preview: Preview) {
    if (!panel) {
        return;
    } else {
        // reveal in current column, and preserves focus
        panel.reveal(undefined, true);
        panel.webview.html = '';
        setPanelHTMLFromPreview(preview);
    }
}
