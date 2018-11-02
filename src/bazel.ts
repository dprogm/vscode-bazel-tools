import {
    workspace as Workspace,
    WorkspaceConfiguration,
    DiagnosticCollection,
    languages,
    Diagnostic,
    Position,
    Range,
    TaskGroup,
    ProcessExecution,
    Task,
    TaskDefinition,
    tasks
} from 'vscode';
const child_proc = require('child-process-async');
import * as path from 'path';
import { utils } from './utils';
import { Uri } from 'vscode';


export module bazel {
    export interface BazelQueryItem {
        /** Kind of the target (example: cc_library, ...) */
        readonly kind: string;
        /** Bazel valid target (example: //package:target, ...) */
        readonly label: string;
    }

    /** Path to the bazel executable. */
    let bazelExecutablePath: string;
    /** Packages that should not be considered during querying. */
    let excludedPackages: string[];
    /**  */
    let bazelDiagnosticsCollection: DiagnosticCollection;

    /**
     * This function must be call in the extension initialization.
     * It will load the configuration and register listener on modification.
     */
    export function init(): void {
        Workspace.onDidChangeConfiguration(configurationChangeEvent => {
            if (configurationChangeEvent.affectsConfiguration('bazel')) {
                loadConfiguration(Workspace.getConfiguration('bazel'));
            }
        });
        loadConfiguration(Workspace.getConfiguration('bazel'));
        bazelDiagnosticsCollection = languages.createDiagnosticCollection('bazel');
    }


    /**
     * Initialize the module with the user configuration.
     * @param bazelConfig New configuration to load.
     */
    function loadConfiguration(bazelConfig: WorkspaceConfiguration): void {
        bazelExecutablePath = bazelConfig.get<string>('executablePath') || 'bazel';
        excludedPackages = bazelConfig.get<string[]>('packageExcludes') || [];
    }

    /**
     * Execute a Bazel query from a specific place.
     * @param bzlWs Bazel working directory.
     * @param query Bazel query to execute.
     * @returns List of all rules that have been found.
     */
    export function queryBzl(bzlWs: utils.BazelWorkspaceProperties, query: string = '...'): Promise<BazelQueryItem[]> {
        const excludedPackagesStr = excludedPackages.join(',');
        // Execute the bazel query
        let proc = exec(
            [
                'query',
                `"${query}"`,
                '--noimplicit_deps',
                '--nohost_deps',
                `--deleted_packages=${excludedPackagesStr}`,
                '--output', 'label_kind'
            ],
            bzlWs
        );

        // Get the bazel query output
        return proc.then(child => {
            bazelDiagnosticsCollection.clear();

            const stdout:string = child.stdout.trim();
            const dependencies = stdout ? stdout.split('\n') : [];
            const separator = ' rule ';
    
            // Search for all rule and return it
            const queries = dependencies.map((dependency: string): BazelQueryItem => {
                const idx = dependency.search(separator);
    
                return {
                    kind: dependency.substr(0, idx),
                    label: dependency.substr(idx + separator.length)
                };
            });
            
            return queries;
        }).catch((error: Error) => {
            parseErrorDiagnostics(bzlWs, error);
            return Promise.reject(error);
        });
    }

    /**
     * Generate for a specific target all the descriptors file.
     * @param bzlWs Workspace property.
     * @param target Target for with the descriptors files must be generate
     * @returns List of all descriptor file path relative to the target.
     */
    export function buildDescriptor(bzlWs: utils.BazelWorkspaceProperties, target:string): Promise<string[]> {
        return exec([
                'build',
                '--aspects', `${bzlWs.aspectPath}%vs_code_bazel_inspect`,
                '--output_groups=descriptor_files',
                target
            ],
            bzlWs
        ).then(child => {
            // Funny fact, for this command the output go on the stderr
            const stderr = child.stderr.trim();
            const lines = stderr ? stderr.split('\n') : [];
            return lines
                    .map(line => line.trim())
                    .filter(line => line.startsWith('bazel-bin/'))
                    .map(descriptorFile => path.join(bzlWs.bazelWorkspacePath, descriptorFile));
        });
    }

    export function depGraph(
        bzlWs: utils.BazelWorkspaceProperties, 
        target: string, 
        noImplicitDeps: boolean = false
    ) {
        let args = [
            "query",
            "--package_path",
            `%workspace%:${bazelExecutablePath}/base_workspace`
        ];

        if (noImplicitDeps) {
            args.push('--noimplicit_deps');
        }

        args.push(
            `'deps(${target})'`,
            "--output",
            "graph"
        );

        return exec(args, bzlWs).then(output => output.stdout);
    }

    /**
     * @deprecated use tasks now
     * Execute a bazel build command in the given terminal.
     * @param bzlWs Bazel workspace info.
     * @param target Target that must be build.
     */
    export function build(bzlWs: utils.BazelWorkspaceProperties, target: string) {
        let task = new Task(
            { type: 'bazel' },      //taskDefinition
            bzlWs.workspaceFolder,  // target
            `bazel (${target})`,    // name
            'bazel',                // source
            new ProcessExecution(   // execution
                bazelExecutablePath,
                ['build', target],
                { cwd: bzlWs.bazelWorkspacePath }
            )
        );

        return tasks.executeTask(task);
    }

