import {
    workspace as Workspace,
    window as Window,
    QuickPickOptions,
    QuickPickItem,
    ExtensionContext,
    WorkspaceConfiguration,
    WorkspaceFoldersChangeEvent,
    WorkspaceFolder,
    ViewColumn,
    RelativePattern,
    Task
} from 'vscode';
import { bazel } from './bazel';
import { cppproject } from './cppproject';
import * as path from 'path';
import * as fs from 'fs-extra';
import { utils } from './utils';
import { BazelWorkspaceProperties } from './descriptor';
import { javaproject } from './javaproject';
const Viz = require('viz.js');
const { Module, render } = require('viz.js/full.render.js');

export module commands {
    interface BazelQueryQuickPickItem extends QuickPickItem {
        readonly query_item: bazel.BazelQueryItem;
    }

    interface BazelWorkspaceQuickPickItem extends QuickPickItem {
        readonly item: BazelWorkspace;
    }

    /**
     * Bazel workspace information.
     */
    class BazelWorkspace implements BazelWorkspaceProperties {
        // VSCode workspace folder reference.
        public readonly workspaceFolder: WorkspaceFolder;
        // Path to the bazel WORKSPACE file.
        public readonly bazelWorkspacePath: string;
        // Path to the installed aspect file to generate descriptor files.
        public readonly aspectPath: string;
        public tasks?: Task[];

        /**
         * Constructor.
         * @param properties Properties information to initialize the bazel workspace.
         */
        constructor(properties: BazelWorkspaceProperties) {
            this.workspaceFolder = properties.workspaceFolder;
            this.bazelWorkspacePath = properties.bazelWorkspacePath,
            this.aspectPath = properties.aspectPath;
        }
    }

    /**
     * Extensions source folder that contains
     * all required runtime dependencies such
     * as the aspects file.
     */
    const BAZEL_EXT_RES_BASE_PATH = 'res';
    /**
     * The destination folder where all runtime
     * dependencies land that are required to be
     * in the target source tree.
     */
    const BAZEL_EXT_DEST_BASE_PATH = '.vscode/.vs_code_bazel_build';
    /**
     * Bazel requires a package for the aspect.
     * This file will be empty.
     */
    const BAZEL_BUILD_FILE = 'BUILD';
    /**
     * Required aspect for introspecting the
     * bazel dependency graph.
     */
    const BAZEL_ASPECT_FILE = 'vs_code_aspect.bzl';

    /** Bazel workspace file name. */
    const BAZEL_WORKSPACE_FILE:string = 'WORKSPACE'
    /** Bazel valid build file names. */
    const BAZEL_BUILD_FILES: string[] = ['BUILD', 'BUILD.bazel'];

    /** When set to true labels will not be parsed. */
    let rawLabelDisplay: boolean;
    /** Collection of all the initialize bazel workspace. */
    let bazelWorkspaces: BazelWorkspace[] = [];
    let extensionContext: ExtensionContext;
    let bazelProvideTask: boolean;

    /**
     * Try to initialize the extension.
     * @param ctx Extension context of VSCode
     * @returns true if the the plugin has been successfully initialize false otherwise
     */
    export async function tryInit(ctx: ExtensionContext): Promise<boolean> {
        let initialized = false;
        extensionContext = ctx;
    
        if (Workspace.workspaceFolders !== undefined) {
            Workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders);

            for (const workspaceFolder of Workspace.workspaceFolders) {
                initialized = await tryInitWorkspace(workspaceFolder) || initialized;
            } // end for workspace
        }

        // If all go right init the other modules
        if (initialized) {
            init();
            bazel.init();
        }
    
