/* app.js — Minimal client-side router (ES5) */

(function() {
  'use strict';

  var appEl = document.getElementById('app');
  if (!appEl) return;

  var path = window.location.pathname;

  // Dashboard: show tool cards
  if (path === '/' || path === '/index.html') {
    loadDashboard();
  } else {
    showComingSoon(path);
  }

  function loadDashboard() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/tools.json');
    xhr.onload = function() {
      if (xhr.status === 200) {
        var tools = JSON.parse(xhr.responseText);
        renderDashboard(tools);
      }
    };
    xhr.send();
  }

  function renderDashboard(tools) {
    var html = '<h1>Tycho Tools</h1>' +
      '<p class="subtitle">Internal tools and documentation hub</p>' +
      '<div class="card-grid">';

    tools.forEach(function(tool) {
      var isExternal = tool.url.indexOf('http') === 0;
      var targetAttr = isExternal ? ' target="_blank" rel="noopener"' : '';
      var badgeClass = 'badge badge-' + tool.status;

      html += '<a href="' + tool.url + '" class="card"' + targetAttr + '>' +
        '<div class="card-header">' +
          '<span class="card-title">' + escapeHtml(tool.name) + '</span>' +
          '<span class="' + badgeClass + '">' + escapeHtml(tool.status) + '</span>' +
        '</div>' +
        '<p class="card-description">' + escapeHtml(tool.description) + '</p>' +
      '</a>';
    });

    html += '</div>';
    appEl.innerHTML = html;
  }

  function showComingSoon(pagePath) {
    var name = pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, ' > ');
    if (!name) name = 'Page';
    // Capitalize first letter of each segment
    name = name.split(' > ').map(function(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }).join(' > ');

    appEl.innerHTML = '<div class="coming-soon">' +
      '<h2>' + escapeHtml(name) + '</h2>' +
      '<p>Coming soon</p>' +
    '</div>';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
