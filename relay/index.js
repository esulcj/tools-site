#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const command = args[0];
const positionalArgs = args.filter(a => !a.startsWith('--'));
const jsonMode = args.includes('--json');

const bold = s => `\x1b[1m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

function usage() {
  console.log(`
${bold('relay')} — Last-mile formatting & delivery prep for sub-agent output

${bold('Commands:')}
  ${cyan('format')} <file> --for <channel>        Format markdown for channel (discord|signal|whatsapp)
  ${cyan('deliver')} <file> --channel <ch> [--target <id>]  Prepare chunked delivery
  ${cyan('pdf')} <file> --output <path>            Convert markdown to PDF
  ${cyan('extract')} <file> [--json]               Extract actionable content
  ${cyan('check')} <file> [--channel <ch>]         Pre-delivery check

${bold('Flags:')}
  --for <channel>     Target channel for format
  --channel <channel> Target channel for deliver/check
  --target <id>       Target channel/user ID
  --output <file>     Output file path
  --json              JSON output
`);
}

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function readFile(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(red(`File not found: ${resolved}`));
    process.exit(2);
  }
  return readFileSync(resolved, 'utf-8');
}

// ─── Formatting ───

function convertTablesToLists(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    // Detect table: line with | separators
    if (/^\|(.+\|)+\s*$/.test(lines[i])) {
      const tableLines = [];
      while (i < lines.length && /^\|(.+\|)+\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse: first line = headers, skip separator, rest = rows
      const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
      const dataRows = tableLines.slice(2); // skip header + separator
      for (const row of dataRows) {
        const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
        const parts = headers.map((h, idx) => `${h}: ${cells[idx] || ''}`).join(', ');
        result.push(`• ${parts}`);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

function splitForDiscord(text, maxLen = 2000) {
  if (text.length <= maxLen) return [text];
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    
    // Check if we're inside a code block at the cut point
    let cutAt = maxLen;
    const segment = remaining.slice(0, cutAt);
    
    // Count code block markers (```) in segment
    const codeBlockMarkers = (segment.match(/```/g) || []).length;
    const insideCodeBlock = codeBlockMarkers % 2 === 1;
    
    if (insideCodeBlock) {
      // Find the last ``` before cutAt and cut before it
      const lastOpen = segment.lastIndexOf('```');
      if (lastOpen > 200) {
        cutAt = lastOpen;
      }
    }
    
    // Try to cut at a newline boundary
    const lastNewline = remaining.lastIndexOf('\n', cutAt);
    if (lastNewline > cutAt * 0.5) {
      cutAt = lastNewline + 1;
    }
    
    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }
  
  return chunks;
}

function formatDiscord(text) {
  // Convert tables to bullet lists
  text = convertTablesToLists(text);
  // Wrap URLs in <> (not already wrapped, not in code blocks)
  text = text.replace(/(?<!<)(https?:\/\/[^\s>)\]]+)/g, '<$1>');
  // Replace - bullets with •
  text = text.replace(/^(\s*)- /gm, '$1• ');
  return text;
}

