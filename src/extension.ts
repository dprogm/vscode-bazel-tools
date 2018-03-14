import * as vscode from 'vscode'
import * as bzl_cmds from './commands'

export async function activate(context: vscode.ExtensionContext) {
    var available_cmds = [{
            'cmd_id' : 'bazel.buildTarget',
            'cmd_name' : 'Bazel Build',
            'cmd_desc' : 'Build a bazel target',
            'cmd_func' : bzl_cmds.bzlBuildTarget
        },
        {
            'cmd_id' : 'bazel.runTarget',
            'cmd_name' : 'Bazel Run',
            'cmd_desc' : 'Run a bazel target',
            'cmd_func' : bzl_cmds.bzlRunTarget
        },
        {
            'cmd_id' : 'bazel.createCppProps',
            'cmd_name' : 'Bazel Cpp',
            'cmd_desc' : 'Create Cpp Properties',
            'cmd_func' : bzl_cmds.bzlCreateCppProps
        }
    ]
    var is_workspace_available = await bzl_cmds.bzlTryInit(context)
    available_cmds.forEach(cmd_desc => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd_desc.cmd_id,
            () => { cmd_desc.cmd_func(context) }));
        if(is_workspace_available) {
            addCommandButton(
                cmd_desc.cmd_id,
                cmd_desc.cmd_name,
                cmd_desc.cmd_desc)
        }
    })
}

export function deactivate() {
}

function addCommandButton(cmd_id: string, cmd_name: string, cmd_desc:string) {
    var item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
    item.tooltip = cmd_desc
    item.color = 'Aquamarine'
    item.text = '$(terminal) ' + cmd_name
    item.command = cmd_id
    item.show()
}