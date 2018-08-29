import {
    workspace as Workspace,
    window as Window,
    commands as Commands,
    ViewColumn,
    InputBoxOptions,
    ExtensionContext,
    Uri,
    QuickPickItem,
    QuickPickOptions
} from 'vscode'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as bzl_defines from './defines'
import * as bzl_utils from './utils'

interface BazelQueryItem {
    kind: string
    label: string
}

interface BazelQueryQuickPickItem extends QuickPickItem {
    query_item: BazelQueryItem
}

function bzlMakeQueryQuickPickItemParsed(queryItem: BazelQueryItem) {
    let {ws, pkg, target} = bzlDecomposeLabel(queryItem.label);
    let lang = bzl_defines.bzlTranslateRuleKindToLanguage(queryItem.kind)

    return {
        label: target,
        description: "",
        detail: `${lang} | ws{${ws}} | pkg{${pkg}}`,
        query_item: queryItem
    }
}

function bzlMakeQueryQuickPickItemParsedRaw(queryItem: BazelQueryItem) {
    return {
        label: queryItem.label,
        description: "",
        detail: queryItem.kind,
        query_item: queryItem
    }
}

function bzlMakeQueryQuickPickItem(queryItem: BazelQueryItem): BazelQueryQuickPickItem {
    let bzl_config = Workspace.getConfiguration('bazel')
    return bzl_config.get('rawLabelDisplay') ?
        bzlMakeQueryQuickPickItemParsedRaw(queryItem) :
        bzlMakeQueryQuickPickItemParsed(queryItem)
}

async function bzlQuickPickQuery(query: string = '...', options?: QuickPickOptions) {
    return Window.showQuickPick(bzlQuery(query).then(deps => {
        return deps.map(bzlMakeQueryQuickPickItem);
    }, err => {
        Window.showQuickPick([], {
            placeHolder: "<ERROR>"
        })
        Window.showErrorMessage(err.toString())
        return [];
    }), options);
}

async function bzlQuery(query: string = '...'): Promise<BazelQueryItem[]> {
    let bzl_config = Workspace.getConfiguration('bazel')
    let excluded_packages = bzl_config.packageExcludes.join(',')
    let stdout = await bzl_utils.bzlRunCommandFromShell('query '
        + `"${query}"`
        + ' --noimplicit_deps'
        + ' --nohost_deps'
        + ' --deleted_packages=' + excluded_packages
        + ' --output label_kind'
    ).then(child => child.stdout)

    stdout = stdout.trim();
    let deps = stdout ? stdout.split('\n') : [];
    let sep = ' rule ';

    return deps.map((dep:string) => {
        let idx = dep.search(sep)
        let rule_kind = dep.substr(0, idx)
        let target_label = dep.substr(idx+sep.length)

        let item: BazelQueryItem = {
            kind: rule_kind,
            label: target_label
        }
        return item;
    });
}

// Split the bazel label into its atomic parts:
// workspace name, package and target (name)
//
// Pattern: @ws_name//pkg:target
//
// The current workspace is referred to as the local
// workspace in contrast with remote workspaces that
// are identified by the prefixed at sign.
function bzlDecomposeLabel(label:string) {
    let pkg_root = '//'
    let ws_index = label.search(pkg_root)
    let ws_name = ws_index > 0
        ? label.substr(0, ws_index)
        : 'local'
    let target_idx = label.search(':')
    let pkg_offset = ws_index+pkg_root.length
    return {
        'ws' : ws_name,
        'pkg' : label.substr(pkg_offset,
            target_idx-pkg_offset),
        'target' : label.substr(target_idx+1,
            label.length-target_idx)
    }
}

export async function bzlBuildTarget(ctx: ExtensionContext) {
    let target = await bzlQuickPickQuery('...', {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: "bazel build"
    })
    if(target) {
        bzl_utils.bzlRunCommandInTerminal(ctx, `build ${target.query_item.label}`);
    }
}

