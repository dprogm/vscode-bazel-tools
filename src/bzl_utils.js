const child_proc = require('child-process-async');
const vscode = require('vscode')
const Workspace = vscode.workspace
const Window = vscode.window

// * Execute our bazel command
// * Make the terminal visible to the user
async function bzlRunCommandInTerminal(ctx, cmd) {
    var term = Window.createTerminal()
    term.sendText(cmd)
    term.show()
    // For disposal on deactivation
    ctx.subscriptions.push(term)
}

// Executes a bazel command, e.g. query or build.
async function bzlRunCommandFromShell(cmd_args) {
    return child_proc.exec('"bazel" ' + cmd_args, {
        'cwd': Workspace.workspaceFolders[0].uri.fsPath
    })
}

// Checks whether the opened folder defines a bazel workspace
async function bzlHasWorkspace() {
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

module.exports = {
    bzlRunCommandInTerminal : bzlRunCommandInTerminal,
    bzlRunCommandFromShell : bzlRunCommandFromShell,
    bzlHasWorkspace : bzlHasWorkspace
}