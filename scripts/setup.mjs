#!/usr/bin/env node
/**
 * One-command setup: `npm run setup`
 *
 * Written for teammates who have never used a terminal for much. It installs
 * everything, creates the Python environment, and copies the .env template —
 * and if a step fails it says which one and what to do about it, rather than
 * dumping a stack trace.
 *
 * Safe to re-run. Nothing here overwrites an existing .env.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const venv = join(root, 'ml-svc', '.venv');
const venvPython = join(venv, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');

let stepNo = 0;
const total = 6;

function say(msg) {
  console.log(msg);
}
function step(title) {
  stepNo += 1;
  console.log(`\n\x1b[1m[${stepNo}/${total}] ${title}\x1b[0m`);
}
function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
}

function fail(what, advice) {
  console.error(`\n\x1b[31m✗ ${what}\x1b[0m`);
  console.error(`  ${advice}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- checks */
step('Checking that Node and Python are installed');

try {
  const node = execSync('node --version').toString().trim();
  const major = Number(node.replace('v', '').split('.')[0]);
  say(`  Node ${node}`);
  if (major < 20) fail(`Node ${node} is too old`, 'Install Node 20 or newer from https://nodejs.org');
} catch {
  fail('Node is not installed', 'Install it from https://nodejs.org (pick the LTS version), then run this again.');
}

// Windows ships a fake "python" that opens the Microsoft Store. Ask for the
// version rather than trusting that the command merely exists.
let pythonCmd = null;
for (const candidate of isWindows ? ['python', 'py -3'] : ['python3', 'python']) {
  try {
    const out = execSync(`${candidate} --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (/Python 3\.(1[0-9]|[89])/.test(out)) {
      pythonCmd = candidate;
      say(`  ${out}`);
      break;
    }
  } catch {
    /* try the next candidate */
  }
}
if (!pythonCmd) {
  fail(
    'Python 3.9+ was not found',
    'Install it from https://www.python.org/downloads/ and TICK "Add python.exe to PATH" during install.\n' +
      '  Close and reopen your terminal afterwards, then run this again.'
  );
}

/* --------------------------------------------------------- js dependencies */
step('Installing JavaScript packages (this takes a few minutes)');
for (const dir of ['.', 'client', 'server']) {
  say(`  → ${dir === '.' ? 'root' : dir}`);
  try {
    run('npm install --no-fund --no-audit', { cwd: join(root, dir) });
  } catch {
    fail(`npm install failed in ${dir}`, 'Check your internet connection and run `npm run setup` again.');
  }
}

/* ------------------------------------------------------- python environment */
step('Creating the Python environment for the AI model');
if (existsSync(venvPython)) {
  say('  already exists — skipping');
} else {
  try {
    run(`${pythonCmd} -m venv "${venv}"`);
  } catch {
    fail('Could not create the Python environment', 'Make sure Python 3.9+ is installed and on your PATH.');
  }
}

step('Installing PyTorch (large download, be patient)');
try {
  // The default PyTorch wheel pulls ~2.5GB of CUDA drivers we do not need.
  // The CPU index is a fraction of the size and runs fine for a model this small.
  run(`"${venvPython}" -m pip install --quiet --upgrade pip`);
  run(`"${venvPython}" -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu`);
  run(`"${venvPython}" -m pip install --quiet -r "${join(root, 'ml-svc', 'requirements.txt')}"`);
} catch {
  fail('Installing Python packages failed', 'Check your internet connection and run `npm run setup` again.');
}

/* ------------------------------------------------------------------- config */
step('Setting up the configuration file');
const envPath = join(root, 'server', '.env');
const envExample = join(root, 'server', '.env.example');
let envIsNew = false;
if (existsSync(envPath)) {
  say('  server/.env already exists — leaving it untouched');
} else {
  copyFileSync(envExample, envPath);
  envIsNew = true;
  say('  created server/.env from the template');
}

mkdirSync(join(root, 'ml-svc', 'models'), { recursive: true });

/* -------------------------------------------------------------------- done */
step('Done');

console.log(`
\x1b[32m✓ Setup complete.\x1b[0m
`);

if (envIsNew) {
  console.log(`\x1b[33mBEFORE YOU CAN RUN IT, you need the keys.\x1b[0m

  Open  server/.env  and fill in these four values:

    MONGODB_URI=              (the database)
    GEMINI_API_KEY=           (reads what the patient typed)
    CLOUDINARY_CLOUD_NAME=    (stores photos)
    CLOUDINARY_API_KEY=
    CLOUDINARY_API_SECRET=

  Ask your team lead for these. They are deliberately NOT in the repository —
  keys must never be committed to GitHub.

  No keys yet? The app still runs. Set  GEMINI_MOCK=true  and it uses built-in
  sample answers instead. You just cannot save anything without MONGODB_URI.
`);
}

console.log(`Next, run these three commands in order:

  npm run train     build the AI model      (about 1 minute)
  npm run seed      create the test data    (a few seconds)
  npm run dev       start the app

Then open  http://localhost:5173  in your browser.
`);
