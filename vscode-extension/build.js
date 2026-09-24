const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(__dirname, 'python');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'scripts', 'ARGUS'), { recursive: true });
fs.mkdirSync(path.join(target, 'data'), { recursive: true });
for (const file of ['artifact_retrieval.py', 'rationale_sentence_identifier.py', 'rationale_generation.py', 'llm_provider.py', 'csv_utils.py', '__init__.py']) {
  fs.copyFileSync(path.join(root, 'scripts', 'ARGUS', file), path.join(target, 'scripts', 'ARGUS', file));
}
for (const file of ['AnnotationCodebook.csv', 'CIPromptTemplate.csv', 'CGPromptTemplate.csv']) {
  fs.copyFileSync(path.join(root, 'data', file), path.join(target, 'data', file));
}
fs.copyFileSync(path.join(root, 'requirements-extension.txt'), path.join(target, 'requirements.txt'));
