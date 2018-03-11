const bzl_defines = require('./bzl_defines')
const bzl_utils = require('./bzl_utils')
const vscode = require('vscode')
const fs = require('fs-extra')
const path = require('path')
const Workspace = vscode.workspace
const Window = vscode.window

async function bzlQueryDeps() {
    var label_desc = []
    var has_workspace = await bzl_utils.bzlHasWorkspace()
    var bzl_config = Workspace.getConfiguration('bazel')
    var excluded_packages = bzl_config.packageExcludes.join(',')
    if(has_workspace) {
        var child = await bzl_utils.bzlRunCommandFromShell('query ...'
            + ' --deleted_packages=' + excluded_packages
            + ' --output label_kind')
        var deps = child.stdout.split('\n')
        for(var i=0; i<deps.length; i++) {
            if(deps[i] != undefined && deps[i]) {
                var sep = ' rule '
                var idx = deps[i].search(sep)
                if(idx != -1) {
                    var rule_kind = deps[i].substr(0, idx)
                    var target_label = deps[i].substr(idx+sep.length)
                    label_desc.push({
                        'kind' : rule_kind,
                        'label' : target_label
                    })
                }
            }
        }
    }
    return label_desc
}

// Split the bazel label into its atomic parts:
// package and target (name)
function bzlDecomposeLabel(label) {
    var pkg_root = '//'
    var target_idx = label.search(':')
    return {
        'pkg' : label.substr(pkg_root.length,
            target_idx-pkg_root.length),
        'target' : label.substr(target_idx+1,
            label.length-target_idx)
    }
}

function bzlBuildLabelList(label_desc) {
    var bzl_config = vscode.workspace.getConfiguration('bazel')
    var table_view_enabled = bzl_config.enableTableView
    var label_parts = []
    var max_widths = []
    for(var i=0; i<label_desc.length; i++) {
        var dec_label = bzlDecomposeLabel(label_desc[i].label)
        label_parts.push({
            'lang' : bzl_defines.bzlTranslateRuleKindToLanguage(
                label_desc[i].kind),
            'pkg' : dec_label.pkg,
            'target' : dec_label.target
        })
        if(table_view_enabled) {
            Object.keys(label_parts[i]).forEach((str,idx) => {
                var prop_val = Object.values(label_parts[i])[idx]
                if(max_widths.length < (idx+1)) {
                    max_widths.push(prop_val.length)
                } else if(prop_val.length > max_widths[idx]) {
                    max_widths[idx] = prop_val.length
                }
            })
        }
    }
    var label_map = new Map()
    for(var i=0; i<label_parts.length; i++) {
        if(table_view_enabled) {
            for(var j=0; j<max_widths.length; j++) {
                var obj_keys = Object.keys(label_parts[i])
                if(label_parts[i][obj_keys[j]].length < max_widths[j]) {
                    label_parts[i][obj_keys[j]] = label_parts[i][obj_keys[j]] + new Array(
                        max_widths[j]-label_parts[i][obj_keys[j]].length+1).join('.')
                }
            }
        }
        var list_entry = label_parts[i].lang
            + ' | pkg{' + label_parts[i].pkg + '}'
            + ' | ' + label_parts[i].target
        label_map.set(list_entry, label_desc[i].label)
    }
    return label_map
}

// If 'rule_kinds' are not empty then excludes extends
// to all target kinds except that of 'rule_kinds'.
async function bzlPickTarget(rule_kinds = []) {
    var target = ''
    try {
        var label_desc = await bzlQueryDeps()
        if(label_desc.length) {
            label_desc = label_desc.filter(val => {
                var trimmed_label = val.kind.trim()
                if(rule_kinds.length) {
                    if(rule_kinds.includes(trimmed_label)) {
                        return true
                    }
                } else {
                    var bzl_config = vscode.workspace.getConfiguration('bazel')
                    if(!bzl_config.ruleExcludes.includes(trimmed_label)) {
                        return true
                    }
                }
                return false
            })
            var label_map = bzlBuildLabelList(label_desc)
            var chosen_label = await Window.showQuickPick(
                Array.from(label_map.keys()))
            target = label_map.get(chosen_label)

        } else {
            Window.showErrorMessage('There are no targets available')
        }
    } catch(error) {
        Window.showErrorMessage(error.toString())
    }
    return target
}

async function bzlBuildTarget(ctx) {
    var target = await bzlPickTarget()
    if((target != undefined) && (target != '')) {
        bzl_utils.bzlRunCommandInTerminal(ctx,
        'bazel build ' + target)
    }
}

