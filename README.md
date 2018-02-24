# Bazel Tools

Bazel integration for Visual Studio Code. If you also want to have syntax highlighting for `BUILD` and `WORKSPACE` files take a look at [bazel-code](https://github.com/devoncarew/bazel-code).

## Features

* Running bazel commands from within Visual Studio Code. Detect which targets are available in a `WORKSPACE` and choose one.
* Generation of files for code navigation and auto-completion, e.g. `c_cpp_properties.json`

## Requirements

* A recent version of [bazel](https://www.bazel.build/)

## Roadmap
- [x] Implement target chooser and simple build command
- [ ] Completion of `vs_code_aspect`
- [ ] Check bazel installation and `WORKSPACE` on startup and report the status to the user
