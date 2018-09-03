import {
    workspace as Workspace,
    window as Window,
    commands as Commands,
    QuickPickOptions,
    QuickPickItem,
    ExtensionContext,
    WorkspaceConfiguration,
    Terminal,
    WorkspaceFoldersChangeEvent,
    WorkspaceFolder,
    ViewColumn
} from 'vscode';
import { bazel } from './bazel';
import { cppproject } from './cppproject';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Uri } from 'vscode';
import { utils } from './utils';


export module commands {
    interface BazelQueryQuickPickItem extends QuickPickItem {
        readonly query_item: bazel.BazelQueryItem;
    }

    interface BazelWorkspaceQuickPickItem extends QuickPickItem {
        readonly item: BazelWorkspace;
    }

    class BazelWorkspace implements utils.BazelWorkspaceProperties{
        public readonly workspaceFolder: WorkspaceFolder;
        public readonly bazelWorkspacePath: string;
        public readonly aspectPath: string;
        private _terminal: Terminal | null = null;

        constructor(properties: utils.BazelWorkspaceProperties) {
            this.workspaceFolder = properties.workspaceFolder;
            this.bazelWorkspacePath = properties.bazelWorkspacePath,
            this.aspectPath = properties.aspectPath;
        }

        /**
         * Determine if a terminal is already associated with workspace
         * @returns true if this workspace has already a terminal, false otherwise
         */
        public hasTerminal(): boolean {
            return this._terminal !== null;
        }

        /**
         * This function must be call only on a terminal deletion
         */
        public resetTerminal() {
            return this._terminal = null;
        }

        /**
         * Create or get the associated terminal of the current bazel workspace
         * @returns the associated terminal
         */
        public getTerminal(): Terminal {
            if (this._terminal === null) {
                this._terminal = Window.createTerminal({
                    name: `bazel - ${this.workspaceFolder.name}`,
                    cwd: this.workspaceFolder.uri.fsPath
                });
                // For disposal on deactivation
                extensionContext.subscriptions.push(this._terminal);
            }
            return this._terminal;
        }
    }

    // Extensions source folder that contains
    // all required runtime dependencies such
    // as the aspects file
    const BAZEL_EXT_RES_BASE_PATH = 'res';
    // The destination folder where all runtime
    // dependencies land that are required to be
    // in the target source tree.
    const BAZEL_EXT_DEST_BASE_PATH = '.vscode/.vs_code_bazel_build';
    // Bazel requires a package for the aspect.
    // This file will be empty.
    const BAZEL_BUILD_FILE = 'BUILD';
    // Required aspect for introspecting the
    // bazel dependency graph.
    const BAZEL_ASPECT_FILE = 'vs_code_aspect.bzl';

    const WORKSPACE_FILE:string = 'WORKSPACE'
    const BAZEL_FILES: string[] = ['BUILD', 'BUILD.bazel', WORKSPACE_FILE];

    let rawLabelDisplay: boolean;
    let bazelWorkspaces: BazelWorkspace[] = [];
    let extensionContext: ExtensionContext;

    /**
     * 
     * @param ctx 
     * @returns
     */
    export async function tryInit(ctx: ExtensionContext): Promise<boolean> {
        let initialized = false;
        extensionContext = ctx;
    
        if (Workspace.workspaceFolders !== undefined) {
            Workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders);

            for (const workspaceFolder of Workspace.workspaceFolders) {
                initialized = tryInitWorkspace(workspaceFolder) || initialized;
            } // end for workspace
        }

        if (initialized) {
            init();
            bazel.init();
        }
    
