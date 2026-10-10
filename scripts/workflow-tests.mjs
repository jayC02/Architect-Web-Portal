import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const files = process.argv.includes('--all')
  ? fs.readdirSync('tests').filter(name => name.endsWith('.test.ts') && !['workflow-database.test.ts', 'workflow-inline-batch.test.ts'].includes(name)).map(name => `tests/${name}`)
  : [...new Set(['test:security','test:addresses','test:fees','test:state-model','test:orchestration'].flatMap(key => packageJson.scripts[key].split(' && ').map(command => command.replace(/^tsx /, ''))))];
const results = [];
fs.mkdirSync('output/workflow/regression', { recursive: true });
for (const file of files) {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', file], { encoding: 'utf8', env: process.env });
  const name = file.split('/').at(-1);
  fs.writeFileSync(`output/workflow/regression/${name}.log`, result.stdout + result.stderr);
  const evidence = { file, passed: result.status === 0 };
  // A failing unchanged check is classified against the archived starting
  // commit. This never rewrites a failing assertion or customer data.
  if (result.status !== 0 && fs.existsSync(`output/workflow/baseline-app/${file}`)) {
    const baseline = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), file], { cwd: 'output/workflow/baseline-app', encoding: 'utf8', env: process.env });
    fs.writeFileSync(`output/workflow/regression/baseline-${name}.log`, baseline.stdout + baseline.stderr);
    evidence.baselinePassed = baseline.status === 0;
  }
  results.push(evidence);
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${file}`);
}
fs.writeFileSync('output/workflow/regression/results.json', JSON.stringify(results, null, 2));
process.exitCode = results.every(result => result.passed) ? 0 : 1;
