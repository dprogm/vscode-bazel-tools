const child_proc = require('child-process-async');
const path = require('path')
const fs = require('fs-extra')
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

async function bzlQueryDeps() {
    var deps = []
    if(await bzlHasWorkspace()) {
        var child = await child_proc.exec('"bazel" query ...', {
            'cwd': Workspace.workspaceFolders[0].uri.fsPath
        })
        deps = child.stdout.split('\n')
    }
    return deps 
}

// * Execute our bazel command
// * Make the terminal visible to the user
async function bzlRunCommand(ctx, cmd) {
    var term = Window.createTerminal()
    term.sendText(cmd)
    term.show()
    // For disposal on deactivation
    ctx.subscriptions.push(term)
}

async function bzlBuildTargetImpl(ctx, opts) {
    try {
        var deps = await bzlQueryDeps()
        if(deps.length) {
            var opt_str = ' '
            if(opts.length) {
                var sep = opt_str
                opt_str = sep 
                    + opts.join(sep) 
                    + sep
            }
            bzlRunCommand(ctx, 'bazel build'
                + opt_str
                + await Window.showQuickPick(deps))
        } else {
            Window.showErrorMessage('There are no targets available')
        }
    } catch(error) {
        Window.showErrorMessage(error.toString())
    }
}

async function bzlBuildTarget(ctx) {
    bzlBuildTargetImpl(ctx, [])
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

// * Let the user choose a root target from which we 
//   are going to apply the aspect and gather all
//   cxx include paths
//
// * Create the vs code file 'c_cpp_properties.json'
//   into the destination folder and append the found 
//   include paths to that file under the section 
//   'includePath'
async function bzlCreateCppProps(ctx) {
    if(await bzlHasWorkspace()) {
        var ws_root = Workspace.workspaceFolders[0].uri.fsPath

        fs.exists(path.join(ws_root, BAZEL_BUILD_FILE), (exists) => {
            if(!exists) {
                // TODO Setup our workspace directly
                // after WORKSPACE has been detected.
                bzlSetupWorkspace(ws_root, ctx.extensionPath)
            }
            bzlBuildTargetImpl(ctx, [
                '--aspects=' + path.join(BAZEL_EXT_DEST_BASE_PATH,
                    BAZEL_ASPECT_FILE) + '%cpp_deps_dbg'
            ])
        })
    }
}

module.exports = {
    bzlBuildTarget : bzlBuildTarget,
    bzlCreateCppProps : bzlCreateCppProps
} 