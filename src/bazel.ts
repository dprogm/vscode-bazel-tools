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
        readonly kind: string;
        readonly label: string;
    }

    let bazelExecutablePath: string;
    let excludedPackages: string[];

    export function init() {
        Workspace.onDidChangeConfiguration(configurationChangeEvent => {
            if (configurationChangeEvent.affectsConfiguration('bazel')) {
                loadConfiguration(Workspace.getConfiguration('bazel'));
            }
        });
        loadConfiguration(Workspace.getConfiguration('bazel'));
    }


    function loadConfiguration(bazelConfig: WorkspaceConfiguration): void {
        bazelExecutablePath = bazelConfig.get<string>('executablePath') || 'bazel';
        excludedPackages = bazelConfig.get<string[]>('packageExcludes') || [];
    }

    export async function queryBzl(cwd: string, query: string = '...'): Promise<BazelQueryItem[]> {
        let excludedPackagesStr = excludedPackages.join(',');
        let proc = exec(
            [
                'query',
                `"${query}"`,
                '--noimplicit_deps',
                '--nohost_deps',
                `--deleted_packages=${excludedPackagesStr}`,
                '--output', 'label_kind'
            ],
            cwd
        );

        let stdout:string = await proc.then(child => child.stdout);
        stdout = stdout.trim();

        let dependencies = stdout ? stdout.split('\n') : [];
        let separator = ' rule ';

        let queries = dependencies.map((dependency: string): BazelQueryItem => {
            let idx = dependency.search(separator);

            return {
                kind: dependency.substr(0, idx),
                label: dependency.substr(idx + separator.length)
            };
        });
        
        return queries;
    }

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

    export function build(terminal: Terminal, target: string) {
        runInTerminal(terminal, [bazelExecutablePath, 'build', target]);
    }

    export function run(terminal: Terminal, target: string) {
        runInTerminal(terminal, [bazelExecutablePath, 'run', target]);
    }

    export function clean(terminal: Terminal) {
        runInTerminal(terminal, [bazelExecutablePath, 'clean']);
    }

    function runInTerminal(term: Terminal, cmd: string[]) {
        term.sendText(cmd.join(' '), true);
    }

    function exec(args: string[], ws: string): Promise<{ stdout:string, stderr:string }> {
        return child_proc.exec(`"${bazelExecutablePath}" ${args.join(' ')}`, { cwd: ws });
    }
}

