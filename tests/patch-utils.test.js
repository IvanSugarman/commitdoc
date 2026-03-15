import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatchLineStats,
  formatNameStatusLine,
  mergeNameStatusOutputs,
  optimizeRenameOnlyPatches,
  parseChangedFiles,
  splitPatchByFile
} from '../dist/change-analysis/patch-utils.js';

test('parseChangedFiles handles rename entries', () => {
  const result = parseChangedFiles('R100\told.ts\tnew.ts');
  assert.deepEqual(result, [{status: 'R100', path: 'new.ts', oldPath: 'old.ts'}]);
});

test('formatNameStatusLine preserves rename shape', () => {
  const line = formatNameStatusLine({status: 'R100', oldPath: 'old.ts', path: 'new.ts'});
  assert.equal(line, 'R100\told.ts\tnew.ts');
});

test('mergeNameStatusOutputs merges duplicate file entries', () => {
  const merged = mergeNameStatusOutputs(['M\tsrc/a.ts', 'A\tsrc/new.ts', 'M\tsrc/a.ts']);
  assert.equal(merged, 'M\tsrc/a.ts\nA\tsrc/new.ts');
});

test('splitPatchByFile and buildPatchLineStats compute line stats', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    '-const a = 1;',
    '+const a = 2;',
    '+const b = 3;'
  ].join('\n');

  const patches = splitPatchByFile(patch);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, 'src/a.ts');

  const stats = buildPatchLineStats(patches);
  assert.deepEqual(stats.get('src/a.ts'), {added: 2, removed: 1, total: 3});
});

test('optimizeRenameOnlyPatches compresses pure rename patches', () => {
  const optimized = optimizeRenameOnlyPatches([
    {
      path: 'new.ts',
      content: [
        'diff --git a/old.ts b/new.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to new.ts'
      ].join('\n')
    }
  ]);

  assert.match(optimized[0].content, /rename only: old\.ts -> new\.ts/);
});
