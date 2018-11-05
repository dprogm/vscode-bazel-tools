import { WorkspaceFolder } from 'vscode';

export interface BazelDescriptorJavaClasspath {
    readonly jar: BazelDescriptorJar;
    readonly source_jar?: BazelDescriptorJar;
    readonly source_jars?: BazelDescriptorJar[];
}

export interface BazelDescriptorJavaRuntimeClasspath {
    readonly relative_path: string;
    readonly is_source: boolean;
    readonly is_external: boolean;
    readonly root_execution_path_fragment: string;
    readonly is_new_external_version: boolean;
}

export interface BazelDescriptorJar {
    readonly relative_path: string;
    readonly is_source: boolean;
    readonly is_external: boolean;
    readonly root_execution_path_fragment: string;
    readonly is_new_external_version: boolean;

}

export interface BazelDescriptorJava {
    readonly runtime_classpath?: BazelDescriptorJavaRuntimeClasspath[];
    readonly jars: BazelDescriptorJavaClasspath[];
}

export interface BazelDescriptorCppFiles {
    readonly srcs: string[];
    readonly hdrs: string[];
}

export interface BazelDescriptorTarget {
    readonly label: string;
    readonly files: string[];
}

export interface BazelDescriptorCpp {
    readonly include_dirs: string[];
    readonly system_include_dirs: string[];
    readonly quote_include_dirs: string[];
    readonly compile_flags: string[];
    readonly defines: string[];

    readonly base_compiler_option?: string[];
    readonly c_option?: string[];
    readonly cpp_option?: string[];
    readonly unfiltered_compiler_option?: string[];
    readonly cpp_executable?: string;
    readonly built_in_include_directory?: string[];
}

export interface BazelDescriptor {
    readonly kind: string;
    readonly workspace_root: string;
    readonly package: string;
    readonly files: BazelDescriptorCppFiles;
    readonly deps: string[];
    readonly target: BazelDescriptorTarget;
    readonly cc: BazelDescriptorCpp;
    readonly java?: BazelDescriptorJava;
}

export interface BazelWorkspaceProperties {
    readonly workspaceFolder: WorkspaceFolder;
    readonly bazelWorkspacePath: string;
    readonly aspectPath: string;
}

