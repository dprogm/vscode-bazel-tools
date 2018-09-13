import { window as Window,InputBoxOptions } from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { utils } from './utils';
import { CCppPropertiesSchema, Configurations } from './c_cpp_properties'
import { capitalize } from './tools';

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
    export async function createCppProperties(bzlWs: utils.BazelWorkspaceProperties, target: string, descriptorFiles: string[]) {
        if (descriptorFiles.length < 1) {
            return;
        }

        // Root directory of the users workspace.
        const workspaceRootDir = bzlWs.workspaceFolder.uri.fsPath;
        // Bazel output directory.
        const bazelOutputRootDir = path.join(bzlWs.bazelWorkspacePath, `bazel-${path.basename(bzlWs.bazelWorkspacePath)}`);

        try {
            const {includes, defines} = parseDescriptors(bazelOutputRootDir, descriptorFiles);

            const descriptor: utils.BazelDescriptor = require(descriptorFiles[descriptorFiles.length - 1])
            const cppPropsFile = path.join(workspaceRootDir, '.vscode', 'c_cpp_properties.json');
            
            let cppProject: CCppPropertiesSchema;
            if (fs.existsSync(cppPropsFile)) {
                cppProject = require(cppPropsFile);
            } else {
                cppProject = defaultCppProject();
            }

            let createOrUpdateFile = true;
            const cppProjectTargetName = `${capitalize(os.platform())} (${target})`;
            let configurationIndex = cppProject.configurations.findIndex(conf => conf.name === cppProjectTargetName);
            if (configurationIndex !== -1) {
                let options: InputBoxOptions = {
                    prompt: 'There is already a c_cpp_properties.json file in your workspace. Can we update it?',
                    placeHolder: 'y/yes to update',
                    value: 'yes'
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

                configuration.name = cppProjectTargetName;
                configuration.intelliSenseMode = getIntelliSenseMode(descriptor);
                configuration.cStandard = getCStandard(descriptor);
                configuration.cppStandard = getCppStandard(descriptor);
                configuration.includePath = Array.from(includes);
                configuration.defines = Array.from(defines);
                if (configuration.browse === undefined) {
                    configuration.browse = {
                        limitSymbolsToIncludedHeaders: true,
                        databaseFilename: getDBPath(target)
                    }
                }

                await fs.writeFile(cppPropsFile, JSON.stringify(cppProject, null, 4));
                Window.showInformationMessage('c_cpp_properties.json file has been successfully created/updated');
            }
        } catch (err) {
            console.log(err.toString());
        }
    }

    function parseDescriptors(bazelOutputRootDir: string, descriptorFiles: string[]) {
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

        return {
            includes: includePaths,
            defines: defines
        }
    }

    function getIntelliSenseMode(descriptor: utils.BazelDescriptor) {
        let intelliSenseMode: Configuration["intelliSenseMode"];
        if (descriptor.cc.cpp_executable.endsWith('clang')) {
            intelliSenseMode = 'clang-x64';
        } else if (/(g?cc)|([gc]\+\+)$/.test(descriptor.cc.cpp_executable)) {
            intelliSenseMode = 'gcc-x64';
        } else if (descriptor.cc.cpp_executable.endsWith('cl')) {
            intelliSenseMode = 'msvc-x64';
        } else {
            intelliSenseMode = '${default}';
        }

        return intelliSenseMode;
    }

    function getDBPath(target: string) {
        return "${workspaceFolder}/.vscode/" +
            os.platform() + "." + target.replace(/@|\/\/|:|\//g, '_') + ".browse.vc.db";
    }

    function defaultCppProjectConfiguration(): Configuration {
        return {
            name: 'unknown',
            intelliSenseMode: '${default}'
        };
    }

    function defaultCppProject(): CCppPropertiesSchema {
        return {
            configurations: [],
            version: 4
        }
    }

    function getCStandard(descriptor: utils.BazelDescriptor): Configuration["cStandard"] {
        for (const option of descriptor.cc.c_option) {
            switch (option) {
                case "-ansi":
                case "-std=c89":
                case "-std=c90":
                case "-std=gnu89":
                case "-std=gnu90":
                case "-std=iso9899:1990":
                case "-std=iso9899:199409":
                    return "c89";
                
                case "-std=gnu99":
                case "-std=gnu9x":
                case "-std=c99":
                case "-std=c9x":
                case "-std=iso9899:1999":
                case "-std=iso9899:199x":
                    return "c99";

                case "-std=iso9899:2011":
                case "-std=c1x":
                case "-std=c11":
                case "-std=gnu11":
                case "-std=gnu1x":
                    return "c11"

                case "-std=c17":
                case "-std=iso9899:2017":
                    return "c11";
            }
        }
        return undefined;
    }

    function getCppStandard(descriptor: utils.BazelDescriptor): Configuration["cppStandard"] {
        //-std=c++0x
        for (const option of descriptor.cc.cpp_option) {
            // https://gcc.gnu.org/onlinedocs/gcc-6.2.0/gcc/C-Dialect-Options.html
            switch (option) {
                case "-std=gnu++98":
                case "-std=c++98":
                    return "c++98";

                case "-std=c++03":
                    return "c++03";

                case "-std=gnu++11":
                case "-std=gnu++0x":
                case "-std=c++11":
                case "-std=c++0x":
                    return "c++11";

                case "-std=gnu++14":
                case "-std=gnu++1y":
                case "-std=c++14":
                case "-std=c++1y":
                    return "c++14";

                case "-std=gnu++17":
                case "-std=gnu++1z":
                case "-std=c++17":
                case "-std=c++1z":
                    return "c++17";
            }
        }
        return undefined;
    }
}
