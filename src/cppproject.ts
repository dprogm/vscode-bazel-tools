import { window as Window,InputBoxOptions } from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { utils } from './utils';
import { CCppPropertiesSchema, Configurations } from './c_cpp_properties'

export module cppproject {
    type Configuration = Configurations[0];

    /**
     * Evaluates the passed (C++) descriptor files and generates the file
     * 'c_cpp_properties.json' that makes all paths available to vscode
     * under 'ws_root_dir/.vscode'.
     * 
     * @param bzlWs 
     * @param descriptorFiles Rule dependent descriptor data such as include paths.
     */
    export async function createCppProperties(bzlWs: utils.BazelWorkspaceProperties, descriptorFiles: string[]) {
        if (descriptorFiles.length < 1) {
            return;
        }

        // Root directory of the users workspace.
        const workspaceRootDir = bzlWs.workspaceFolder.uri.fsPath;
        // Bazel output directory.
        const bazelOutputRootDir = path.join(bzlWs.bazelWorkspacePath, `bazel-${path.basename(bzlWs.bazelWorkspacePath)}`);

        try {
            let includePaths = new Set<string>();
            let defines = new Set<string>();

            for (const descriptorFile of descriptorFiles) {
                const descriptor: utils.BazelDescriptor = require(descriptorFile);
                const bzlRuleKind = descriptor.kind;
                if (
                    bzlRuleKind == 'cc_binary'      ||
                    bzlRuleKind == 'cc_library'     ||
                    bzlRuleKind == 'cc_toolchain'   ||
                    bzlRuleKind == 'apple_cc_toolchain'
                ) {
                    const targetIncludes = Array.of(
                        ...descriptor.cc.include_dirs,
                        ...descriptor.cc.system_include_dirs,
                        ...descriptor.cc.quote_include_dirs
                    );

                    descriptor.cc.built_in_include_directory.forEach(value => includePaths.add(value));
                    descriptor.cc.defines.forEach(value => defines.add(value));

                    for (let include of targetIncludes) {
                        include = path.normalize(include);
                        if (include.split(path.sep)[0] != 'bazel-out') {
                            const absIncludePath = path.join(bazelOutputRootDir, include);
                            includePaths.add(absIncludePath);
                        }
                    }
                } // end if cc_*
            }

            // createOrUpdateCppPropertiesFile
            await createOrUpdateCppPropertiesFile(
                workspaceRootDir,
                includePaths,
                defines,
                require(descriptorFiles[descriptorFiles.length - 1])
            );;
        } catch (err) {
            console.log(err.toString());
        }
    }

    
    async function createOrUpdateCppPropertiesFile(
        workspaceRootDir: string,
        includePaths: Set<string>,
        defines: Set<string>,
        descriptor: utils.BazelDescriptor
    ) {
        const cppPropsFile = path.join(workspaceRootDir, '.vscode', 'c_cpp_properties.json');
        const cppPropsExists = await fs.exists(cppPropsFile);
        let cppProject: CCppPropertiesSchema;
        if (cppPropsExists) {
            cppProject = require(cppPropsFile);
        } else {
            cppProject = defaultCppProject();
        }

        let createOrUpdateFile = true;
        let configurationIndex = cppProject.configurations.findIndex(
            conf => (conf.name === 'Linux' || conf.name === 'Mac' || conf.name === 'Win32')
        );
        if (configurationIndex !== -1) {
            let options: InputBoxOptions = {
                prompt: 'There is already a c_cpp_properties.json file in your workspace. Can we update it?',
                placeHolder: 'y/yes to update'
            };
            const users_decision = await Window.showInputBox(options);
            createOrUpdateFile = users_decision === 'y' || users_decision === 'yes';
        }

        if (createOrUpdateFile) {
            let configuration: Configuration;
            if (configurationIndex === -1) {
                configuration = defaultCppProjectConfiguration();
                cppProject.configurations.push(configuration);
            } else {
                configuration = cppProject.configurations[configurationIndex];
            }

            switch (os.platform()) {
                case 'linux':
                    configuration.name = 'Linux';
                    configuration.intelliSenseMode = 'clang-x64';
                    break;

                case 'darwin':
                    configuration.name = 'Mac';
                    configuration.intelliSenseMode = 'clang-x64';
                    break;

                case 'win32':
                    configuration.name = 'Win32';
                    configuration.intelliSenseMode = 'msvc-x64';
                    break;
            }
            configuration.includePath = Array.from(includePaths);
            configuration.defines = Array.from(defines);
            configuration.defines = descriptor.cc.defines;
            if (configuration.browse === undefined) {
                configuration.browse = {
                    limitSymbolsToIncludedHeaders: true,
                    databaseFilename: `\${workspaceFolder}/.vscode/${os.platform()}.browse.vc.db`
                }
            }

            await fs.writeFile(cppPropsFile, JSON.stringify(cppProject, null, 4));
            Window.showInformationMessage('c_cpp_properties.json file has been successfully created');
        }
    }

    function defaultCppProjectConfiguration(): Configuration {
        return {
            name: 'unknown',
            intelliSenseMode: '${default}',
            browse: {}
        };
    }

    function defaultCppProject(): CCppPropertiesSchema {
        return {
            configurations: [],
            version: 4
        }
    }
}
