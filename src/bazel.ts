import {
    workspace as Workspace,
    WorkspaceConfiguration,
    Terminal,
    DiagnosticCollection,
    languages,
    Diagnostic,
    Position,
    Range
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
        bazelDiagnosticsCollection = languages.createDiagnosticCollection("bazel");
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
     * @param wd Working directory from where the bazel command must be launch.
     * @param query Bazel query to execute.
     * @returns List of all rules that have been found.
     */
    export function queryBzl(wd: string, query: string = '...'): Promise<BazelQueryItem[]> {
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
            wd
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
            bzlQueryErrorDiagnostics(wd, error);
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
            bzlWs.workspaceFolder.uri.fsPath
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

    /**
     * Execute a bazel build command in the given terminal.
     * @param terminal Terminal to use for executing the build command.
     * @param target Target that must be build.
     */
    export function build(terminal: Terminal, target: string): void {
        runInTerminal(terminal, [bazelExecutablePath, 'build', target]);
    }

    /**
     * Execute a bazel run command in the given terminal.
     * @param terminal Terminal to use for executing the run command.
     * @param target Target that must be run.
     */
    export function run(terminal: Terminal, target: string): void {
        runInTerminal(terminal, [bazelExecutablePath, 'run', target]);
    }

    /**
     * Execute a bazel clean command in the given terminal.
     * @param terminal Terminal to use for executing the clean command.
     */
    export function clean(terminal: Terminal) {
        runInTerminal(terminal, [bazelExecutablePath, 'clean']);
    }

    /**
     * Execute the given command in the terminal.
     * @param terminal Terminal to use for executing the command.
     * @param command Command to execute.
     */
    function runInTerminal(terminal: Terminal, command: string[]): void {
        terminal.sendText(command.join(' '), true);
    }

    /**
     * Execute a bazel command with the following args from the specified directory.
     * @param args Arguments for the bazel command.
     * @param wd Working directory from where the bazel command must be execute.
     * @returns The bazel stderr and stdout.
     */
    function exec(args: string[], wd: string): Promise<{ stdout:string, stderr:string }> {
        return child_proc.exec(`"${bazelExecutablePath}" ${args.join(' ')}`, { cwd: wd });
    }

    function bzlQueryErrorDiagnostics(wd: string, error: Error) {
        let errorStr = error.toString();
        let errors = errorStr.split("\n");
        let errorStart = "ERROR:";
        for(let error of errors) {
            if(error.startsWith(errorStart)) {
                error = error.substr(errorStart.length);
                let slashIndex = error.indexOf("/");
                let colonIndex = error.indexOf(":");
                let drivePrefix = '';
                if(colonIndex > -1 && colonIndex < slashIndex) {
                    drivePrefix = error.substr(0, colonIndex+1).trim();
                    colonIndex = error.indexOf(":", colonIndex+1);
                }
                let [lineStr, colStr] = error.substr(colonIndex+1).split(":");
                // Bazel returns non-zero based
                let line = parseInt(lineStr)-1;
                let col = parseInt(colStr)-1;
                let startPosition = new Position(line, col);
                let endPosition = new Position(line, col);
                let range = new Range(startPosition, endPosition);
                
                let errorMessage = error.substr(
                    colonIndex + lineStr.length + colStr.length + 3
                ).trim();
                let diagnostic = new Diagnostic(range, errorMessage);
                let filePath = drivePrefix + error.substring(
                    slashIndex, colonIndex
                );
                let fileUri = Uri.file(filePath)
                let {dispose} = Workspace.onDidSaveTextDocument(txtDoc => {
                    bazelDiagnosticsCollection.clear();
                    dispose();
                    bazel.queryBzl(wd, '...');
                })
                let diagnostics = bazelDiagnosticsCollection.get(fileUri) || [];
                diagnostics.push(diagnostic);
                bazelDiagnosticsCollection.set(fileUri, diagnostics);
            }
        }
    }
}