async function bzlRunTarget(ctx) {
    var target = await bzlPickTarget()
    if((target != undefined) && (target != '')) {
        bzl_utils.bzlRunCommandInTerminal(ctx,
        'bazel run ' + target)
    }
}

// Intalls our required files into the targets
// source tree under '.vscode'.
async function bzlSetupWorkspace(ws_root, ext_root) {
    try {
        var ws_dest = path.join(ws_root, bzl_defines.BAZEL_EXT_DEST_BASE_PATH)
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
async function bzlFindFiles(substr, root) {
    var found_files = []
    try {
        var files = await fs.readdir(root)
        for(var i=0; i<files.length; i++) {
            var file_path = path.join(root, files[i])
            var stats = await fs.stat(file_path)
            if(stats && stats.isDirectory()) {
                var sub_dir_files = await bzlFindFiles(substr, file_path)
                for(var j=0; j<sub_dir_files.length; j++) {
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
async function bzlCreateCppProperties(ws_root_dir, output_root_dir, descriptors) {
    try {
        var include_paths = new Set()
        for(var i=0; i<descriptors.length; i++) {
            var buf = await fs.readFile(descriptors[i])
            var descriptor = JSON.parse(buf)
            var bzl_rule_kind = descriptor.kind
            if(bzl_rule_kind == 'cc_binary'
                || bzl_rule_kind == 'cc_library'
                || bzl_rule_kind == 'cc_toolchain'
                || bzl_rule_kind == 'apple_cc_toolchain') {
                var includes = descriptor.data.includes
                for(var j=0; j<includes.length; j++) {
                    includes[j] = path.normalize(includes[j])
                    if(includes[j].split(path.sep)[0] != 'bazel-out') {
                        var abs_inc_path = includes[j]
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
        var cpp_props_file = path.join(ws_root_dir,
            '.vscode', 'c_cpp_properties.json')
        var cpp_props_available = await fs.exists(cpp_props_file)
        var cpp_props_create_file = true
        if(cpp_props_available) {
            var options = vscode.InputBoxOptions = {
                prompt: 'There is already a c_cpp_properties.json file in '
                      + 'your workspace. Can we overwrite it?',
                placeHolder : 'y/yes | n/no',
            };
            var users_decision = await Window.showInputBox(options)
            if(users_decision != 'y' && users_decision != 'yes') {
                cpp_props_create_file = false
            }
        }
        if(cpp_props_create_file) {
            var path_arr = Array.from(include_paths)
            var cpp_props_data = bzl_defines.bzlGetBaseCppProperties()
            for(var i=0; i<cpp_props_data.configurations.length; i++) {
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
async function bzlCreateCppProps(ctx) {
    try {
        var has_workspace = await bzl_utils.bzlHasWorkspace()
        if(has_workspace) {
            var ws_root = Workspace.workspaceFolders[0].uri.fsPath
            var exists = await fs.exists(path.join(ws_root,
                bzl_defines.BAZEL_EXT_DEST_BASE_PATH, bzl_defines.BAZEL_BUILD_FILE))
            if(!exists) {
                // TODO Setup our workspace directly
                // after WORKSPACE has been detected.
                await bzlSetupWorkspace(ws_root, ctx.extensionPath)
            }
            var cmd_args = [
                'build',
                '--aspects',
                path.join(bzl_defines.BAZEL_EXT_DEST_BASE_PATH, bzl_defines.BAZEL_ASPECT_FILE)
                    + '%vs_code_bazel_inspect',
                '--output_groups=descriptor_files'
            ]

            // For c_cpp_properties we are only
            // interested in C++ targets.
            var target = await bzlPickTarget([
                'cc_library',
                'cc_binary'
            ])
            if((target != undefined) && (target != '')) {
                cmd_args.push(target)
                await bzl_utils.bzlRunCommandFromShell(cmd_args.join(' '))

                // 1) Try to find all descriptor files the bazel
                //    aspect might have generated into the output
                //    directory 'bazel-bin'
                var descriptors = await bzlFindFiles('vs_code_bazel_descriptor',
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
                for(var i=0; i<descriptors.length; i++) {
                    fs.unlink(descriptors[i])
                }
            }
        }
    } catch(err) {
        console.log(err.toString())
    }
}
module.exports = {
    bzlBuildTarget : bzlBuildTarget,
    bzlRunTarget : bzlRunTarget,
    bzlCreateCppProps : bzlCreateCppProps
}