function formatSignal(text) {
  // Strip bold/italic markers
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/_(.+?)_/g, '$1');
  text = text.replace(/~~(.+?)~~/g, '$1');
  // Strip headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Convert tables to bullet lists
  text = convertTablesToLists(text);
  // Code blocks → plain text
  text = text.replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '').replace(/```/g, ''));
  // Inline code
  text = text.replace(/`([^`]+)`/g, '$1');
  // Put links on their own line
  text = text.replace(/([^\n])(https?:\/\/[^\s]+)/g, '$1\n$2');
  return text;
}

function formatWhatsApp(text) {
  // Bold: ** → *
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Strip italic underscores (WhatsApp uses _ for italic natively, keep those)
  // Code blocks → plain text
  text = text.replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '').replace(/```/g, ''));
  text = text.replace(/`([^`]+)`/g, '$1');
  // Strip headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Links on their own line
  text = text.replace(/([^\n])(https?:\/\/[^\s]+)/g, '$1\n$2');
  return text;
}

function formatForChannel(text, channel) {
  switch (channel) {
    case 'discord': return formatDiscord(text);
    case 'signal': return formatSignal(text);
    case 'whatsapp': return formatWhatsApp(text);
    default:
      console.error(red(`Unknown channel: ${channel}. Use: discord, signal, whatsapp`));
      process.exit(1);
  }
}

// ─── Commands ───

function cmdFormat() {
  const file = positionalArgs[1];
  const channel = getFlag('for');
  const output = getFlag('output');
  if (!file || !channel) {
    console.error(red('Usage: relay format <file> --for <channel>'));
    process.exit(1);
  }
  const text = readFile(file);
  const formatted = formatForChannel(text, channel);
  if (output) {
    writeFileSync(resolve(output), formatted, 'utf-8');
    console.error(green(`Written to ${output}`));
  } else {
    process.stdout.write(formatted);
  }
}

function cmdDeliver() {
  const file = positionalArgs[1];
  const channel = getFlag('channel');
  const target = getFlag('target') || 'unspecified';
  if (!file || !channel) {
    console.error(red('Usage: relay deliver <file> --channel <channel> [--target <id>]'));
    process.exit(1);
  }
  const text = readFile(file);
  const formatted = formatForChannel(text, channel);
  
  const maxLen = channel === 'discord' ? 2000 : Infinity;
  const chunks = maxLen < Infinity ? splitForDiscord(formatted, maxLen) : [formatted];
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`--- CHUNK ${i + 1}/${chunks.length} (channel: ${channel}, target: ${target}) ---`);
    console.log(chunks[i]);
    if (i < chunks.length - 1) console.log('---SPLIT---');
  }
}