export async function bzlRunTarget(ctx: ExtensionContext) {
    let target = await bzlQuickPickQuery('kind(.*_binary, deps(...))', {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: "Run bazel binary target (*_binary)"
    })
    if(target) {
        bzl_utils.bzlRunCommandInTerminal(ctx, `run ${target.query_item.label}`)
    }
}

export async function bzlClean(ctx: ExtensionContext) {
    bzl_utils.bzlRunCommandInTerminal(ctx, 'clean')
}

// Intalls our required files into the targets
// source tree under '.vscode'.
async function bzlSetupWorkspace(ws_root: string, ext_root: string) {
    try {
        let ws_dest = path.join(ws_root, bzl_defines.BAZEL_EXT_DEST_BASE_PATH)
        await fs.mkdirs(ws_dest)
        await fs.writeFile(path.join(ws_dest,
                bzl_defines.BAZEL_BUILD_FILE), '')
        await fs.copy(path.join(ext_root,
                bzl_defines.BAZEL_EXT_RES_BASE_PATH,
                bzl_defines.BAZEL_ASPECT_FILE),
            path.join(ws_dest,
                bzl_defines.BAZEL_ASPECT_FILE))
    } catch(err) {
        console.log('error during file i/o '
            + err.toString())
    }
}

// Find files by searching recursively beginning at
// a given root directory. A filename matches if it
// contains 'substr'
async function bzlFindFiles(substr: string, root: string) : Promise<string[]> {
    let found_files = []
    try {
        let files = await fs.readdir(root)
        for(let i=0; i<files.length; i++) {
            let file_path = path.join(root, files[i])
            let stats = await fs.stat(file_path)
            if(stats && stats.isDirectory()) {
                let sub_dir_files = await bzlFindFiles(substr, file_path)
                for(let j=0; j<sub_dir_files.length; j++) {
                    found_files.push(sub_dir_files[j])
                }
            }
            else {
                if(files[i].search(substr) != -1) {
                    found_files.push(file_path)
                }
            }
        }
    } catch(err) {
        console.log(err.toString())
    }
    return found_files
}

// Evaluates the passed (C++) descriptor files and generates the file
// 'c_cpp_properties.json' that makes all paths available to vscode
// under 'ws_root_dir/.vscode'.
//
// ws_root_dir: Root directory of the users workspace.
// output_root_dir: Bazels output directory.
// descriptors: Rule dependent descriptor data such as include paths.
async function bzlCreateCppProperties(ws_root_dir: string, output_root_dir: string, descriptors: any) {
    try {
        let include_paths = new Set()
        for(let i=0; i<descriptors.length; i++) {
            let buf = await fs.readFile(descriptors[i])
            let descriptor = JSON.parse(buf.toString())
            let bzl_rule_kind = descriptor.kind
            if(bzl_rule_kind == 'cc_binary'
                || bzl_rule_kind == 'cc_library'
                || bzl_rule_kind == 'cc_toolchain'
                || bzl_rule_kind == 'apple_cc_toolchain') {
                let includes = descriptor.data.includes
                for(let j=0; j<includes.length; j++) {
                    includes[j] = path.normalize(includes[j])
                    if(includes[j].split(path.sep)[0] != 'bazel-out') {
                        let abs_inc_path = includes[j]
                        if(bzl_rule_kind != 'cc_toolchain'
                            && bzl_rule_kind != 'apple_cc_toolchain') {
                            abs_inc_path = path.join(
                            output_root_dir, abs_inc_path)
                        }
                        include_paths.add(abs_inc_path)
                    }
                }
            }
        }
        let cpp_props_file = path.join(ws_root_dir,
            '.vscode', 'c_cpp_properties.json')
        let cpp_props_available = await fs.exists(cpp_props_file)
        let cpp_props_create_file = true
        if(cpp_props_available) {
            let options: InputBoxOptions = {
                prompt: 'There is already a c_cpp_properties.json file in '
                      + 'your workspace. Can we overwrite it?',
                placeHolder : 'y/yes to overwrite',
            };
            let users_decision = await Window.showInputBox(options)
            if(users_decision != 'y' && users_decision != 'yes') {
                cpp_props_create_file = false
            }
        }
        if(cpp_props_create_file) {
            let path_arr = Array.from(include_paths)
            let cpp_props_data:any = bzl_defines.bzlGetBaseCppProperties()
            for(let i=0; i<cpp_props_data.configurations.length; i++) {
                cpp_props_data.configurations[i].includePath = path_arr
                cpp_props_data.configurations[i].browse.path = path_arr
            }
            await fs.writeFile(cpp_props_file, JSON.stringify(cpp_props_data, null, 4))
            Window.showInformationMessage('c_cpp_properties.json file has been successfully created')
        }
    } catch(err) {
        console.log(err.toString())
    }
}

