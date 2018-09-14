import {
    workspace as Workspace,
    WorkspaceConfiguration,
    Terminal
} from 'vscode';
const child_proc = require('child-process-async');
import * as path from 'path';
import { utils } from './utils';


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
    export async function queryBzl(wd: string, query: string = '...'): Promise<BazelQueryItem[]> {
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
        let stdout:string = await proc.then(child => child.stdout);
        stdout = stdout.trim();

        let dependencies = stdout ? stdout.split('\n') : [];
        let separator = ' rule ';

        // Search for all rule and return it
        let queries = dependencies.map((dependency: string): BazelQueryItem => {
            let idx = dependency.search(separator);

            return {
                kind: dependency.substr(0, idx),
                label: dependency.substr(idx + separator.length)
            };
        });
        
        return queries;
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
     * @param ws Working directory from where the bazel command must be execute.
     * @returns The bazel stderr and stdout.
     */
    function exec(args: string[], ws: string): Promise<{ stdout:string, stderr:string }> {
        return child_proc.exec(`"${bazelExecutablePath}" ${args.join(' ')}`, { cwd: ws });
    }
}

