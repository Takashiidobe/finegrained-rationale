# Todos

1. [x] Add "Explain Rationale" to VS Code's Source view

There's an open issue where people have wanted this for a few years, it's not
public:

https://github.com/microsoft/vscode/issues/201997

Alternative is to open vs code with
`code --enable-proposed-api SEALab.argus-rationale` which nobody will do.

2. [x] Make the top k = 3 commits configurable for commit view. We should
       already have this configurable as a vs code setting, could add
       information for this in the README.

   In the settings now, rationale.maxCommits.

3. [ ] Need to evaluate the prompts. Prompt currently makes up justification
       when it shouldn't for highlighted text

4. [x] Sentence references should be inline

5. [x] Error text when not configuring the app is wordy, should just say "make
       sure claude code cli is installed, on your $PATH and you are logged in"

6. [x] Visualizer should have less padding, and an option to reopen in
       visualizer.

7. [x] Error message when selecting code should say the code selection is not
       fully committed, and it only works for committed code.

8. [x] Add issue number + PR number to rationale + references

9. [ ] highlight boxes inside of the graphics, delete ARGUS backend, shrink
       related work, use up whitespace more and zoom into and use less
       background for vs code

10. [ ] Rename to ARGUS for VS Code
