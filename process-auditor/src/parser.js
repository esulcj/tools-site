import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Stream-parse a .jsonl session file, yielding parsed line objects.
 * @param {string} filePath
 * @returns {AsyncGenerator<object>}
 */
export async function* parseSession(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines
    }
  }
}

/**
 * Extract text content from a message entry.
 */
export function getMessageText(entry) {
  const msg = entry.message;
  if (!msg || !msg.content) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
}

/**
 * Extract sender_id from the conversation info metadata in user messages.
 */
export function getSenderId(entry) {
  const text = getMessageText(entry);
  const match = text.match(/"sender_id":\s*"(\d+)"/);
  return match ? match[1] : null;
}

/**
 * Extract tool calls from an assistant message.
 */
export function getToolCalls(entry) {
  const msg = entry.message;
  if (!msg || !Array.isArray(msg.content)) return [];
  return msg.content.filter(b => b.type === 'tool_use' || b.type === 'toolCall');
}

/**
 * Check if an entry is a sessions_spawn tool call and extract details.
 */
export function getSpawnInfo(toolCall) {
  const name = toolCall.name || '';
  if (name !== 'sessions_spawn') return null;
  const input = toolCall.input || {};
  return {
    task: input.task || '',
    model: input.model || '',
    label: input.label || '',
    runtime: input.runtime || 'subagent',
  };
}

/**
 * Check if an entry contains a message send (Discord post).
 */
export function isDiscordSend(entry) {
  const calls = getToolCalls(entry);
  return calls.some(c => {
    const name = c.name || '';
    const input = c.input || {};
    return name === 'message' && input.action === 'send';
  });
}
