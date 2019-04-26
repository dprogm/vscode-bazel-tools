import {
    BazelWorkspaceProperties,
    BazelDescriptorJar
} from './descriptor';
import * as path from 'path';
import * as fs from 'fs-extra';
import { window } from 'vscode';
import { BazelDescriptor } from './descriptor';

export module javaproject {

    export async function createJavaProject(
        bzlWs: BazelWorkspaceProperties,
        target: string,
        descriptorFiles: string[]
    ) {
        if (descriptorFiles.length < 1) {
            return;
        }

        // Root directory of the users workspace.
        const workspaceRootDir = bzlWs.workspaceFolder.uri.fsPath;

        const { jars } = parseDescriptors(bzlWs, descriptorFiles);

        const awaitableElements = [
            generateClasspathFile(
                bzlWs,
                jars,
                require(descriptorFiles[descriptorFiles.length - 1])
            ),
            generateProjectFile(workspaceRootDir, target),
            generateSettings(workspaceRootDir)
        ];

        for (const elt of awaitableElements) {
            await elt;
        }

        window.showInformationMessage('Java projects files has been successfully created/updated');
    }

    function parseDescriptors(
        bzlWs: BazelWorkspaceProperties,
        descriptorFiles: string[]
    ) {
        const bazelWorkspaceFolderForExternal = `bazel-${path.basename(bzlWs.bazelWorkspacePath)}`;
        let jars: Map<string, { jar: string; source_jar?: string; }> = new Map();

        const f_jarPath = (jar: BazelDescriptorJar): string => {
            if (jar.is_external) {
                if (jar.is_new_external_version) {
                    return path.join(
                        bzlWs.bazelWorkspacePath,
                        bazelWorkspaceFolderForExternal,
                        jar.root_execution_path_fragment,
                        jar.relative_path
                    );
                }
            }

            return path.join(
                bzlWs.bazelWorkspacePath,
                jar.root_execution_path_fragment,
                jar.relative_path
            );
        }

        for (const descriptorFile of descriptorFiles) {
            const descriptor: BazelDescriptor = require(descriptorFile);

            const bzlRuleKind = descriptor.kind;
            if (bzlRuleKind.startsWith('java_')) {
                if (descriptor.java) {
                    if (descriptor.java.runtime_classpath) {
                        for (const runtimeClasspath of descriptor.java.runtime_classpath) {
                            let absPath = f_jarPath(runtimeClasspath);
                            let dep = jars.get(runtimeClasspath.relative_path);
                            if (!dep) {
                                dep = <{ jar: string }>{};
                                jars.set(runtimeClasspath.relative_path, dep);
                            }
                            dep.jar = absPath;
                        }
                    }

                    for (const jar of descriptor.java.jars) {
                        const jarAbsPath = f_jarPath(jar.jar);
                        let jarSrcAbsPath: string | undefined = undefined;
                        if (jar.source_jar) {
                            jarSrcAbsPath = f_jarPath(jar.source_jar);
                        }
                        let dep = jars.get(jar.jar.relative_path);
                        if (!dep) {
                            dep = <{ jar: string }>{};
                            jars.set(jar.jar.relative_path, dep);
                        }
                        dep.jar = jarAbsPath;
                        dep.source_jar = jarSrcAbsPath;
                    }
                } // end if descriptor.java
            } // end if java_*
        } // end loop

        return {
            jars: Array.from(jars.values())
        };
    }

    async function generateClasspathFile(
        bzlWs: BazelWorkspaceProperties,
        jars: { jar: string; source_jar?: string; }[],
        descriptor: BazelDescriptor
    ) {
        const workspaceRootDir = bzlWs.workspaceFolder.uri.fsPath;
        const classpath = path.join(workspaceRootDir, '.classpath');
        let srcDir = 'TO BE DEFINE';
        let content = '<?xml version="1.0" encoding="UTF-8"?>\n';
        content += '<classpath>\n';

        // Try to determine src path
        if (descriptor.files.srcs.length > 0) {
            const srcFile = path.join(bzlWs.bazelWorkspacePath, descriptor.files.srcs[0]);
            const javaSrc = await fs.readFile(srcFile, { encoding: 'utf8', flag: 'r' });
            const pkgMatch = /package\s+([^;]+);/.exec(javaSrc);
            if (pkgMatch) {
                const pkgAsDir = pkgMatch[1].replace(/\./g, path.sep);
                const index = srcFile.indexOf(pkgAsDir);
                if (index !== -1) {
                    srcDir = path.relative(
                        workspaceRootDir,
                        srcFile.substr(0, index)
                    );
                }
            } else {
                srcDir = path.relative(
                    workspaceRootDir,
                    path.dirname(srcFile)
                );
            }
        } else {
            window.showWarningMessage(
                'No source file found for the target cannot determine source directory...\n' +
                'Please open .classpath file to complete it yourself.'
            );
        }

        content += `	<classpathentry kind="src" path="${srcDir}"/>\n`;
        content += '	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>\n';

        // Add jars dependencies
        for (const jar of jars) {
            content += `	<classpathentry kind="lib" path="${jar.jar}"`
            if (jar.source_jar) {
                content += `\n		sourcepath="${jar.source_jar}"`
            }
            content += "/>\n";
        }

        content += '</classpath>\n';

        return fs.writeFile(classpath, content, { encoding: 'utf8', flag: 'w' });
    }

    function generateProjectFile(workspaceRootDir: string, target: string) {
        const projectFilePath = path.join(workspaceRootDir, '.project');

        const projectName = target.replace(/^[^:]*:/, '');

        const fileContent =
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<projectDescription>\n' +
            `	<name>${projectName}</name>\n` +
            '	<comment></comment>\n' +
            '	<projects>\n' +
            '	</projects>\n' +
            '	<buildSpec>\n' +
            '	</buildSpec>\n' +
            '	<natures>\n' +
            '		<nature>org.eclipse.jdt.core.javanature</nature>\n' +
            '	</natures>\n' +
            '</projectDescription>';

        return fs.writeFile(projectFilePath, fileContent, { encoding: 'utf8', flag: 'w' });
    }

    function generateSettings(workspaceRootDir: string) {
        const settingsDirPath = path.join(workspaceRootDir, '.settings');
        const settingsFilePath = path.join(settingsDirPath, 'org.eclipse.jdt.core.prefs');
        try {
            fs.mkdirSync(settingsDirPath)
        } catch (err) {
            if (err.code !== 'EEXIST') throw err
        }

        const fileContent =
            'eclipse.preferences.version=1\n' +
            'org.eclipse.jdt.core.compiler.codegen.inlineJsrBytecode=enabled\n' +
            'org.eclipse.jdt.core.compiler.codegen.targetPlatform=1.8\n' +
            'org.eclipse.jdt.core.compiler.codegen.unusedLocal=preserve\n' +
            'org.eclipse.jdt.core.compiler.compliance=1.8\n' +
            'org.eclipse.jdt.core.compiler.debug.lineNumber=generate\n' +
            'org.eclipse.jdt.core.compiler.debug.localVariable=generate\n' +
            'org.eclipse.jdt.core.compiler.debug.sourceFile=generate\n' +
            'org.eclipse.jdt.core.compiler.problem.assertIdentifier=error\n' +
            'org.eclipse.jdt.core.compiler.problem.enumIdentifier=error\n' +
            'org.eclipse.jdt.core.compiler.source=1.8\n';

        return fs.pathExists(settingsFilePath).then(exists => {
            if (!exists) {
                fs.writeFile(settingsFilePath, fileContent, { encoding: 'utf8', flag: 'w' });
            }
        });
    }
}