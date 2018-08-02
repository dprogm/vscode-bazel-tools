# Bazel Tools (Experimental)

Bazel integration for Visual Studio Code. If you also want to have syntax highlighting for `BUILD` and `WORKSPACE` files take a look at [bazel-code](https://github.com/devoncarew/bazel-code). The current version is meant to be a **preview** and might have heavy bugs.

## Features

* Running bazel commands from within Visual Studio Code. Detect which targets are available in a `WORKSPACE` and choose one.
* Generation of files for code navigation and auto-completion, e.g. `c_cpp_properties.json`

### Commands

* **Bazel: Create C++ Project**: Creates a `c_cpp_properties.json` file that contains all transitive include paths starting from a root C++ target. Takes also the used toolchain into account and uses their system include directories.
* **Bazel: Build**: Builds a target chosen from the shown label list.
* **Bazel: Run**: Runs a *_binary target chosen from the shown label list.
* **Bazel: Clean**: Cleans up the output directories.

For each command listed above there is also a button available in the status bar.

## Requirements

* A recent version of [bazel](https://www.bazel.build/)

## Roadmap

- Add commands for bazel `fetch` and `test` and provide a user friendly interface for them, especially for `query`. Here we could implement a graph view within vscode that visualizes the dependencies and shows up useful information for each target.

- Extend the language support, especially Java.

Tasks:
- [x] Implement a target picker based on bazel query and build the selected target based on the user decision. Use vscodes terminal for that purpose.
- [x] Implement the run command.
- [x] Implement the `vs_code_aspect` that generates programming language dependent descriptor files. Traverses all C++ dependencies and outputs all include paths known to bazel. Installs the aspect as well as a `BUILD` file into the users workspace in order to make it 'applicable'.
- [x] Generation of `c_cpp_properties.json` file based on bazel aspects output. We use descriptors of any C++ kind.
- [x] Cleanup temporary descriptor files after generation
- [ ] Check bazel installation and `WORKSPACE` on startup and report the status to the user
- [x] Check the usage on other platforms than linux.
- [ ] Implement test cases.
- [ ] Add more language support. Currently the focus is on C++. Building targets is language independent.
- [x] Add language information for each target chosen from the target picker.
- [ ] Consider the visibility of each target
- [ ] Dive deeper into JS and develop a solid extension architecture.
- [x] Provide buttons for build and run.
- [ ] Wrap the bazel commands into a class with a handy interface.

## Contribute
Let me know if you have any suggestions or if you want to contribute. I am happy about any support. The current status is far away from a release version but you can simply check it out and try it in your vscode editor by running:
```shell
npm install
```
Then you can run it in the developer mode.

**Thank you goes out to the following contributors for pushing the project forward:**
- [zaucy](https://github.com/zaucy)