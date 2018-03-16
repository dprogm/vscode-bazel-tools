import { TextDocumentContentProvider, CancellationToken, ProviderResult, Uri } from 'vscode'

export class GraphView implements TextDocumentContentProvider {
    provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string> {
        return 'not yet implemented ' + uri.fsPath
    }
}