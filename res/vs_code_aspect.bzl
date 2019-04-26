load(":artifacts.bzl",
    "artifact_location",
    "struct_omit_none"
)

def get_source_jars(output):
    if hasattr(output, "source_jars"):
        return output.source_jars
    if hasattr(output, "source_jar"):
        return [output.source_jar]
    return []

def library_artifact(java_output):
    """Creates a LibraryArtifact representing a given java_output."""
    if java_output == None or java_output.class_jar == None:
        return None
    src_jars = get_source_jars(java_output)
    return struct_omit_none(
        jar = artifact_location(java_output.class_jar),
        interface_jar = artifact_location(java_output.ijar),
        source_jar = artifact_location(src_jars[0]) if src_jars else None,
        source_jars = [artifact_location(f) for f in src_jars],
    )

def _get_project_info(target, ctx):
    cc_info = None
    java_info = None

    if hasattr(target, 'cc'):
        cpp_toolchain = None
        if hasattr(ctx.rule.attr, '_cc_toolchain'):
            cpp_toolchain = ctx.rule.attr._cc_toolchain[cc_common.CcToolchainInfo]
            cc_info = struct(
                include_dirs          = target.cc.include_directories,
                system_include_dirs   = target.cc.system_include_directories,
                quote_include_dirs    = target.cc.quote_include_directories,
                compile_flags         = target.cc.compile_flags,
                defines               = target.cc.defines,

                #base_compiler_option       = cpp_toolchain.compiler_options(),
                #c_option                   = cpp_toolchain.c_options(),
                #cpp_option                 = cpp_toolchain.cxx_options(),
                #unfiltered_compiler_option = cpp_toolchain.unfiltered_compiler_options([]),
                cpp_executable             = str(cpp_toolchain.compiler_executable),
                built_in_include_directory = [str(d) for d in cpp_toolchain.built_in_include_directories],
            )
        else:
            cc_info = struct(
                include_dirs          = target.cc.include_directories,
                system_include_dirs   = target.cc.system_include_directories,
                quote_include_dirs    = target.cc.quote_include_directories,
                compile_flags         = target.cc.compile_flags +
                                        ctx.fragments.cpp.compiler_options([]) +
                                        ctx.fragments.cpp.cxx_options([]),
                defines               = target.cc.defines,
            )
    elif hasattr(target, 'java'):
        jars = [library_artifact(output) for output in target.java.outputs.jars]
        runtime_classpath = None
        if target.java.compilation_info:
            runtime_classpath = [ artifact_location(runtime_classpath) for runtime_classpath in target.java.compilation_info.runtime_classpath ]
        java_info = struct(
            runtime_classpath = runtime_classpath,
            jars = jars
        )

    return struct(
        kind           = ctx.rule.kind,
        workspace_root = ctx.label.workspace_root,
        package        = ctx.label.package,

        files          = struct(**{name: _get_file_group(ctx.rule.attr, name) for name in ['srcs', 'hdrs']}),
        deps           = [str(dep.label) for dep in getattr(ctx.rule.attr, 'deps', [])],
        target         = struct(label=str(target.label), files=[f.path for f in target.files]),

        cc             = cc_info,
        java           = java_info
    )

def _get_file_group(rule_attrs, attr_name):
    file_targets = getattr(rule_attrs, attr_name, None)
    if not file_targets: return []
    return [file.path for t in file_targets for file in t.files]

# def _get_toolchain_info(target, ctx):
#     cpp_toolchain = target[cc_common.CcToolchainInfo]
#     return struct(
#         kind                       = ctx.rule.kind,
#         target_name                = cpp_toolchain.target_gnu_system_name,
#         base_compiler_option       = cpp_toolchain.compiler_options(),
#         c_option                   = cpp_toolchain.c_options(),
#         cpp_option                 = cpp_toolchain.cxx_options(),
#         unfiltered_compiler_option = cpp_toolchain.unfiltered_compiler_options([]),
#         cpp_executable             = str(cpp_toolchain.compiler_executable),
#         built_in_include_directory = [str(d) for d in cpp_toolchain.built_in_include_directories],
#     )



def _vs_code_bazel_inspect_impl(target, ctx):
    info_file = ctx.actions.declare_file('vs_code_bazel_descriptor_%s.json' % target.label.name)
    # if 'cc_toolchain' in ctx.rule.kind:
    #     content = _get_toolchain_info(target, ctx).to_json()
    # else:
    content = _get_project_info(target, ctx).to_json()
    ctx.actions.write(info_file, content, is_executable=False)

    outputs = depset([info_file])
    for dep in getattr(ctx.rule.attr, 'deps', []):
        outputs += dep[OutputGroupInfo].descriptor_files
    return [OutputGroupInfo(descriptor_files=outputs)]


vs_code_bazel_inspect = aspect(
    attr_aspects = ["deps", "_cc_toolchain", "_java_toolchain"],
    fragments = ["cpp", "java"],
    implementation = _vs_code_bazel_inspect_impl
)
