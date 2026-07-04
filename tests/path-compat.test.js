import assert from 'node:assert/strict';
import test from 'node:test';
import { basenameFromAnyPath } from '../src/utils/path.js';

test('basenameFromAnyPath handles POSIX paths', () => {
  assert.equal(
    basenameFromAnyPath('/Users/tobey/project/social-profiler-public/output/Jane_Doe.html'),
    'Jane_Doe.html'
  );
});

test('basenameFromAnyPath handles Windows paths', () => {
  assert.equal(
    basenameFromAnyPath('C:\\Users\\Ada\\social-profiler\\output\\Jane_Doe.html'),
    'Jane_Doe.html'
  );
});
