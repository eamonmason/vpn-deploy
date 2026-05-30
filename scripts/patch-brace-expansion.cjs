/**
 * Patches brace-expansion bundled inside aws-cdk-lib to fix GHSA-jxxr-4gwj-5jf2.
 *
 * brace-expansion@5.0.5 is in the bundledDependencies of aws-cdk-lib (via minimatch)
 * and cannot be updated via npm overrides. This postinstall script applies the
 * one-line fix from 5.0.6: adding `&& N.length < max` to the numeric range loop
 * condition to honour the documented `max` DoS guard.
 *
 * Can be removed once aws-cdk-lib ships with brace-expansion >= 5.0.6.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VULNERABLE = 'for (let i = x; test(i, y); i += incr) {';
const PATCHED    = 'for (let i = x; test(i, y) && N.length < max; i += incr) {';

const TARGET_FILES = [
  'node_modules/aws-cdk-lib/node_modules/brace-expansion/dist/commonjs/index.js',
  'node_modules/aws-cdk-lib/node_modules/brace-expansion/dist/esm/index.js',
];

const root = path.resolve(__dirname, '..');
let patchApplied = false;

for (const relPath of TARGET_FILES) {
  const filePath = path.join(root, relPath);
  if (!fs.existsSync(filePath)) continue;

  const src = fs.readFileSync(filePath, 'utf8');
  if (!src.includes(VULNERABLE)) {
    console.log(`[patch-brace-expansion] already patched: ${relPath}`);
    continue;
  }

  fs.writeFileSync(filePath, src.replaceAll(VULNERABLE, PATCHED), 'utf8');
  console.log(`[patch-brace-expansion] applied GHSA-jxxr-4gwj-5jf2 fix: ${relPath}`);
  patchApplied = true;
}

if (!patchApplied) {
  console.log('[patch-brace-expansion] nothing to patch');
}
