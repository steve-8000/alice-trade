import { tool } from 'ai';
import { z } from 'zod';
import { calculate } from './tools/calculate.tool';

/**
 * Create thinking AI tools (cognition + utility, no data dependency)
 *
 * Tools:
 * - think: Record observations, analysis, and action plans
 * - calculate: Safe mathematical expression evaluation
 * - reportWarning: Report anomalies or unexpected situations
 * - getConfirm: Request user confirmation before actions
 */
export function createThinkingTools() {
  return {
    think: tool({
      description:
        'Record your analysis, observations, and action plans. Use for reasoning about market data, strategies, and decisions.',
      inputSchema: z.object({
        observations: z
          .string()
          .describe('What you observe from data'),
        analysis: z
          .string()
          .optional()
          .describe('What these observations mean'),
        plan: z
          .string()
          .optional()
          .describe('Planned actions based on analysis'),
      }),
      execute: async ({ observations, analysis, plan }) => {
        return {
          recorded: true,
          observations,
          analysis: analysis || null,
          plan: plan || null,
        };
      },
    }),

    calculate: tool({
      description:
        'Perform mathematical calculations with precision. Use this for any arithmetic operations instead of calculating yourself. Supports basic operators: +, -, *, /, (), decimals.',
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            'Mathematical expression to evaluate, e.g. "100 / 50000", "(1000 * 0.1) / 2"',
          ),
      }),
      execute: ({ expression }) => {
        return calculate(expression);
      },
    }),

    reportWarning: tool({
      description:
        'Report a warning when you detect anomalies or unexpected situations in the sandbox. Use this to alert about suspicious data, unexpected PnL, zero prices, or any other concerning conditions.',
      inputSchema: z.object({
        message: z.string().describe('Clear description of the warning'),
        details: z.string().describe('Additional details or context'),
      }),
      execute: async ({ message, details }) => {
        console.warn('\n⚠️  AI REPORTED WARNING:');
        console.warn(`   ${message}`);
        if (details) {
          console.warn('   Details:', details);
        }
        console.warn('');
        return { success: true, message: 'Warning logged' };
      },
    }),

    getConfirm: tool({
      description: `
Request user confirmation before executing an action.

Currently: Automatically approved.
In production environment: Will wait for user approval before proceeding.

Use this when you want to:
- Get approval for risky operations
- Ask for permission before major position changes
- Confirm strategy adjustments with the user

Example use cases:
- "I want to open a 10x leveraged position on BTC"
- "Should I close all positions due to negative market sentiment?"
- "Planning to switch from long to short strategy"
      `.trim(),
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            'Clear description of the action you want to perform and why',
          ),
      }),
      execute: async ({ action }) => {
        console.log('\n🤖 AI requesting confirmation:');
        console.log(`   Action: ${action}`);
        console.log('   ✅ Auto-approved');
        console.log('');
        return {
          approved: true,
          message: 'Approved automatically',
        };
      },
    }),
  };
}
