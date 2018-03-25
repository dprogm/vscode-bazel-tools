# Change Log

### Version 0.0.5: March 25, 2018

- quick pick no longer waits until the bazel query finishes
- only showing binary targets for bazel run
- making use of the `QuickPickItem` details property to show more
information in the quick pick
- removed table view option [#1](https://github.com/dprogm/vscode-bazel-tools/issues/1)
- added bazel clean command

**Thank you for contributing:**

- [zaucy](https://github.com/zaucy)

### Version 0.0.4: March 12, 2018

- init as soon as a `WORKSPACE` file is available
- added status bar buttons for build, run and cpp properties generation
- also consider `cc_test` and `cc_import` for `c_cpp_properties.json` generation

### Version 0.0.3: March 11, 2018

- added option for package and rule excludes

### Version 0.0.2: March 10, 2018

- support for OSX
- use the right path for setting up the workspace
- fixed wrong label decomposition
- only consider c++ targets for `c_cpp_properties.json` generation

### Version 0.0.1: March 9, 2018

- preview release (experimental)