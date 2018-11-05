
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.substr(1);
}
export namespace utils {
    /**
     * Maps bazel rules that belong together to their
     * target programming language. If a rule is not
     * used for compiling any language but aims to
     * fulfill a more general task then we use the
     * rule kind as the return value.
     * @param rule_kind 
     * @returns
     * @todo Complete this map.
     */
    export function ruleKindToLanguage(rule_kind: string): string {
        rule_kind = rule_kind.trim();
        let lang = rule_kind;
        switch (rule_kind) {
            case 'cc_library':
            case 'cc_import':
            case 'cc_binary':
            case 'cc_test':
                lang = 'C++';
                break;
            case 'cc_toolchain_suite':
            case 'cc_toolchain':
                lang = 'C++ Tools';
                break;
            case 'py_binary':
            case 'py_library':
            case 'py_test':
            case 'py_runtime':
                lang = 'Python';
                break;
            case 'java_library':
            case 'jave_import':
            case 'java_binary':
            case 'java_test':
                lang = 'Java';
                break;
            case 'filegroup':
                lang = 'Filegroup';
                break;
        }
        return lang;
    }



    const DECOMPOSE_LABEL_REGEX = /(@.+)?\/\/(.+)?:(.+)/;
    const DECOMPOSE_LABEL_ERROR = {
        ws: '<ERROR>',
        pkg: '<ERROR>',
        target: '<ERROR>'
    };

    /**
     * Split the bazel label into its atomic parts:
     * workspace name, package and target (name)
     *
     * Pattern: @ws_name//pkg:target
     *
     * The current workspace is referred to as the local
     * workspace in contrast with remote workspaces that
     * are identified by the prefixed at sign.
     * @param label 
     * @returns
     */
    export function decomposeLabel(label: string) {
        let decomposedLabel = DECOMPOSE_LABEL_ERROR;
        let matches = DECOMPOSE_LABEL_REGEX.exec(label)
        if (matches !== null) {
            decomposedLabel= {
                ws: matches[1] || 'local',
                pkg: matches[2] || '',
                target: matches[3]
            };
        }
        
        return decomposedLabel;
    }

    export function setAdd<T>(set: Set<T>, elements: T[]) {
        for (const element of elements) {
            set.add(element);
        }
        return set;
    }
}