        return initialized;
    }

    /**
     * This methods must be call if the VSCode workspace validate all the
     * requirement. It will register callback and load the current extension
     * configuration.
     * @see {@link tryInit}
     */
    function init(): void {
        Workspace.onDidChangeConfiguration(configurationChangeEvent => {
            if (configurationChangeEvent.affectsConfiguration('bazel')) {
                loadConfiguration(Workspace.getConfiguration('bazel'));
            }
        });
        Workspace.onDidSaveTextDocument(textDocument => {
            if ('bazel' === textDocument.languageId) {
                let bzlWsModify = bazelWorkspaces.find(bzlWs => {
                    return textDocument.fileName.startsWith(bzlWs.bazelWorkspacePath);
                });
                if (bzlWsModify !== undefined) {
                    bzlWsModify.tasks = undefined;
                }
            }
        });
        loadConfiguration(Workspace.getConfiguration('bazel'));
    }

    /**
     * Try to initialize the extension for a given workspace folder.
     * 
     * This function will check in the following order:
     * * if the given workspace contains any bazel WORKSPACE file
     *   ({@link BAZEL_WORKSPACE_FILE}). 
     * * if the given workspace contains any bazel BUILD file
     *   ({@link BAZEL_BUILD_FILES}).
     * @param workspaceFolder VSCode workspace folder.
     * @returns True if the workspace folder fill the condition, false otherwise.
     * @see {@link tryInitFromBuildFile}
     */
    async function tryInitWorkspace(workspaceFolder: WorkspaceFolder): Promise<boolean> {
        const wsRelativePattern = new RelativePattern(workspaceFolder, `**/${BAZEL_WORKSPACE_FILE}`);
        const wsExcludeBzlDir = new RelativePattern(workspaceFolder, '**/bazel-*');

        let initialized = false;

        let workspacesPath = await Workspace.findFiles(wsRelativePattern, wsExcludeBzlDir);
        if (workspacesPath.length > 0) {
            for (const workspacePath of workspacesPath) {
                const bzlWsDirPath = path.dirname(workspacePath.fsPath);
                // The workspace contains a WORKSPACE file init bazel
                await setupWorkspace(bzlWsDirPath, extensionContext.extensionPath);
                bazelWorkspaces.push(
                    new BazelWorkspace({
                        workspaceFolder: workspaceFolder,
                        bazelWorkspacePath: bzlWsDirPath,
                        aspectPath: path.join(BAZEL_EXT_DEST_BASE_PATH, BAZEL_ASPECT_FILE)
                    })
                );
            }
            initialized = true;
        } else {
            // The workspace does not contains a WORKSPACE file try 
            // to found if there is any BUILD file
            initialized = await tryInitFromBuildFile(workspaceFolder);
        }

        return initialized;
    }

    /**
     * Try to find any bazel BUILD ({@link BAZEL_BUILD_FILES}) file in the
     * workspace folder. If one is found then it search for a WORKSPACE file
     * in the parent directories.
     * @param workspaceFolder VSCode workspace folder.
     * @returns True if a bazel BUILD and it's associated WORKSPACE file has been 
     * found, false otherwise.
     */
    async function tryInitFromBuildFile(workspaceFolder: WorkspaceFolder): Promise<boolean> {
        let initialized = false;

        for (const buildFile of BAZEL_BUILD_FILES) {
            const buildPath = path.join(workspaceFolder.uri.fsPath, buildFile);
            // Check if the bazel build file exists
            if (fs.existsSync(buildPath)) {
                // A build file has been found try to found the WORKSPACE file path
                // by searching recursively in the parents directory.
                let wsPath = workspaceFolder.uri.fsPath;
                let lastIndex = wsPath.lastIndexOf(path.sep);
                let workspaceFileFound = false;
                while ((lastIndex !== -1) && (!workspaceFileFound)) {
                    wsPath = wsPath.substr(0, lastIndex);
                    lastIndex = wsPath.lastIndexOf(path.sep);
                    workspaceFileFound = fs.existsSync(path.join(wsPath, BAZEL_WORKSPACE_FILE));
                }
                if (workspaceFileFound) {
                    await setupWorkspace(workspaceFolder.uri.fsPath, extensionContext.extensionPath);
                    bazelWorkspaces.push(
                        new BazelWorkspace({
                            workspaceFolder: workspaceFolder,
                            bazelWorkspacePath: wsPath,
                            aspectPath: path.join(
                                workspaceFolder.uri.fsPath.replace(`${wsPath}${path.sep}`, ''),
                                BAZEL_EXT_DEST_BASE_PATH,
                                BAZEL_ASPECT_FILE
                            )
                        })
                    );
                    initialized = true;
                } else {
                    Window.showInformationMessage('Bazel BUILD file has been found in the workspace directory, but cannot found any WORKSPACE file in it or in the parent one.');
                }
            }
        }

        return initialized;
    }

    /**
     * @callback vscode.workspace.onDidChangeWorkspaceFolders
     * On VSCode workspace change remove the removed workspace and try to init
     * the added one.
     * @param workspaceFoldersEvent An event describing a change to the set of workspace folders.
     */
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

    /**
     * Install or update the required files into the targets source tree under '.vscode'.
     * @param wsRoot VSCode workspace root directory.
     * @param extensionPath Path to the extension.
     */
    async function setupWorkspace(wsRoot: string, extensionPath: string): Promise<void> {
        try {
            const workspaceDestinationPath = path.join(wsRoot, BAZEL_EXT_DEST_BASE_PATH);

            try {
                await fs.mkdirs(workspaceDestinationPath);
            } catch(err) {
                if (err.code !== 'EEXIST') throw err;
            }
            
            let elements = [
                fs.writeFile(path.join(workspaceDestinationPath, BAZEL_BUILD_FILE), ''),
                ...await copyBzlResources(workspaceDestinationPath, extensionPath)
            ];

            for (const awaitableElt of elements) {
                await awaitableElt;
            }
        } catch(err) {
            Window.showErrorMessage('Error during file i/o ' + err.toString());
        }
    }

    function copyBzlResources(workspaceDestinationPath: string, extensionPath: string) {
        const bazelSrcAspectPath = path.join(extensionPath, BAZEL_EXT_RES_BASE_PATH);

        return fs.readdir(bazelSrcAspectPath)
            .then(entries => {
                return entries
                    .filter(entry => entry.endsWith('.bzl'))
                    .map(async entry => await fs.copy(
                            path.join(bazelSrcAspectPath, entry),       // source
                            path.join(workspaceDestinationPath, entry), // destination
                            {overwrite: true})                          // options
                    );
            });
    }

    /**
     * Initialize the module with the user configuration.
     * @param bazelConfig New configuration to load.
     */
    function loadConfiguration(bazelConfig: WorkspaceConfiguration): void {
        rawLabelDisplay = <boolean>bazelConfig.get<boolean>('rawLabelDisplay');
        bazelProvideTask = (bazelConfig.get<string>('autoDetect') === 'on');
    }

    /**
     * * Let the user choose a root target from which we
     *   are going to apply the aspect and gather all
     *   cxx include paths
     * 
     * * Create the vs code file 'c_cpp_properties.json'
     *   into the destination folder and append the found
     *   include paths to that file under the section
     *   'includePath' as well as 'browse.path'
     * 
     * @param ctx Extension context
     */
    export async function bzlCreateCppProps(ctx: ExtensionContext) : Promise<void> {
        try {
            const bzlWs = await pickWorkspace();
            if (bzlWs !== undefined) {
                // For c_cpp_properties we are only
                // interested in C++ targets.
                const target = await quickPickQuery(bzlWs, 'kind(cc_.*, deps(...))', {
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: 'Generate cpp properties for target...'
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
                        bzlWs,
                        target.query_item.label,
                        descriptors
                    );

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

    export async function createJavaProject(): Promise<void> {
        try {
            const bzlWs = await pickWorkspace();
            if (bzlWs !== undefined) {
                // For java project we are only
                // interested in java targets.
                const target = await quickPickQuery(bzlWs, 'kind(java_.*, deps(...))', {
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: 'Generate java configuration files for target...'
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
                    javaproject.createJavaProject(
                        bzlWs,
                        target.query_item.label,
                        descriptors
                    );
                    

                    // 3) Cleanup all temporary descriptor files
                    //for (const descriptor of descriptors) {
                    //    fs.unlink(descriptor);
                    //}
                }
            }
        } catch (err) {
            console.log(err.toString());
        }
    }

    /**
     * @deprecated
     * @param ctx 
     */
    export async function bzlBuildTarget(ctx: ExtensionContext) {
        const bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            return quickPickQuery(bzlWs, '...', {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: 'bazel build'
            }).then(target => {
                if (target !== undefined) {
                    bazel.build(bzlWs, target.query_item.label);
                }
            });
        }
    }

    /**
     * @deprecated
     * @param ctx 
     */
    export async function bzlRunTarget(ctx: ExtensionContext) {
        const bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            return quickPickQuery(bzlWs, 'kind(.*_binary, deps(...))', {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: 'Run bazel binary target (*_binary)'
            }).then(target => {
                if (target !== undefined) {
                    bazel.run(bzlWs, target.query_item.label);
                }
            });
        }
    }

    /**
     * @deprecated
     * @param ctx 
     */
    export async function bzlClean(ctx: ExtensionContext) {
        let bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            bazel.clean(bzlWs);
        }
    }

    export async function provideTasks() {
        if (!bazelProvideTask) {
            return [];
        }

        let tasksResolverPromiseByWs = bazel.provideTasks(bazelWorkspaces.filter(bzlWs => !bzlWs.tasks));
        for (const tasksResolverPromise of tasksResolverPromiseByWs) {
            try {
                let tasksResolver = await tasksResolverPromise;
                (<BazelWorkspace>tasksResolver.workspaceFolder).tasks = tasksResolver.tasks;
            } catch (err) {
                console.error(err);
            }
        }

        let allTasks: Task[] = [];
        for (const ws of bazelWorkspaces) {
            if (ws.tasks !== undefined) {
                allTasks.push(...ws.tasks);
            }
        }

        return allTasks;
    }

    /**
     * 
     * @param ctx 
     */
    export async function bzlShowDepGraph(ctx: ExtensionContext) {
        const bzlWs = await pickWorkspace();
        if (bzlWs !== undefined) {
            return quickPickQuery(bzlWs, '...', {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: 'Trace dependencies graph'
            }).then(async target => {
                if (target !== undefined) {
                    const graph = await bazel.depGraph(bzlWs, target.query_item.label, true);
                    let viz = new Viz({ Module, render });
                    let svgGraph = await viz.renderString(graph);
                    const panel = Window.createWebviewPanel(
                        'bazel',                                 // view type
                        `Graph View ${target.query_item.label}`, // tile
                        ViewColumn.One,                          // view
                        { enableScripts: true }                  // options
                    );
                    panel.webview.html = svgGraph;
                }
            });
        }
        
        //let uri = Uri.parse('bazel_dep_graph://');
        //Commands.executeCommand('vscode.previewHtml', uri, ViewColumn.Two, 'Graph View');
    }

    /**
     * 
     * @returns
     */
    async function pickWorkspace(): Promise<BazelWorkspace | undefined> {
        if (bazelWorkspaces.length === 1) {
            // If there only one workspace no problem continue
            return new Promise<BazelWorkspace>((resolve, reject) => {
                resolve(bazelWorkspaces[0]);
            });
        } else if (bazelWorkspaces.length > 0) {
            // Otherwise the user must choose the workspace to work to
            return await Window.showQuickPick(
                bazelWorkspaces.map(
                    ws => <BazelWorkspaceQuickPickItem> {
                        label: ws.workspaceFolder.name,
                        description: ws.workspaceFolder.uri.fsPath,
                        item: ws
                    }
                ),
            <QuickPickOptions> {
                placeHolder: 'Workspace folder'
            }).then(item => item ? item.item : undefined);
        }
        return undefined;
    }

    /**
     * 
     * @param bzlWs 
     * @param query 
     * @param options 
     * @returns
     */
    function quickPickQuery(bzlWs: BazelWorkspace, query: string = '...', options?: QuickPickOptions): Thenable<BazelQueryQuickPickItem | undefined> {
        let quickPickQuery = bazel.queryBzl(bzlWs, query).then(
            queryItems => {
                if (rawLabelDisplay) {
                    return queryItems.map(rawQuickPickItem);
                } else {
                    return queryItems.map(parseQuickPickItem);
                }
            }
        ).catch((err: Error) => {
            Window.showQuickPick([], {placeHolder: '<ERROR>'});
            Window.showErrorMessage("Failed to query bazel, take a look in the Problems view." + err.toString());
            return [];
        });

        return Window.showQuickPick(quickPickQuery, options);
    }

    /**
     * 
     * @param queryItem 
     * @returns
     */
    function rawQuickPickItem(queryItem: bazel.BazelQueryItem): BazelQueryQuickPickItem {
        return {
            label: queryItem.label,
            description: '',
            detail: queryItem.kind,
            query_item: queryItem
        };
    }

    /**
     * 
     * @param queryItem 
     * @returns
     */
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
