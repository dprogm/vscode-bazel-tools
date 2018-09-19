import { window as Window,InputBoxOptions } from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export module cppproject {
    /**
     * Evaluates the passed (C++) descriptor files and generates the file
     * 'c_cpp_properties.json' that makes all paths available to vscode
     * under 'ws_root_dir/.vscode'.
     * 
     * @param workspaceRootDir Root directory of the users workspace.
     * @param bazelOutputRootDir Bazel output directory.
     * @param descriptorFiles Rule dependent descriptor data such as include paths.
     */
    export async function createCppProperties(workspaceRootDir: string, bazelOutputRootDir: string, descriptorFiles: string[]) {
        try {
            let includePaths = new Set();
            for (const descriptorFile of descriptorFiles) {
                const descriptor = require(descriptorFile);
                const bzlRuleKind = descriptor.kind;
                if (
                    bzlRuleKind == 'cc_binary'      ||
                    bzlRuleKind == 'cc_library'     ||
                    bzlRuleKind == 'cc_toolchain'   ||
                    bzlRuleKind == 'apple_cc_toolchain'
                ) {
                    let includes = descriptor.data.includes;
                    for (let include of includes) {
                        include = path.normalize(include);
                        if (include.split(path.sep)[0] != 'bazel-out') {
                            let absIncludePath = include;
                            if (bzlRuleKind != 'cc_toolchain' && bzlRuleKind != 'apple_cc_toolchain') {
                                absIncludePath = path.join(bazelOutputRootDir, absIncludePath);
                            }
                            includePaths.add(absIncludePath);
                        }
                    }
                } // end if cc_*
            }
            let cpp_props_file = path.join(workspaceRootDir, '.vscode', 'c_cpp_properties.json');
            let cpp_props_available = await fs.exists(cpp_props_file);
            let cpp_props_create_file = true;
            if (cpp_props_available) {
                let options: InputBoxOptions = {
                    prompt: 'There is already a c_cpp_properties.json file in your workspace. Can we overwrite it?',
                    placeHolder: 'y/yes to overwrite'
                };
                let users_decision = await Window.showInputBox(options);
                if (users_decision != 'y' && users_decision != 'yes') {
                    cpp_props_create_file = false;
                }
            }
            if (cpp_props_create_file) {
                let path_arr = Array.from(includePaths);
                let cpp_props_data: any = bzlGetBaseCppProperties();
                for (let i = 0; i < cpp_props_data.configurations.length; i++) {
                    cpp_props_data.configurations[i].includePath = path_arr;
                    cpp_props_data.configurations[i].browse.path = path_arr;
                }
                await fs.writeFile(cpp_props_file, JSON.stringify(cpp_props_data, null, 4));
                Window.showInformationMessage('c_cpp_properties.json file has been successfully created');
            }
        } catch (err) {
            console.log(err.toString());
        }
    }

    
    function bzlGetBaseCppProperties() {
        var cpp_props_config_name = '';
        var cpp_props_config_intellisensemode: 'msvc-x64' | 'gcc-x64' | 'clang-x64' | '${default}' = '${default}';
        switch (os.platform()) {
            case 'linux':
                cpp_props_config_name = 'Linux';
                cpp_props_config_intellisensemode = 'clang-x64';
                break;
            case 'darwin':
                cpp_props_config_name = 'Mac';
                cpp_props_config_intellisensemode = 'clang-x64';
                break;
            case 'win32':
                cpp_props_config_name = 'Win32';
                cpp_props_config_intellisensemode = 'msvc-x64';
                break;
        }
        return {
            configurations: [
                {
                    name: cpp_props_config_name,
                    intelliSenseMode: cpp_props_config_intellisensemode,
                    includePath: [],
                    browse: {
                        path: [],
                        limitSymbolsToIncludedHeaders: true,
                        databaseFilename: ''
                    }
                }
            ],
            version: 3
        };
    }
}