        return initialized;
    }

    function init() {
        Workspace.onDidChangeConfiguration(configurationChangeEvent => {
            if (configurationChangeEvent.affectsConfiguration('bazel')) {
                loadConfiguration(Workspace.getConfiguration('bazel'));
            }
        });
        Window.onDidCloseTerminal(terminal => {
            for (const bzlWs of bazelWorkspaces) {
                if (bzlWs.hasTerminal() && bzlWs.getTerminal().processId === terminal.processId) {
                    bzlWs.resetTerminal();
                    break;
                }
            }
        });
        loadConfiguration(Workspace.getConfiguration('bazel'));
    }

    function tryInitWorkspace(workspaceFolder: WorkspaceFolder): boolean {
        let initialized = false;

        let workspacePath = path.join(workspaceFolder.uri.fsPath, WORKSPACE_FILE);
        if (fs.existsSync(workspacePath)) {
            // The workspace contains a WORKSPACE file init bazel
            setupWorkspace(workspaceFolder.uri.fsPath, extensionContext.extensionPath);
            addBazelWorkspace(
                new BazelWorkspace({
                    workspaceFolder: workspaceFolder,
                    bazelWorkspacePath: workspaceFolder.uri.fsPath,
                    aspectPath: path.join(BAZEL_EXT_DEST_BASE_PATH, BAZEL_ASPECT_FILE)
                })
            );
            initialized = true;
        } else {
            // The workspace does not contains a WORKSPACE file try 
            // to found if there is any BUILD file
            initialized = tryInitFromBuildFile(workspaceFolder);
        }

        return initialized;
    }

    function tryInitFromBuildFile(workspaceFolder: WorkspaceFolder): boolean {
        let initialized = false;

        for (const buildFile of BAZEL_FILES) {
            let buildPath = path.join(workspaceFolder.uri.fsPath, buildFile);
            if (fs.existsSync(buildPath)) {
                // A build file has been found try to found the WORKSPACE path
                let wsPath = path.normalize(path.join(workspaceFolder.uri.fsPath, '..'));
                let preciousWsPath: string | null = null;
                while ((preciousWsPath !== wsPath) && (!fs.existsSync(path.join(wsPath, WORKSPACE_FILE)))) {
                    preciousWsPath = wsPath;
                    wsPath = path.normalize(path.join(wsPath, '..'));
                }
                if (wsPath !== preciousWsPath) {
                    setupWorkspace(workspaceFolder.uri.fsPath, extensionContext.extensionPath);
                    addBazelWorkspace(new BazelWorkspace({
                        workspaceFolder: workspaceFolder,
                        bazelWorkspacePath: wsPath,
                        aspectPath: path.join(
                            workspaceFolder.uri.fsPath.replace(`${wsPath}${path.sep}`, ''),
                            BAZEL_EXT_DEST_BASE_PATH, 
                            BAZEL_ASPECT_FILE
                        )
                    }));
                    initialized = true;
                } else {
                    Window.showInformationMessage('Bazel BUILD file found but no WORKSPACE');
                }
            }
        }

        return initialized;
    }

    function onChangeWorkspaceFolders(workspaceFoldersEvent: WorkspaceFoldersChangeEvent): void {
        for (const workspaceFolder of workspaceFoldersEvent.added) {
            tryInitWorkspace(workspaceFolder);
        }

        for (const workspaceFolder of workspaceFoldersEvent.removed) {
            let index = bazelWorkspaces.findIndex(bzlWs => bzlWs.workspaceFolder.name === workspaceFolder.name);
            if (index > -1) {
                bazelWorkspaces.slice(index, 1);
            }
        }
    }

    function addBazelWorkspace(ws: BazelWorkspace): void {
        bazelWorkspaces.push(ws);
    }

    // Installs our required files into the targets
    // source tree under '.vscode'.
    async function setupWorkspace(wsRoot: string, extensionPath: string): Promise<void> {
        try {
            let exists = await fs.exists(path.join(wsRoot, BAZEL_EXT_DEST_BASE_PATH, BAZEL_BUILD_FILE));
            if (!exists) {
                let workspaceDestinationPath = path.join(wsRoot, BAZEL_EXT_DEST_BASE_PATH);
                await fs.mkdirs(workspaceDestinationPath);
                await fs.writeFile(path.join(workspaceDestinationPath, BAZEL_BUILD_FILE), '');
                await fs.copy(
                    path.join(extensionPath, BAZEL_EXT_RES_BASE_PATH, BAZEL_ASPECT_FILE),
                    path.join(workspaceDestinationPath, BAZEL_ASPECT_FILE)
                );
            }
        } catch(err) {
            Window.showErrorMessage('Error during file i/o ' + err.toString());
        }
    }

    function loadConfiguration(bazelConfig: WorkspaceConfiguration): void {
        rawLabelDisplay = bazelConfig.get<boolean>('rawLabelDisplay') || false;
    }

    // * Let the user choose a root target from which we
    //   are going to apply the aspect and gather all
    //   cxx include paths
    //
    // * Create the vs code file 'c_cpp_properties.json'
    //   into the destination folder and append the found
    //   include paths to that file under the section
    //   'includePath' as well as 'browse.path'
    export async function bzlCreateCppProps(ctx: ExtensionContext) : Promise<void> {
        try {
            const bzlWs = await pickWorkspace();
            if (bzlWs !== undefined) {
                // For c_cpp_properties we are only
                // interested in C++ targets.
                const target = await quickPickQuery(bzlWs, 'kind(cc_.*, deps(...))', {
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: 'Generate cpp properties for target ...'
                });
                if (target !== undefined) {
                    // 1) Try to find all descriptor files the bazel
                    //    aspect might have generated into the output
                    //    directory 'bazel-bin'
                    const descriptors = await bazel.buildDescriptor(bzlWs, target.query_item.label);

                    // 2) Build absolute include paths based on the
                    //    relative paths from the descriptors and
                    //    the symlinked bazel workspace 'bazel-<root>'
                    //    where root is the current working directory.
                    await cppproject.createCppProperties(
                        bzlWs.workspaceFolder.uri.fsPath,
                        path.join(bzlWs.bazelWorkspacePath, `bazel-${path.basename(bzlWs.bazelWorkspacePath)}`),
                        descriptors
                    ); // TODO directly pass the bzlWs

                    // 3) Cleanup all temporary descriptor files
                    for (const descriptor of descriptors) {
                        fs.unlink(descriptor);
                    }
                }
            }
        } catch (err) {
            console.log(err.toString());
        }
    }

    export async function bzlBuildTarget(ctx: ExtensionContext) {
        const bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            return quickPickQuery(bzlWs, '...', {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: 'bazel build'
            }).then(target => {
                if (target !== undefined) {
                    let terminal = bzlWs.getTerminal()
                    bazel.build(terminal, target.query_item.label);
                    terminal.show();
                }
            });
        }
    }

    export async function bzlRunTarget(ctx: ExtensionContext) {
        const bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            return quickPickQuery(bzlWs, 'kind(.*_binary, deps(...))', {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: 'Run bazel binary target (*_binary)'
            }).then(target => {
                if (target !== undefined) {
                    let terminal = bzlWs.getTerminal();
                    bazel.run(terminal, target.query_item.label);
                    terminal.show();
                }
            });
        }
    }

    export async function bzlClean(ctx: ExtensionContext) {
        let bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            let terminal = bzlWs.getTerminal()
            bazel.clean(terminal);
            terminal.show();
        }
    }

    export async function bzlShowDepGraph(ctx: ExtensionContext) {
        let uri = Uri.parse('bazel_dep_graph://');
        Commands.executeCommand('vscode.previewHtml', uri, ViewColumn.Two, 'Graph View');
    }

    async function pickWorkspace(): Promise<BazelWorkspace | undefined> {
        if (bazelWorkspaces.length === 1) {
            // If there only one workspace no problem continue
            return new Promise<BazelWorkspace>((resolve, reject) => {
                resolve(bazelWorkspaces[0]);
            });
        } else {
            // Otherwise the user must choose the workspace to work to
            return await Window.showQuickPick(
                bazelWorkspaces.map(
                    ws => <BazelWorkspaceQuickPickItem> {
                        label: ws.workspaceFolder.name,
                        item: ws
                    }
                ),
            <QuickPickOptions> {
                placeHolder: 'Workspace folder'
            }).then(item => item ? item.item : undefined);
        }
    }

    function quickPickQuery(bzlWs: BazelWorkspace, query: string = '...', options?: QuickPickOptions): Thenable<BazelQueryQuickPickItem | undefined> {
        let quickPickQuery = bazel.queryBzl(bzlWs.workspaceFolder.uri.fsPath, query).then(
            queryItems => {
                if (rawLabelDisplay) {
                    return queryItems.map(rawQuickPickItem);
                } else {
                    return queryItems.map(parseQuickPickItem);
                }
            },
            err => {
                Window.showQuickPick([], {placeHolder: '<ERROR>'});
                Window.showErrorMessage(err.toString());
                return [];
            }
        );

        return Window.showQuickPick(quickPickQuery, options);
    }

    function rawQuickPickItem(queryItem: bazel.BazelQueryItem): BazelQueryQuickPickItem {
        return {
            label: queryItem.label,
            description: '',
            detail: queryItem.kind,
            query_item: queryItem
        };
    }

    function parseQuickPickItem(queryItem: bazel.BazelQueryItem): BazelQueryQuickPickItem {
        const { ws, pkg, target } = utils.decomposeLabel(queryItem.label);
        const lang = utils.ruleKindToLanguage(queryItem.kind);
    
        return {
            label: target,
            description: '',
            detail: `${lang} | ws{${ws}} | pkg{${pkg}}`,
            query_item: queryItem
        };
    }

}
