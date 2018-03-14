import {workspace as Workspace, window as Window, ExtensionContext} from 'vscode'
const child_proc = require('child-process-async');

// * Execute our bazel command
// * Make the terminal visible to the user
export async function bzlRunCommandInTerminal(ctx: ExtensionContext, cmd:string) {
    var term = Window.createTerminal()
    term.sendText(cmd)
    term.show()
    // For disposal on deactivation
    ctx.subscriptions.push(term)
}

// Executes a bazel command, e.g. query or build.
export async function bzlRunCommandFromShell(cmd_args: string) {
    var ws_folders = Workspace.workspaceFolders
    var ws_path:string = ''
    if(ws_folders != undefined) {
        ws_path = ws_folders[0].uri.fsPath
    }
    return child_proc.exec('"bazel" ' + cmd_args, {
        'cwd': ws_path
    })
}

// Checks whether the opened folder defines a bazel workspace
export async function bzlHasWorkspace() : Promise<boolean> {
    try {
        var uris = await Workspace.findFiles('WORKSPACE')
        if(uris.length) {
            return true
        }
    } catch(error) {
        Window.showErrorMessage(error.toString())
    }
    return false;
}