    /**
     * Execute a bazel run command in the given terminal.
     * @param bzlWs Bazel workspace info.
     * @param target Target that must be run.
     */
    export function run(bzlWs: utils.BazelWorkspaceProperties, target: string) {
        let task = new Task(
            { type: 'bazel' },      //taskDefinition
            bzlWs.workspaceFolder,  // target
            `bazel (${target})`,    // name
            'bazel',                // source
            new ProcessExecution(   // execution
                bazelExecutablePath,
                ['run', target],
                { cwd: bzlWs.bazelWorkspacePath }
            )
        );

        return tasks.executeTask(task);
    }

    /**
     * @deprecated use task instead
     * Execute a bazel clean command in the given terminal.
     * @param bzlWs Bazel workspace info.
     */
    export function clean(bzlWs: utils.BazelWorkspaceProperties) {
        return tasks.executeTask(cleanTask(bzlWs));
    }

    interface BazelTaskDefinition extends TaskDefinition {
        target?: string;
        kind?: string;
        command: string;
        args?: string[];
    }

    export function resolveTask(task: Task): Task | undefined {
        const taskDefinition = <BazelTaskDefinition>task.definition;
        let args = [taskDefinition.command];
        if (taskDefinition.args !== undefined) {
            args.push(...taskDefinition.args);
        }
        if (taskDefinition.target !== undefined) {
            args.push(taskDefinition.target);
        }
        task.execution = new ProcessExecution(
            bazelExecutablePath,
            args
        );

        return task;
    }

    export function provideTasks(bzlWorkspace: utils.BazelWorkspaceProperties[]) {
        return bzlWorkspace.map(workspaceFolder =>
            queryBzl(workspaceFolder).then(
                bazelQueryItem => {
                    return {
                        'workspaceFolder': workspaceFolder,
                        'tasks': toTasks(workspaceFolder, bazelQueryItem)
                    }
                }
            )
        );
    }

    function toTasks(bzlWs: utils.BazelWorkspaceProperties, bazelQueryItem: BazelQueryItem[]): Task[] {
        let tasks: Task[] = bazelQueryItem.map(item => {
            const source = 'bazel';
            let name = ` (${item.label})`;
            let taskGroup: TaskGroup;
            let command: string;

            if (item.kind.includes('test')) {
                taskGroup = TaskGroup.Test;
                command = 'test';
                name = "test" + name;
            } else if (item.kind === "container_push") {
                taskGroup = TaskGroup.Build;
                command = 'run';
                name = "run" + name;
            } else {
                taskGroup = TaskGroup.Build;
                command = 'build';
                name = "build" + name;
            }


            let bzlTaskDefinition: BazelTaskDefinition = {
                type: 'bazel',
                target: item.label,
                kind: item.kind,
                command: command
            };

            
            let task = new Task(bzlTaskDefinition, bzlWs.workspaceFolder, name, source);
            task.group = taskGroup;
            task.execution = new ProcessExecution(
                bazelExecutablePath,
                [bzlTaskDefinition.command, bzlTaskDefinition.target || "..."],
                { cwd: bzlWs.bazelWorkspacePath }
            );

            //task.problemMatchers = [];

            return task;
        });

        // Add special tasks
        tasks.push(cleanTask(bzlWs));

        return tasks.sort((t1, t2) => t1.name.localeCompare(t2.name));
    }

    function cleanTask(bzlWs: utils.BazelWorkspaceProperties) {
        const name = 'clean';
        const source = 'bazel';

        let bzlTaskDefinition: BazelTaskDefinition = {
            type: 'bazel',
            command: 'clean',
        };

        let task = new Task(bzlTaskDefinition, bzlWs.workspaceFolder, name, source);
        task.group = TaskGroup.Clean;
        task.execution = new ProcessExecution(
            bazelExecutablePath,
            [bzlTaskDefinition.command],
            { cwd: bzlWs.bazelWorkspacePath }
        );

        return task;
    }

    /**
     * Execute a bazel command with the following args from the specified directory.
     * @param args Arguments for the bazel command.
     * @param bzlWd Working directory from where the bazel command must be execute.
     * @returns The bazel stderr and stdout.
     */
    function exec(args: string[], bzlWd: utils.BazelWorkspaceProperties): Promise<{ stdout:string, stderr:string }> {
        return child_proc.exec(
            `"${bazelExecutablePath}" ${args.join(' ')}`,
            { cwd: bzlWd.bazelWorkspacePath }
        );
    }

    /**
     * 
     * @param bzlWs 
     * @param error 
     */
    function parseErrorDiagnostics(bzlWs: utils.BazelWorkspaceProperties, error: Error) {
        const errors = error.toString().split('\n');
        const errorRegex = /ERROR: ((\w:)?([^:]*)):(\d+):(\d+): (.*)/;

        for(let error of errors) {
            let match: RegExpExecArray | null;
            if((match = errorRegex.exec(error.trim())) !== null) {
                let path        = match[1];
                let line        = parseInt(match[4]);
                let column      = parseInt(match[5]);
                let message     = match[6];

                let position   = new Position(line, column);
                let range      = new Range(position, position);
                let diagnostic = new Diagnostic(range, message);
                let fileUri    = Uri.file(path);

                let {dispose} = Workspace.onDidSaveTextDocument(txtDoc => {
                    bazelDiagnosticsCollection.clear();
                    dispose();
                    bazel.queryBzl(bzlWs, '...');
                });

                let diagnostics = bazelDiagnosticsCollection.get(fileUri) || [];
                diagnostics.push(diagnostic);
                bazelDiagnosticsCollection.set(fileUri, diagnostics);
            }
        }
    }
}

