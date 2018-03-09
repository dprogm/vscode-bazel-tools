const child_proc = require('child-process-async');
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const vscode = require('vscode')
const Workspace = vscode.workspace
const Window = vscode.window

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

async function bzlRunCommandFromShell(cmd_args) {
    return child_proc.exec('"bazel" ' + cmd_args, {
        'cwd': Workspace.workspaceFolders[0].uri.fsPath
    })
}

// * Execute our bazel command
// * Make the terminal visible to the user
async function bzlRunCommandInTerminal(ctx, cmd) {
    var term = Window.createTerminal()
    term.sendText(cmd)
    term.show()
    // For disposal on deactivation
    ctx.subscriptions.push(term)
}

async function bzlQueryDeps() {
    var deps = []
    var has_workspace = await bzlHasWorkspace()
    if(has_workspace) {
        var child = await bzlRunCommandFromShell('query ...')
        deps = child.stdout.split('\n')
    }
    return deps
}

async function bzlPickTarget() {
    var target = ''
    try {
        var deps = await bzlQueryDeps()
        if(deps.length) {
            deps = deps.filter((val) => {
                return val != undefined
                    && val != ''
            })
            target = await Window.showQuickPick(deps)
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
        bzlRunCommandInTerminal(ctx,
        'bazel build ' + target)
    }
}

async function bzlRunTarget(ctx) {
    var target = await bzlPickTarget()
    if((target != undefined) && (target != '')) {
        bzlRunCommandInTerminal(ctx,
        'bazel run ' + target)
    }
}

// Extensions source folder that contains
// all required runtime dependencies such
// as the aspects file
var BAZEL_EXT_RES_BASE_PATH = 'res'
// The destination folder where all runtime
// dependencies land that are required to be
// in the target source tree.
var BAZEL_EXT_DEST_BASE_PATH = '.vscode/.vs_code_bazel_build'
// Bazel requires a package for the aspect.
// This file will be empty.
var BAZEL_BUILD_FILE = 'BUILD'
// Required aspect for introspecting the
// bazel dependency graph.
var BAZEL_ASPECT_FILE = 'vs_code_aspect.bzl'

// Intalls our required files into the targets
// source tree under '.vscode'.
async function bzlSetupWorkspace(ws_root, ext_root) {
    try {
        var ws_dest = path.join(ws_root, BAZEL_EXT_DEST_BASE_PATH)
        await fs.mkdirs(ws_dest)
        await fs.writeFile(path.join(ws_dest,
                BAZEL_BUILD_FILE), '')
        await fs.copy(path.join(ext_root,
                BAZEL_EXT_RES_BASE_PATH,
                BAZEL_ASPECT_FILE),
            path.join(ws_dest,
                BAZEL_ASPECT_FILE))
    } catch(err) {
        console.log('error during file i/o '
            + err.toString())
    }
}

// Find files by searching recursively beginning at
// a given root directory. A filename matches if it
// contains 'substr'
async function bzlFoundFiles(substr, root) {
    var found_files = []
    try {
        var files = await fs.readdir(root)
        for(var i=0; i<files.length; i++) {
            var file_path = path.join(root, files[i])
            var stats = await fs.stat(file_path)
            if(stats && stats.isDirectory()) {
                var sub_dir_files = await bzlFoundFiles(substr, file_path)
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

// TODO: Add OSX configuration
function bzlGetBaseCppProperties() {
    var cpp_props_config_name = ''
    var cpp_props_config_intellisensemode = ''
    switch(os.platform()) {
        case 'linux':
            cpp_props_config_name = 'Linux'
            cpp_props_config_intellisensemode = 'clang-x64'
        break;
        case 'win32':
            cpp_props_config_name = 'Win32'
            cpp_props_config_intellisensemode = 'msvc-x64'
        break;
    }
    var cpp_props_data = {
        'configurations' : [{
                'name' : cpp_props_config_name,
                'intelliSenseMode' : cpp_props_config_intellisensemode,
                'includePath' : [],
                'browse' : {
                    'path' : [],
                    'limitSymbolsToIncludedHeaders' : true,
                    'databaseFilename' : ''
                }
            }
        ],
        'version' : 3
    }
    return cpp_props_data
}

async function bzlCreateCppProperties(ws_root_dir, output_root_dir, descriptors) {
    try {
        var include_paths = new Set()
        for(var i=0; i<descriptors.length; i++) {
            var buf = await fs.readFile(descriptors[i])
            var descriptor = JSON.parse(buf)
            var bzl_rule_kind = descriptor.kind
            if(bzl_rule_kind == 'cc_binary'
                || bzl_rule_kind == 'cc_library'
                || bzl_rule_kind == 'cc_toolchain') {
                var includes = descriptor.data.includes
                for(var j=0; j<includes.length; j++) {
                    includes[j] = path.normalize(includes[j])
                    if(includes[j].split(path.sep)[0] != 'bazel-out') {
                        var abs_inc_path = includes[j]
                        if(bzl_rule_kind != 'cc_toolchain') {
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
            var cpp_props_data = bzlGetBaseCppProperties()
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
//   'includePath'
async function bzlCreateCppProps(ctx) {
    try {
        var has_workspace = await bzlHasWorkspace()
        if(has_workspace) {
            var ws_root = Workspace.workspaceFolders[0].uri.fsPath
            var exists = await fs.exists(path.join(ws_root, BAZEL_BUILD_FILE))
            if(!exists) {
                // TODO Setup our workspace directly
                // after WORKSPACE has been detected.
                await bzlSetupWorkspace(ws_root, ctx.extensionPath)
            }
            var cmd_args = [
                'build',
                '--aspects',
                path.join(BAZEL_EXT_DEST_BASE_PATH, BAZEL_ASPECT_FILE)
                    + '%vs_code_bazel_inspect',
                '--output_groups=descriptor_files'
            ]
            var target = await bzlPickTarget()
            if((target != undefined) && (target != '')) {
                cmd_args.push(target)
                await bzlRunCommandFromShell(cmd_args.join(' '))

                // 1) Try to find all descriptor files the bazel
                //    aspect might have generated into the output
                //    directory 'bazel-bin'
                var descriptors = await bzlFoundFiles('vs_code_bazel_descriptor',
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