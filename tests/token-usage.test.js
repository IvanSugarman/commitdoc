import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTokenUsage, normalizeTokenUsage} from '../dist/providers/openai-compatible.js';

test('normalizeTokenUsage maps provider usage fields into unified shape', () => {
  assert.deepEqual(
    normalizeTokenUsage({
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
      completion_tokens_details: {
        reasoning_tokens: 12
      }
    }),
    {
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      reasoningTokens: 12
    }
  );

  assert.equal(normalizeTokenUsage(null), null);
});

test('mergeTokenUsage accumulates multi-stage token usage', () => {
  assert.deepEqual(
    mergeTokenUsage(
      {
        promptTokens: 100,
        completionTokens: 30,
        totalTokens: 130,
        reasoningTokens: 8
      },
      {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        reasoningTokens: 0
      }
    ),
    {
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
      reasoningTokens: 8
    }
  );
});
