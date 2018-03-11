const vscode = require('vscode');
const bzl = require('./bzl_cmds')

async function activate(context) {
    var available_cmds = [{
            'cmd_id' : 'bazel.buildTarget',
            'cmd_name' : 'Bazel Build',
            'cmd_desc' : 'Build a bazel target',
            'cmd_func' : bzl.bzlBuildTarget
        },
        {
            'cmd_id' : 'bazel.runTarget',
            'cmd_name' : 'Bazel Run',
            'cmd_desc' : 'Run a bazel target',
            'cmd_func' : bzl.bzlRunTarget
        },
        {
            'cmd_id' : 'bazel.createCppProps',
            'cmd_name' : 'Bazel Cpp',
            'cmd_desc' : 'Create Cpp Properties',
            'cmd_func' : bzl.bzlCreateCppProps
        }
    ]
    var is_workspace_available = await bzl.bzlTryInit(context)
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

function deactivate() {
}

function addCommandButton(cmd_id, cmd_name, cmd_desc) {
    var item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
    item.tooltip = cmd_desc
    item.color = 'Aquamarine'
    item.text = '$(terminal) ' + cmd_name
    item.command = cmd_id
    item.show()
}

module.exports = {
    activate : activate,
    deactivate : deactivate
}