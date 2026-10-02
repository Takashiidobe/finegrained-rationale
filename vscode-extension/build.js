const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(__dirname, 'python');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'scripts', 'ARGUS'), { recursive: true });
fs.mkdirSync(path.join(target, 'data'), { recursive: true });
for (const file of ['artifact_retrieval.py', 'rationale_sentence_identifier.py', 'rationale_generation.py', 'rationale_sources.py', 'llm_provider.py', 'sentence_splitter.py', 'csv_utils.py', '__init__.py']) {
  fs.copyFileSync(path.join(root, 'scripts', 'ARGUS', file), path.join(target, 'scripts', 'ARGUS', file));
}
for (const file of ['selection_synthesis.py', 'runner.py', 'cli_selftest.py']) {
  fs.copyFileSync(path.join(__dirname, 'scripts', file), path.join(target, 'scripts', 'ARGUS', file));
}
for (const file of ['AnnotationCodebook.csv', 'CIPromptTemplate.csv', 'CGPromptTemplate.csv']) {
  fs.copyFileSync(path.join(root, 'data', file), path.join(target, 'data', file));
}
for (const file of ['pyproject.toml', 'uv.lock']) {
  fs.copyFileSync(path.join(__dirname, 'backend', file), path.join(target, file));
}