function cmdPdf() {
  const file = positionalArgs[1];
  const output = getFlag('output');
  if (!file || !output) {
    console.error(red('Usage: relay pdf <file> --output <path>'));
    process.exit(1);
  }
  const text = readFile(file);
  const resolvedFile = resolve(file);
  const resolvedOutput = resolve(output);
  
  // Check for pandoc
  let hasPandoc = false;
  try {
    execSync('which pandoc', { stdio: 'pipe' });
    hasPandoc = true;
  } catch {}
  
  if (hasPandoc) {
    // Try with wkhtmltopdf first, then default
    try {
      execSync(`pandoc "${resolvedFile}" -o "${resolvedOutput}" --pdf-engine=wkhtmltopdf`, { stdio: 'pipe' });
      console.log(green(`PDF created: ${resolvedOutput}`));
      return;
    } catch {}
    try {
      execSync(`pandoc "${resolvedFile}" -o "${resolvedOutput}"`, { stdio: 'pipe' });
      console.log(green(`PDF created: ${resolvedOutput}`));
      return;
    } catch (e) {
      console.error(yellow(`Pandoc failed: ${e.message}`));
    }
  }
  
  // Fallback: generate HTML
  const htmlOutput = resolvedOutput.replace(/\.pdf$/, '.html');
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; }
code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
pre { background: #f4f4f4; padding: 1em; overflow-x: auto; border-radius: 4px; }
h1,h2,h3 { margin-top: 1.5em; }
</style></head><body>
${markdownToHtml(text)}
</body></html>`;
  writeFileSync(htmlOutput, html, 'utf-8');
  console.log(yellow(`Pandoc not available. HTML version saved: ${htmlOutput}`));
  console.log(dim('Install pandoc for true PDF output: brew install pandoc'));
}

function markdownToHtml(md) {
  let html = md;
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${escHtml(code.trimEnd())}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold/italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Bare URLs
  html = html.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  // Paragraphs (simple: double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cmdExtract() {
  const file = positionalArgs[1];
  if (!file) {
    console.error(red('Usage: relay extract <file> [--json]'));
    process.exit(1);
  }
  const text = readFile(file);
  const lines = text.split('\n');
  
  // URLs
  const urls = [...new Set((text.match(/https?:\/\/[^\s)>\]]+/g) || []).map(u => u.replace(/[.,;:!?)]+$/, '')))];
  
  // File paths (common patterns)
  const pathPatterns = /(?:created|modified|wrote|saved|generated|output).*?(\/[\w./-]+)/gi;
  const paths = [...new Set([...(text.matchAll(pathPatterns))].map(m => m[1]))];
  
  // Key findings
  const findings = lines.filter(l =>
    /^(\*\*|##)/.test(l.trim()) ||
    /\b(recommend|finding|result|conclusion|summary)\b/i.test(l)
  ).map(l => l.trim()).filter(Boolean);
  
  if (jsonMode) {
    console.log(JSON.stringify({ urls, paths, findings }, null, 2));
  } else {
    if (urls.length) {
      console.log(bold('URLs:'));
      urls.forEach(u => console.log(`  ${u}`));
    }
    if (paths.length) {
      console.log(bold('\nFile paths:'));
      paths.forEach(p => console.log(`  ${p}`));
    }
    if (findings.length) {
      console.log(bold('\nKey findings:'));
      findings.forEach(f => console.log(`  ${f}`));
    }
    if (!urls.length && !paths.length && !findings.length) {
      console.log(dim('No actionable content extracted.'));
    }
  }
}

function cmdCheck() {
  const file = positionalArgs[1];
  const channel = getFlag('channel') || 'discord';
  if (!file) {
    console.error(red('Usage: relay check <file> [--channel <ch>]'));
    process.exit(1);
  }
  
  const resolved = resolve(file);
  const issues = [];
  const info = [];
  let ready = true;
  
  if (!existsSync(resolved)) {
    console.log(red('NOT READY: File does not exist'));
    process.exit(1);
  }
  
  const stat = statSync(resolved);
  if (stat.size === 0) {
    console.log(red('NOT READY: File is empty'));
    process.exit(1);
  }
  
  const text = readFileSync(resolved, 'utf-8');
  info.push(`Size: ${text.length} chars`);
  
  // URLs
  const urls = text.match(/https?:\/\/[^\s)>\]]+/g) || [];
  info.push(`URLs found: ${urls.length}`);
  
  // Splitting needed?
  const maxLen = channel === 'discord' ? 2000 : Infinity;
  if (text.length > maxLen) {
    const chunks = splitForDiscord(text, maxLen);
    info.push(`Needs splitting: ${chunks.length} chunks for ${channel}`);
  } else {
    info.push('No splitting needed');
  }
  
  // Sensitive content
  const sensitivePatterns = [
    /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
    /(?:sk-|pk_live_|sk_live_|ghp_|gho_|xoxb-|xoxp-)\S+/g,
    /Bearer\s+\S{20,}/g,
  ];
  
  for (const pat of sensitivePatterns) {
    const matches = text.match(pat);
    if (matches) {
      ready = false;
      issues.push(`⚠️  Potential sensitive content: ${matches.length} pattern(s) detected`);
    }
  }
  
  if (jsonMode) {
    console.log(JSON.stringify({ ready, issues, info }, null, 2));
  } else {
    console.log(ready ? green('READY') : red('NOT READY'));
    info.forEach(i => console.log(`  ${i}`));
    issues.forEach(i => console.log(`  ${i}`));
  }
  
  process.exit(ready ? 0 : 1);
}

// ─── Main ───

switch (command) {
  case 'format': cmdFormat(); break;
  case 'deliver': cmdDeliver(); break;
  case 'pdf': cmdPdf(); break;
  case 'extract': cmdExtract(); break;
  case 'check': cmdCheck(); break;
  case undefined:
  case 'help':
  case '--help':
    usage(); break;
  default:
    console.error(red(`Unknown command: ${command}`));
    usage();
    process.exit(1);
}
