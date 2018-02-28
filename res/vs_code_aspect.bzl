def _vs_code_bazel_inspect_impl(target, ctx):
    rule_data = None
    rule_kind = ctx.rule.kind
    if rule_kind == 'cc_library' or rule_kind == 'cc_binary' or rule_kind == 'boost_library':
        rule_data = struct(
            includes = target.cc.include_directories 
                + target.cc.quote_include_directories 
                + target.cc.system_include_directories 
        )
    
    target_descriptor_file = ctx.actions.declare_file(
        'vs_code_bazel_descriptor_%s.json' % target.label.name)
    data = struct(
        kind = rule_kind,
        data = rule_data
    )
    ctx.actions.write(target_descriptor_file, data.to_json())
    return [OutputGroupInfo(descriptor_files = depset([target_descriptor_file], 
        transitive = [dep[OutputGroupInfo].descriptor_files 
            for dep in ctx.rule.attr.deps]))]

vs_code_bazel_inspect = aspect(
    implementation = _vs_code_bazel_inspect_impl,
    attr_aspects = ["deps"]
)