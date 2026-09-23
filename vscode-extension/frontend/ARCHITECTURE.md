# Extension and backend architecture

The VS Code frontend is bundled from `src/extension.ts` into the root extension package. It prompts for a GitHub commit URL, retrieves the OpenAI key from VS Code SecretStorage, and starts the Python ARGUS pipeline as short lived processes.

The backend is the bundled Python pipeline under `python/scripts/ARGUS`. On first extension activation, the frontend creates a private environment in VS Code global storage and installs `python/requirements.txt`; later activations reuse it unless the requirements change. The frontend then runs artifact retrieval, rationale sentence identification, and rationale generation in order, passing the commit URL, model, run count, and API key in the child process environment. No HTTP server, port, or separate backend repository is required.

The generated artifacts and summary are stored under `globalStorage/runtime/results/<owner>__<repo>__<sha-prefix>/`. Setup and task output is written to the Rationale output channel and failures are shown in VS Code error notifications.
