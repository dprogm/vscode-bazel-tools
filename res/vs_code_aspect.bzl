SrcFiles = provider(fields = ["transitive_sources"])

def collect(srcs, deps):
  for src in srcs:
    print(src.files)
  return depset(srcs,
        transitive = [dep[SrcFiles].transitive_sources for dep in deps])

def _cpp_deps_dbg_impl(target, ctx):
    trans_srcs = []
    kind = ctx.rule.kind
    if kind == 'cc_library' or kind == 'cc_binary':
        trans_srcs = collect(ctx.rule.attr.srcs, ctx.rule.attr.deps)
    else:
        print(kind + ' will not be considered')
    return [SrcFiles(transitive_sources=trans_srcs)]

cpp_deps_dbg = aspect(
    implementation = _cpp_deps_dbg_impl,
    attr_aspects = ["deps"],
)