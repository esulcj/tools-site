/* markdown.js — Simple regex-based markdown-to-HTML converter (ES5) */

var Markdown = (function() {
  'use strict';

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function convert(md) {
    if (!md) return '';

    var lines = md.split('\n');
    var html = [];
    var inList = false;
    var inCodeBlock = false;
    var codeLines = [];
    var inTable = false;
    var tableRows = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Fenced code blocks
      if (line.match(/^```/)) {
        if (inCodeBlock) {
          html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
          codeLines = [];
          inCodeBlock = false;
        } else {
          if (inList) { html.push('</ul>'); inList = false; }
          if (inTable) { flushTable(); }
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Close list if line is not a list item
      if (inList && !line.match(/^\s*[-*]\s/)) {
        html.push('</ul>');
        inList = false;
      }

      // Table detection
      if (line.match(/^\|/)) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        // Skip separator rows
        if (line.match(/^\|[\s-:|]+\|$/)) continue;
        tableRows.push(line);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Horizontal rule
      if (line.match(/^---+\s*$/)) {
        html.push('<hr>');
        continue;
      }

      // Headings
      var hMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (hMatch) {
        var level = hMatch[1].length;
        var text = inline(hMatch[2]);
        var id = slugify(hMatch[2]);
        html.push('<h' + level + ' id="' + id + '">' + text + '</h' + level + '>');
        continue;
      }

      // Blockquote
      if (line.match(/^>\s/)) {
        html.push('<blockquote>' + inline(line.replace(/^>\s*/, '')) + '</blockquote>');
        continue;
      }

      // List items
      var liMatch = line.match(/^\s*[-*]\s+(.*)/);
      if (liMatch) {
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push('<li>' + inline(liMatch[1]) + '</li>');
        continue;
      }

      // Numbered list
      var olMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
      if (olMatch) {
        // Simple: treat as paragraph with number styling
        html.push('<p class="list-item"><strong>' + olMatch[1] + '.</strong> ' + inline(olMatch[2]) + '</p>');
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        continue;
      }

      // Paragraph
      html.push('<p>' + inline(line) + '</p>');
    }

    if (inList) html.push('</ul>');
    if (inCodeBlock) {
      html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    }
    if (inTable) flushTable();

    function flushTable() {
      if (tableRows.length === 0) { inTable = false; return; }
      var t = '<table><thead><tr>';
      var headerCells = tableRows[0].split('|').filter(function(c) { return c.trim(); });
      headerCells.forEach(function(c) { t += '<th>' + inline(c.trim()) + '</th>'; });
      t += '</tr></thead>';
      if (tableRows.length > 1) {
        t += '<tbody>';
        for (var r = 1; r < tableRows.length; r++) {
          t += '<tr>';
          var cells = tableRows[r].split('|').filter(function(c) { return c.trim(); });
          cells.forEach(function(c) { t += '<td>' + inline(c.trim()) + '</td>'; });
          t += '</tr>';
        }
        t += '</tbody>';
      }
      t += '</table>';
      html.push(t);
      tableRows = [];
      inTable = false;
    }

    return html.join('\n');
  }

  function inline(text) {
    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return text;
  }

  function slugify(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function extractHeadings(md) {
    var headings = [];
    var lines = md.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(#{2,3})\s+(.+)/);
      if (m) {
        headings.push({
          level: m[1].length,
          text: m[2].replace(/\*\*/g, ''),
          id: slugify(m[2])
        });
      }
    }
    return headings;
  }

  return {
    convert: convert,
    extractHeadings: extractHeadings,
    escapeHtml: escapeHtml
  };
})();