// * Let the user choose a root target from which we
//   are going to apply the aspect and gather all
//   cxx include paths
//
// * Create the vs code file 'c_cpp_properties.json'
//   into the destination folder and append the found
//   include paths to that file under the section
//   'includePath' as well as 'browse.path'
export async function bzlCreateCppProps(ctx: ExtensionContext) {
    try {
        let has_workspace = await bzlTryInit(ctx)
        if(has_workspace) {
            let ws_folders = Workspace.workspaceFolders
            if(ws_folders != undefined) {
                let ws_root = ws_folders[0].uri.fsPath
                let aspect_pkg = bzl_defines.BAZEL_EXT_DEST_BASE_PATH + '/' + bzl_defines.BAZEL_ASPECT_FILE
                let cmd_args = [
                    'build',
                    '--aspects',
                    aspect_pkg + '%vs_code_bazel_inspect',
                    '--output_groups=descriptor_files'
                ]
                // For c_cpp_properties we are only
                // interested in C++ targets.
                let target = await bzlQuickPickQuery('kind(cc_.*, deps(...))', {
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: "Generate cpp properties for target ..."
                })
                if(target) {
                    cmd_args.push(target.query_item.label)
                    await bzl_utils.bzlRunCommandFromShell(cmd_args.join(' '))

                    // 1) Try to find all descriptor files the bazel
                    //    aspect might have generated into the output
                    //    directory 'bazel-bin'
                    let descriptors = await bzlFindFiles('vs_code_bazel_descriptor',
                        path.join(ws_root, 'bazel-bin'))

                    // 2) Build absolute include paths based on the
                    //    relative paths from the descriptors and
                    //    the symlinked bazel workspace 'bazel-<root>'
                    //    where root is the current working directory.
                    await bzlCreateCppProperties(
                        ws_root,
                        path.join(ws_root,
                        'bazel-' + path.basename(ws_root)),
                        descriptors)
                    // 3) Cleanup all temporary descriptor files
                    for(let i=0; i<descriptors.length; i++) {
                        fs.unlink(descriptors[i])
                    }
                }
            }
        }
    } catch(err) {
        console.log(err.toString())
    }
}

export async function bzlTryInit(ctx: ExtensionContext) {
    let has_workspace = await bzl_utils.bzlHasWorkspace()
    if(has_workspace) {
        let ws_folders = Workspace.workspaceFolders;
        if(ws_folders != undefined) {
            let ws_root = ws_folders[0].uri.fsPath
            let exists = await fs.exists(path.join(ws_root,
                bzl_defines.BAZEL_EXT_DEST_BASE_PATH,
                bzl_defines.BAZEL_BUILD_FILE))
            if(!exists) {
                await bzlSetupWorkspace(ws_root, ctx.extensionPath)
            }
        }
    }
    return has_workspace
}

export async function bzlShowDepGraph(ctx: ExtensionContext) {
    let uri = Uri.parse("bazel_dep_graph://")
    Commands.executeCommand("vscode.previewHtml", uri,
        ViewColumn.Two, "Graph View")
}