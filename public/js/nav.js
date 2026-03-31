/* nav.js — Navigation manifest rendering (ES5) */

(function() {
  'use strict';

  function fetchManifest(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/manifest.json');
    xhr.onload = function() {
      if (xhr.status === 200) {
        callback(JSON.parse(xhr.responseText));
      }
    };
    xhr.send();
  }

  function renderNav(manifest) {
    var navList = document.getElementById('nav-list');
    if (!navList) return;

    var currentPath = window.location.pathname;

    manifest.sections.forEach(function(section) {
      var li = document.createElement('li');
      li.className = 'nav-item';

      var a = document.createElement('a');
      a.textContent = section.title;

      if (section.external) {
        a.href = section.external;
        a.target = '_blank';
        a.rel = 'noopener';
        var icon = document.createElement('span');
        icon.className = 'external-icon';
        icon.textContent = '\u2197';
        a.appendChild(icon);
      } else {
        a.href = section.path;
      }

      // Active state
      if (!section.external && isActive(currentPath, section.path)) {
        li.className += ' active';
      }

      li.appendChild(a);

      // Children
      if (section.children && section.children.length > 0) {
        li.className += ' has-children';

        var ul = document.createElement('ul');
        ul.className = 'nav-children';

        var hasActiveChild = false;

        section.children.forEach(function(child) {
          var childLi = document.createElement('li');
          childLi.className = 'nav-item';

          var childA = document.createElement('a');
          childA.textContent = child.title;
          childA.href = child.path;

          if (isActive(currentPath, child.path)) {
            childLi.className += ' active';
            hasActiveChild = true;
          }

          childLi.appendChild(childA);
          ul.appendChild(childLi);
        });

        li.appendChild(ul);

        // Expand if active child or parent is active
        if (hasActiveChild || isActive(currentPath, section.path)) {
          li.className += ' expanded';
        }

        // Toggle on click
        a.addEventListener('click', function(e) {
          if (section.children.length > 0 && !section.external) {
            e.preventDefault();
            if (li.className.indexOf('expanded') > -1) {
              li.className = li.className.replace(' expanded', '');
            } else {
              li.className += ' expanded';
            }
          }
        });
      }

      navList.appendChild(li);
    });
  }

  function isActive(currentPath, sectionPath) {
    if (sectionPath === '/') {
      return currentPath === '/' || currentPath === '/index.html';
    }
    return currentPath.indexOf(sectionPath) === 0;
  }

  function setupHamburger() {
    var btn = document.getElementById('hamburger');
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');

    if (!btn || !sidebar) return;

    btn.addEventListener('click', function() {
      sidebar.className = sidebar.className.indexOf('open') > -1
        ? sidebar.className.replace(' open', '')
        : sidebar.className + ' open';
      if (overlay) {
        overlay.className = overlay.className.indexOf('open') > -1
          ? overlay.className.replace(' open', '')
          : overlay.className + ' open';
      }
    });

    if (overlay) {
      overlay.addEventListener('click', function() {
        sidebar.className = sidebar.className.replace(' open', '');
        overlay.className = overlay.className.replace(' open', '');
      });
    }
  }

  // Initialize
  fetchManifest(function(manifest) {
    renderNav(manifest);
  });
  setupHamburger();

  // Expose for app.js
  window.TychoNav = {
    fetchManifest: fetchManifest,
    renderNav: renderNav
  };
})();
