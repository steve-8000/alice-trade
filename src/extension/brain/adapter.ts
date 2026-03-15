import { tool } from 'ai';
import { z } from 'zod';
import type { Brain } from './Brain';

/**
 * Create brain AI tools (cognition + emotion)
 *
 * Tools:
 * - brainRead: Read cognitive state (frontal lobe, emotion, log)
 * - brainUpdate: Update cognitive state (frontal lobe, emotion)
 */
export function createBrainTools(brain: Brain) {
  return {
    brainRead: tool({
      description: `Read your cognitive state: frontal lobe memory, current emotion, and recent brain changes.

- "all": Returns frontal lobe, emotion, and recent log entries
- "frontalLobe": Your self-assessment and notes from last round (market view, predictions, reminders)
- "emotion": Current emotional state and recent emotion changes
- "log": Brain commit history — timeline of all cognitive state changes`,
      inputSchema: z.object({
        include: z
          .enum(['all', 'frontalLobe', 'emotion', 'log'])
          .optional()
          .default('all')
          .describe('What to read: all, frontalLobe, emotion, or log'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(5)
          .describe('Number of recent log entries to return (default: 5)'),
      }),
      execute: async ({ include, limit }) => {
        switch (include) {
          case 'frontalLobe':
            return { frontalLobe: brain.getFrontalLobe() };
          case 'emotion':
            return { emotion: brain.getEmotion() };
          case 'log':
            return { log: brain.log(limit) };
          case 'all':
          default:
            return {
              frontalLobe: brain.getFrontalLobe(),
              emotion: brain.getEmotion(),
              log: brain.log(limit),
            };
        }
      },
    }),

    brainUpdate: tool({
      description: `Update your cognitive state: frontal lobe memory or emotional state.

Frontal lobe: Save your current self-assessment (market view, portfolio health, predictions, reminders). Write 2-5 concise sentences.

Emotion: Record a shift in sentiment (e.g. "fearful", "cautious", "neutral", "confident", "euphoric") with a reason. Creates a permanent brain commit.

You can update both in a single call.`,
      inputSchema: z.object({
        frontalLobe: z
          .string()
          .optional()
          .describe('New frontal lobe content (2-5 sentences, concise but informative)'),
        emotion: z
          .string()
          .optional()
          .describe('New emotional state (e.g. "fearful", "cautious", "neutral", "confident", "euphoric")'),
        reason: z
          .string()
          .optional()
          .describe('Why this emotional shift occurred (required when updating emotion)'),
      }),
      execute: async ({ frontalLobe, emotion, reason }) => {
        const results: Record<string, unknown> = {};

        if (frontalLobe !== undefined) {
          results.frontalLobe = brain.updateFrontalLobe(frontalLobe);
        }

        if (emotion !== undefined) {
          if (!reason) {
            return { error: 'reason is required when updating emotion' };
          }
          results.emotion = brain.updateEmotion(emotion, reason);
        }

        if (Object.keys(results).length === 0) {
          return { error: 'Provide at least one of frontalLobe or emotion to update' };
        }

        return results;
      },
    }),
  };
}
