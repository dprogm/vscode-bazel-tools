import * as vscode from 'vscode';
import { commands } from './commands';

export async function activate(context: vscode.ExtensionContext) {
    if (vscode.workspace.workspaceFolders !== undefined) {
        var availableCommands = [
            {
                cmd_id: 'bazel.buildTarget',
                cmd_name: 'Bazel Build',
                cmd_desc: 'Build a bazel target',
                cmd_func: commands.bzlBuildTarget
            },
            {
                cmd_id: 'bazel.runTarget',
                cmd_name: 'Bazel Run',
                cmd_desc: 'Run a bazel target',
                cmd_func: commands.bzlRunTarget
            },
            {
                cmd_id: 'bazel.clean',
                cmd_name: 'Bazel Clean',
                cmd_desc: 'Delete the output directories',
                cmd_func: commands.bzlClean
            },
            {
                cmd_id: 'bazel.createCppProps',
                cmd_name: 'Bazel C++ Project',
                cmd_desc: 'Create a c_cpp_properties.json project file',
                cmd_func: commands.bzlCreateCppProps
            },
            {
                cmd_id: 'bazel.showDepGraph',
                cmd_name: 'Show dependencies graph',
                cmd_desc: 'Show a tree of dependencies',
                cmd_func: commands.bzlShowDepGraph
            }
        ];

        const is_workspace_available = await commands.tryInit(context);
        const bzl_config = vscode.workspace.getConfiguration('bazel');
        availableCommands.forEach(cmd_desc => {
            context.subscriptions.push(
                vscode.commands.registerCommand(cmd_desc.cmd_id, () => {
                    cmd_desc.cmd_func(context);
                })
            );
            if (is_workspace_available && !bzl_config.get<Boolean>('hideCommandButtons')) {
                addCommandButton(cmd_desc.cmd_id, cmd_desc.cmd_name, cmd_desc.cmd_desc);
            }
        });
    }
}

export function deactivate() {}

function addCommandButton(cmd_id: string, cmd_name: string, cmd_desc: string) {
    let item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    item.tooltip = cmd_desc;
    item.text = '$(terminal) ' + cmd_name;
    item.command = cmd_id;
    item.show();
}
