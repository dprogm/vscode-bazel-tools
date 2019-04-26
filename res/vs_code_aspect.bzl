def _get_project_info(target, ctx):
    if hasattr(target, 'cc'):
        cpp_toolchain = None
        cc_info = None
        if hasattr(ctx.rule.attr, '_cc_toolchain'):
            cpp_toolchain = ctx.rule.attr._cc_toolchain[cc_common.CcToolchainInfo]
            cc_info = struct(
                include_dirs          = target.cc.include_directories,
                system_include_dirs   = target.cc.system_include_directories,
                quote_include_dirs    = target.cc.quote_include_directories,
                compile_flags         = target.cc.compile_flags + 
                                        ctx.fragments.cpp.compiler_options([]) +
                                        ctx.fragments.cpp.cxx_options([]),
                defines               = target.cc.defines,
                
                base_compiler_option       = cpp_toolchain.compiler_options(),
                c_option                   = cpp_toolchain.c_options(),
                cpp_option                 = cpp_toolchain.cxx_options(),
                unfiltered_compiler_option = cpp_toolchain.unfiltered_compiler_options([]),
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

    else:
        cc_info = None
    return struct(
        kind           = ctx.rule.kind,
        workspace_root = ctx.label.workspace_root,
        package        = ctx.label.package,

        files          = struct(**{name: _get_file_group(ctx.rule.attr, name) for name in ['srcs', 'hdrs']}),
        deps           = [str(dep.label) for dep in getattr(ctx.rule.attr, 'deps', [])],
        target         = struct(label=str(target.label), files=[f.path for f in target.files]),

        cc             = cc_info,
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
    attr_aspects = ["deps", "_cc_toolchain"],
    fragments = ["cpp"],
    implementation = _vs_code_bazel_inspect_impl
)
