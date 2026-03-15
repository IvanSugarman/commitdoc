import test from 'node:test';
import assert from 'node:assert/strict';
import {allowsGitExecution, formatHelpText, resolveCliCommand} from '../dist/commands.js';

test('resolveCliCommand parses brief command', () => {
  const result = resolveCliCommand(['brief', 'cr-description']);
  assert.deepEqual(result, {kind: 'interactive', initialBriefType: 'cr-description'});
});

test('resolveCliCommand parses commit command', () => {
  const result = resolveCliCommand(['commit']);
  assert.deepEqual(result, {kind: 'interactive', initialBriefType: 'commit'});
});

test('allowsGitExecution only enables commit flow', () => {
  assert.equal(allowsGitExecution('commit'), true);
  assert.equal(allowsGitExecution('commit-title'), false);
  assert.equal(allowsGitExecution('commit-summary'), false);
  assert.equal(allowsGitExecution('cr-description'), false);
});

test('formatHelpText includes brief commands', () => {
  const help = formatHelpText();
  assert.match(help, /gai brief <type>/);
  assert.match(help, /gai commit/);
  assert.match(help, /mixed workspace/);
});
