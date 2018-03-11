const os = require('os')

// Extensions source folder that contains
// all required runtime dependencies such
// as the aspects file
exports.BAZEL_EXT_RES_BASE_PATH = 'res'
// The destination folder where all runtime
// dependencies land that are required to be
// in the target source tree.
exports.BAZEL_EXT_DEST_BASE_PATH = '.vscode/.vs_code_bazel_build'
// Bazel requires a package for the aspect.
// This file will be empty.
exports.BAZEL_BUILD_FILE = 'BUILD'
// Required aspect for introspecting the
// bazel dependency graph.
exports.BAZEL_ASPECT_FILE = 'vs_code_aspect.bzl'

// Maps bazel rules that belong together to their 
// target programming language. If a rule is not
// used for compiling any language but aims to
// fulfill a more general task then we use the
// rule kind as the return value.
// TODO: Complete this map.
function bzlTranslateRuleKindToLanguage(rule_kind) {
    rule_kind = rule_kind.trim()
    var lang = rule_kind
    switch(rule_kind) {
        case 'cc_library':
        case 'cc_import':
        case 'cc_binary':
        case 'cc_test':
            lang = 'C++'
        break;
        case 'cc_toolchain_suite':
        case 'cc_toolchain':
            lang = 'C++ Tools'
        break;
        case 'py_binary':
        case 'py_library':
        case 'py_test':
        case 'py_runtime':
            lang = 'Python'
        break;
        case 'java_library':
        case 'jave_import':
        case 'java_binary':
        case 'java_test':
            lang = 'Java'
        break;
        case 'filegroup':
            lang = 'Filegroup'
        break;
    }
    return lang
}

function bzlGetBaseCppProperties() {
    var cpp_props_config_name = ''
    var cpp_props_config_intellisensemode = ''
    switch(os.platform()) {
        case 'linux':
            cpp_props_config_name = 'Linux'
            cpp_props_config_intellisensemode = 'clang-x64'
        break;
        case 'darwin':
            cpp_props_config_name = 'Mac'
            cpp_props_config_intellisensemode = 'clang-x64'
        break;
        case 'win32':
            cpp_props_config_name = 'Win32'
            cpp_props_config_intellisensemode = 'msvc-x64'
        break;
    }
    return {
        'configurations' : [{
                'name' : cpp_props_config_name,
                'intelliSenseMode' : cpp_props_config_intellisensemode,
                'includePath' : [],
                'browse' : {
                    'path' : [],
                    'limitSymbolsToIncludedHeaders' : true,
                    'databaseFilename' : ''
                }
            }
        ],
        'version' : 3
    }
}

module.exports.bzlTranslateRuleKindToLanguage = bzlTranslateRuleKindToLanguage
module.exports.bzlGetBaseCppProperties = bzlGetBaseCppProperties