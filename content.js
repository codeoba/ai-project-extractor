// AI Project Extractor - Power Developer Suite Content Script (Visual Preview & Architecture Update)

(function () {
  let detectedFiles = [];
  let sidebarEl = null;
  let floatingBtnEl = null;
  let localDirHandle = null;
  let originalFiles = {}; 

  // Settings Cache
  let ignorePatterns = [];
  let customRegexRule = null;

  // Initial UI build
  window.addEventListener('load', () => {
    setTimeout(createUI, 2000);
  });

  // Keep floating button alive during SPA navigations
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(() => {
        if (!document.getElementById('ai-extractor-floating-btn')) {
          createUI();
        }
      }, 2000);
    }
  }).observe(document, { subtree: true, childList: true });

  // Load configuration from storage
  function loadSettings(callback) {
    chrome.storage.local.get({
      ignore_list: '*.log, tmp/*',
      custom_regex: ''
    }, (res) => {
      ignorePatterns = res.ignore_list.split(',').map(p => p.trim()).filter(Boolean);
      if (res.custom_regex.trim()) {
        try {
          customRegexRule = new RegExp(res.custom_regex.trim());
        } catch(e) {
          console.error("Invalid custom regex:", e);
          customRegexRule = null;
        }
      } else {
        customRegexRule = null;
      }
      if (callback) callback();
    });
  }

  // Load directory handle from IndexedDB
  async function loadDirectoryFromDB() {
    try {
      const db = await openDB();
      const handle = await getVal(db, 'dirHandle');
      if (handle) {
        localDirHandle = handle;
        updateSyncUI(true);
      }
    } catch (e) {
      console.log("IndexedDB load failed: ", e);
    }
  }

  // -------------------------------------------------------------------
  // DYNAMIC THEME MATCHING ENGINE
  // -------------------------------------------------------------------

  function applyThemeMatching() {
    const sidebar = document.getElementById('ai-extractor-sidebar');
    if (!sidebar) return;

    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const isDark = isColorDark(bodyBg);

    if (isDark) {
      sidebar.style.setProperty('--extractor-bg', 'rgba(15, 23, 42, 0.96)');
      sidebar.style.setProperty('--extractor-text', '#f1f5f9');
      sidebar.style.setProperty('--extractor-border', 'rgba(255, 255, 255, 0.1)');
      sidebar.style.setProperty('--extractor-sub-bg', 'rgba(30, 41, 59, 0.4)');
      sidebar.style.setProperty('--extractor-btn-bg', '#1e293b');
      sidebar.style.setProperty('--extractor-btn-text', '#cbd5e1');
    } else {
      sidebar.style.setProperty('--extractor-bg', 'rgba(255, 255, 255, 0.96)');
      sidebar.style.setProperty('--extractor-text', '#1e293b');
      sidebar.style.setProperty('--extractor-border', 'rgba(0, 0, 0, 0.1)');
      sidebar.style.setProperty('--extractor-sub-bg', 'rgba(241, 245, 249, 0.8)');
      sidebar.style.setProperty('--extractor-btn-bg', '#e2e8f0');
      sidebar.style.setProperty('--extractor-btn-text', '#334155');
    }

    const host = window.location.hostname;
    if (host.includes('gemini')) {
      sidebar.style.setProperty('--extractor-accent', '#1a73e8'); 
      sidebar.style.setProperty('--extractor-accent-hover', '#1557b0');
    } else if (host.includes('claude')) {
      sidebar.style.setProperty('--extractor-accent', '#d97706'); 
      sidebar.style.setProperty('--extractor-accent-hover', '#b45309');
    } else if (host.includes('deepseek')) {
      sidebar.style.setProperty('--extractor-accent', '#3b82f6'); 
      sidebar.style.setProperty('--extractor-accent-hover', '#1d4ed8');
    } else if (host.includes('chatgpt')) {
      sidebar.style.setProperty('--extractor-accent', '#10b981'); 
      sidebar.style.setProperty('--extractor-accent-hover', '#059669');
    }
  }

  function isColorDark(colorStr) {
    if (!colorStr) return true;
    const rgb = colorStr.match(/\d+/g);
    if (!rgb || rgb.length < 3) return true;
    const r = parseInt(rgb[0]);
    const g = parseInt(rgb[1]);
    const b = parseInt(rgb[2]);
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp < 127.5;
  }

  // -------------------------------------------------------------------
  // PARSING / EXTRACTION LOGIC WITH CUSTOM RULES & IGNORES
  // -------------------------------------------------------------------

  function cleanFilename(text) {
    if (!text) return '';
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^[📁📂📄⚙️🔨💻🐍☕️]+/g, ''); 
    cleaned = cleaned.replace(/^\d+[\.\)]\s*/, ''); 
    cleaned = cleaned.trim();
    return cleaned;
  }

  function wildcardToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
  }

  function shouldIgnoreFile(filename) {
    return ignorePatterns.some(pattern => {
      const regex = wildcardToRegex(pattern);
      return regex.test(filename);
    });
  }

  function getFilenameFromPrecedingSiblings(preElement) {
    let fileRegex = customRegexRule || /(?:📁|\d+[\.\)]|\s)*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/;
    
    let sibling = preElement.previousElementSibling;
    let count = 0;
    while (sibling && count < 3) {
      const text = sibling.innerText || sibling.textContent || '';
      if (text.length < 150 && text.trim().length > 0) {
        const match = text.match(fileRegex);
        if (match) {
          const val = match[1] || match[0];
          if (val.includes('.') || customRegexRule) {
            return cleanFilename(val);
          }
        }
      }
      sibling = sibling.previousElementSibling;
      count++;
    }

    let parent = preElement.parentElement;
    if (parent && parent !== document.body) {
      sibling = parent.previousElementSibling;
      count = 0;
      while (sibling && count < 3) {
        const text = sibling.innerText || sibling.textContent || '';
        if (text.length < 150 && text.trim().length > 0) {
          const match = text.match(fileRegex);
          if (match) {
            const val = match[1] || match[0];
            if (val.includes('.') || customRegexRule) {
              return cleanFilename(val);
            }
          }
        }
        sibling = sibling.previousElementSibling;
        count++;
      }
    }
    return null;
  }

  function getFilenameFromCodeHeader(codeText, langClass) {
    const lines = codeText.split('\n').slice(0, 2);
    const fileRegex = /(?:#|\/\/|\/\*|<!--)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/;
    for (let line of lines) {
      const match = line.match(fileRegex);
      if (match) {
        return cleanFilename(match[1]);
      }
    }
    return null;
  }

  function getExtensionFromLang(langClass) {
    if (!langClass) return 'txt';
    const lang = langClass.replace(/(?:language-|lang-)/, '').toLowerCase();
    const map = {
      'python': 'py', 'py': 'py',
      'javascript': 'js', 'js': 'js', 'node': 'js',
      'typescript': 'ts', 'ts': 'ts',
      'html': 'html', 'htm': 'html',
      'css': 'css',
      'json': 'json',
      'markdown': 'md', 'md': 'md',
      'php': 'php',
      'rust': 'rs', 'rs': 'rs',
      'go': 'go',
      'cpp': 'cpp', 'c++': 'cpp', 'c': 'c',
      'sql': 'sql',
      'bash': 'sh', 'sh': 'sh', 'shell': 'sh',
      'yaml': 'yaml', 'yml': 'yaml'
    };
    return map[lang] || 'txt';
  }

  function scanForCodeBlocks() {
    loadSettings(() => {
      try {
        console.log("AI Extractor: Starting scan...");
        detectedFiles = [];
        const preElements = document.querySelectorAll('pre');

        preElements.forEach((pre, index) => {
          const codeEl = pre.querySelector('code') || pre;
          const codeText = codeEl.innerText || codeEl.textContent || '';
          if (!codeText.trim()) return;

          let langClass = '';
          if (codeEl.classList) {
            codeEl.classList.forEach(cls => {
              if (cls.startsWith('language-') || cls.startsWith('lang-') || cls.startsWith('hljs')) {
                langClass = cls;
              }
            });
          }

          let filename = getFilenameFromPrecedingSiblings(pre);
          if (!filename) {
            filename = getFilenameFromCodeHeader(codeText, langClass);
          }
          if (!filename) {
            const ext = getExtensionFromLang(langClass);
            filename = `file_${index + 1}.${ext}`;
          }

          if (shouldIgnoreFile(filename)) {
            console.log(`AI Extractor: Ignored file matching settings: ${filename}`);
            return;
          }

          let cleanedCode = codeText;
          const lines = codeText.split('\n');
          if (lines.length > 0) {
            const firstLineClean = lines[0].replace(/^[#\/\/\|\*\-\s]+/, '').trim();
            if (firstLineClean.toLowerCase() === filename.toLowerCase()) {
              cleanedCode = lines.slice(1).join('\n');
            }
          }

          const id = `file-${index}`;
          detectedFiles.push({
            id: id,
            name: filename,
            content: cleanedCode,
            lang: langClass ? langClass.replace(/(?:language-|lang-)/, '') : 'text'
          });

          originalFiles[id] = cleanedCode;
        });

        checkAndGenerateSetupScripts();
        renderFileList();
        saveProjectToHistory();
        applyThemeMatching();
      } catch (err) {
        console.error("AI Extractor: Scan failed:", err);
      }
    });
  }

  // -------------------------------------------------------------------
  // RUNTIME SETUP SCRIPT GENERATOR
  // -------------------------------------------------------------------

  function checkAndGenerateSetupScripts() {
    const hasPyRequirements = detectedFiles.some(f => f.name.endsWith('requirements.txt'));
    const hasNodePackage = detectedFiles.some(f => f.name.endsWith('package.json'));

    if (detectedFiles.some(f => f.name === 'setup.bat' || f.name === 'setup.sh')) {
      return;
    }

    if (hasPyRequirements) {
      const batContent = `@echo off\necho Setting up Python Virtual Environment...\npython -m venv .venv\ncall .venv\\Scripts\\activate\necho Installing dependencies from requirements.txt...\npip install -r requirements.txt\necho Setup complete! Launching application...\npython main.py\npause\n`;
      const shContent = `#!/bin/bash\necho "Setting up Python Virtual Environment..."\npython3 -m venv .venv\nsource .venv/bin/activate\necho "Installing dependencies from requirements.txt..."\npip install -r requirements.txt\necho "Setup complete! Launching..."\npython3 main.py\n`;
      
      detectedFiles.push({
        id: `setup-bat-${Date.now()}`,
        name: "setup.bat",
        content: batContent,
        lang: "bat"
      });
      detectedFiles.push({
        id: `setup-sh-${Date.now()}`,
        name: "setup.sh",
        content: shContent,
        lang: "bash"
      });
    } else if (hasNodePackage) {
      const batContent = `@echo off\necho Installing Node.js dependencies...\ncall npm install\necho Setup complete! Launching application...\nnpm start\npause\n`;
      const shContent = `#!/bin/bash\necho "Installing Node.js dependencies..."\nnpm install\necho "Setup complete! Launching..."\nnpm start\n`;

      detectedFiles.push({
        id: `setup-bat-${Date.now()}`,
        name: "setup.bat",
        content: batContent,
        lang: "bat"
      });
      detectedFiles.push({
        id: `setup-sh-${Date.now()}`,
        name: "setup.sh",
        content: shContent,
        lang: "bash"
      });
    }
  }

  // -------------------------------------------------------------------
  // TEMPLATE BOILERPLATE INJECTOR
  // -------------------------------------------------------------------

  const TEMPLATES = {
    wordpress: [
      { name: "wp-plugin.php", content: "<?php\n/**\n * Plugin Name: Custom AI Plugin\n * Description: Automatically extracted WordPress Plugin.\n * Version: 1.0\n */\n\nif ( ! defined( 'ABSPATH' ) ) {\n\texit; // Exit if accessed directly.\n}\n" },
      { name: "readme.txt", content: "=== Custom AI Plugin ===\nContributors: AI\nStable tag: 1.0\nLicense: GPLv2\n\n== Description ==\nAn automatically created WordPress plugin." },
      { name: ".gitignore", content: "# Ignore WordPress uploads & logs\nwp-config.php\nwp-content/uploads/\n*.log\n" }
    ],
    nodejs: [
      { name: "package.json", content: "{\n  \"name\": \"ai-bot-project\",\n  \"version\": \"1.0.0\",\n  \"main\": \"index.js\",\n  \"dependencies\": {\n    \"dotenv\": \"^16.0.0\"\n  }\n}" },
      { name: "index.js", content: "require('dotenv').config();\nconsole.log('App successfully launched!');\n" },
      { name: ".env", content: "BOT_TOKEN=YOUR_TOKEN_HERE\nPORT=3000" },
      { name: ".gitignore", content: "node_modules/\n.env\n" }
    ],
    python: [
      { name: "main.py", content: "import os\n\ndef main():\n    print('Hello from Python Project!')\n\nif __name__ == '__main__':\n    main()\n" },
      { name: "requirements.txt", content: "requests>=2.28.0\npython-dotenv>=0.21.0\n" },
      { name: ".gitignore", content: "__pycache__/\n.venv/\nvenv/\n.env\n" }
    ],
    extension: [
      { name: "manifest.json", content: "{\n  \"manifest_version\": 3,\n  \"name\": \"AI Extracted Extension\",\n  \"version\": \"1.0\",\n  \"description\": \"Autogenerated extension\",\n  \"permissions\": [\"activeTab\"],\n  \"background\": {\n    \"service_worker\": \"background.js\"\n  }\n}" },
      { name: "background.js", content: "chrome.runtime.onInstalled.addListener(() => {\n  console.log('Extension ready.');\n});\n" }
    ]
  };

  function injectTemplate(type) {
    const files = TEMPLATES[type];
    if (!files) return;
    files.forEach((file, index) => {
      const id = `tpl-${type}-${index}-${Date.now()}`;
      detectedFiles.push({
        id: id,
        name: file.name,
        content: file.content,
        lang: getExtensionFromLang(file.name)
      });
      originalFiles[id] = ""; 
    });
    checkAndGenerateSetupScripts();
    renderFileList();
    saveProjectToHistory();
  }

  // -------------------------------------------------------------------
  // PERSISTENCE
  // -------------------------------------------------------------------

  function saveProjectToHistory() {
    const projectNameInput = document.getElementById('project-name-input');
    const projectName = projectNameInput.value.trim() || 'ai-project';
    const data = {
      name: projectName,
      files: detectedFiles,
      timestamp: Date.now()
    };

    chrome.storage.local.get({ history: [] }, (result) => {
      let history = result.history;
      history = history.filter(p => p.name !== projectName);
      history.unshift(data);
      if (history.length > 10) history = history.slice(0, 10);
      chrome.storage.local.set({ history: history }, renderHistoryList);
    });
  }

  function renderHistoryList() {
    chrome.storage.local.get({ history: [] }, (result) => {
      const historyListEl = document.getElementById('history-list');
      if (!historyListEl) return;
      historyListEl.innerHTML = '';

      if (result.history.length === 0) {
        historyListEl.innerHTML = `<div class="history-empty">No history.</div>`;
        return;
      }

      result.history.forEach(proj => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="history-item-info">
            <span class="history-name">${proj.name}</span>
            <span class="history-date">${new Date(proj.timestamp).toLocaleTimeString()}</span>
          </div>
          <button class="history-load-btn" title="Load project">📂</button>
        `;
        item.querySelector('.history-load-btn').addEventListener('click', () => {
          document.getElementById('project-name-input').value = proj.name;
          detectedFiles = JSON.parse(JSON.stringify(proj.files)); 
          detectedFiles.forEach(f => {
            originalFiles[f.id] = f.content;
          });
          renderFileList();
        });
        historyListEl.appendChild(item);
      });
    });
  }

  // -------------------------------------------------------------------
  // UI CREATION & INTERFACE
  // -------------------------------------------------------------------

  function createUI() {
    if (document.getElementById('ai-extractor-floating-btn')) return;

    // Create Floating Button
    floatingBtnEl = document.createElement('div');
    floatingBtnEl.id = 'ai-extractor-floating-btn';
    floatingBtnEl.innerHTML = `
      <div class="btn-icon">📁</div>
      <span class="btn-tooltip">Extract Project</span>
    `;
    document.body.appendChild(floatingBtnEl);

    // Create Sidebar
    sidebarEl = document.createElement('div');
    sidebarEl.id = 'ai-extractor-sidebar';
    sidebarEl.innerHTML = `
      <div class="sidebar-header">
        <h3>AI Project Extractor</h3>
        <button id="sidebar-close-btn">&times;</button>
      </div>
      
      <div class="sidebar-actions">
        <button id="scan-btn" class="primary-btn">🔍 Scan</button>
        <button id="export-zip-btn" class="accent-btn" disabled>📦 ZIP</button>
        <button id="show-map-btn" class="accent-btn" disabled>🗺️ Map</button>
      </div>

      <div class="project-info">
        <label for="project-name-input">Project Name:</label>
        <input type="text" id="project-name-input" value="botsales" placeholder="project-name">
      </div>

      <div class="settings-section">
        <div class="section-title collapsible-header" id="settings-toggle">Settings & Filters (Click to Expand) ▾</div>
        <div id="settings-content" class="settings-content hidden">
          <div class="settings-group">
            <label>Ignore List (wildcards, comma separated):</label>
            <input type="text" id="ignore-list-input" placeholder="*.log, tmp/*">
          </div>
          <div class="settings-group">
            <label>Custom Filename Regex (optional):</label>
            <input type="text" id="custom-regex-input" placeholder="📁\\s*([\\w\\-\\.]+\\.\\w+)">
          </div>
          <button id="save-settings-btn" class="sub-btn">Save Settings</button>
        </div>
      </div>

      <div class="sync-section">
        <div class="section-title">Local Folder Sync</div>
        <div class="sync-buttons">
          <button id="link-folder-btn" class="sub-btn">🔗 Link Folder</button>
          <button id="sync-disk-btn" class="sub-btn" disabled>🔄 Sync Disk</button>
        </div>
        <div id="linked-folder-status" class="status-msg">No folder linked.</div>
      </div>

      <div class="git-section">
        <div class="section-title">GitHub Integration</div>
        <div class="git-buttons">
          <button id="git-config-btn" class="sub-btn">⚙️ Config Git</button>
          <button id="git-push-btn" class="sub-btn" disabled>🚀 Push Git</button>
        </div>
      </div>

      <div class="template-section">
        <div class="section-title">Templates</div>
        <div class="template-row">
          <select id="template-select">
            <option value="wordpress">WordPress Plugin</option>
            <option value="nodejs">Node.js Bot</option>
            <option value="python">Python App</option>
            <option value="extension">Chrome Extension</option>
          </select>
          <button id="inject-btn" class="inject-btn">Inject</button>
        </div>
      </div>

      <div class="history-section">
        <div class="section-title collapsible-header" id="history-toggle">Project History ▾</div>
        <div id="history-list" class="history-content hidden"></div>
      </div>

      <div class="file-search-section">
        <input type="text" id="file-search-input" placeholder="🔍 Search file names or contents...">
      </div>

      <div class="file-list-container">
        <div class="section-title">Extracted Files</div>
        <div id="no-files-msg">No files detected yet. Click "Scan Page" to find project code.</div>
        <ul id="file-list" class="file-tree"></ul>
      </div>
      
      <div class="sidebar-footer">
        <span>AI Project Extractor v1.2</span>
      </div>
    `;
    document.body.appendChild(sidebarEl);

    createGitModal();

    // Event Listeners
    floatingBtnEl.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-close-btn').addEventListener('click', toggleSidebar);
    document.getElementById('scan-btn').addEventListener('click', scanForCodeBlocks);
    document.getElementById('export-zip-btn').addEventListener('click', exportAsZip);
    document.getElementById('show-map-btn').addEventListener('click', showArchitectureMapModal);
    
    document.getElementById('link-folder-btn').addEventListener('click', linkLocalDirectory);
    document.getElementById('sync-disk-btn').addEventListener('click', syncToLocalDisk);

    document.getElementById('inject-btn').addEventListener('click', () => {
      const type = document.getElementById('template-select').value;
      injectTemplate(type);
    });

    document.getElementById('git-config-btn').addEventListener('click', openGitModal);
    document.getElementById('git-push-btn').addEventListener('click', pushProjectToGitHub);

    document.getElementById('project-name-input').addEventListener('input', saveProjectToHistory);

    // Collapsible Settings
    document.getElementById('settings-toggle').addEventListener('click', () => {
      const content = document.getElementById('settings-content');
      const header = document.getElementById('settings-toggle');
      content.classList.toggle('hidden');
      header.innerText = content.classList.contains('hidden') ? "Settings & Filters (Click to Expand) ▾" : "Settings & Filters ▴";
    });

    document.getElementById('save-settings-btn').addEventListener('click', () => {
      const ignore = document.getElementById('ignore-list-input').value;
      const regex = document.getElementById('custom-regex-input').value;
      chrome.storage.local.set({ ignore_list: ignore, custom_regex: regex }, () => {
        loadSettings(() => {
          alert("Settings updated!");
          scanForCodeBlocks();
        });
      });
    });

    // Populate Settings UI
    chrome.storage.local.get({ ignore_list: '*.log, tmp/*', custom_regex: '' }, (res) => {
      document.getElementById('ignore-list-input').value = res.ignore_list;
      document.getElementById('custom-regex-input').value = res.custom_regex;
    });

    // Live File List Filter
    document.getElementById('file-search-input').addEventListener('input', renderFileList);

    // Collapsible history section
    document.getElementById('history-toggle').addEventListener('click', () => {
      const historyList = document.getElementById('history-list');
      const header = document.getElementById('history-toggle');
      historyList.classList.toggle('hidden');
      header.innerText = historyList.classList.contains('hidden') ? "Project History ▾" : "Project History ▴";
    });

    // Startup configurations
    loadSettings();
    loadDirectoryFromDB();
    renderHistoryList();
    scanForCodeBlocks();
    checkGitConfig();
    applyThemeMatching();
  }

  function toggleSidebar() {
    sidebarEl.classList.toggle('open');
    applyThemeMatching();
  }

  function renderFileList() {
    const listEl = document.getElementById('file-list');
    const noFilesEl = document.getElementById('no-files-msg');
    const exportBtn = document.getElementById('export-zip-btn');
    const syncBtn = document.getElementById('sync-disk-btn');
    const pushBtn = document.getElementById('git-push-btn');
    const mapBtn = document.getElementById('show-map-btn');
    const searchVal = document.getElementById('file-search-input').value.toLowerCase().trim();

    listEl.innerHTML = '';

    const filteredFiles = detectedFiles.filter(file => {
      if (!searchVal) return true;
      return file.name.toLowerCase().includes(searchVal) || file.content.toLowerCase().includes(searchVal);
    });

    if (filteredFiles.length === 0) {
      noFilesEl.style.display = 'block';
      noFilesEl.innerText = searchVal ? "No matching files found." : "No files detected yet. Click 'Scan Page' to find project code.";
      exportBtn.disabled = true;
      syncBtn.disabled = true;
      pushBtn.disabled = true;
      mapBtn.disabled = true;
      return;
    }

    noFilesEl.style.display = 'none';
    exportBtn.disabled = false;
    mapBtn.disabled = false;
    if (localDirHandle) syncBtn.disabled = false;
    
    chrome.storage.local.get(['github_token', 'github_repo'], (res) => {
      if (res.github_token && res.github_repo) {
        pushBtn.disabled = false;
      }
    });

    filteredFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.innerHTML = `
        <div class="file-item-row">
          <span class="file-icon">📄</span>
          <input type="text" class="file-name-edit" value="${file.name}" data-id="${file.id}">
          <div class="file-item-actions">
            <!-- If HTML file, add instant sandbox run play icon -->
            ${file.name.endsWith('.html') ? '<button class="run-file-btn" title="Run Live Sandbox Preview">▶️</button>' : ''}
            <button class="preview-btn" title="Edit / Diff Code">👁️</button>
            <button class="download-file-btn" title="Download File Alone">📥</button>
            <button class="delete-btn" title="Delete File">&times;</button>
          </div>
        </div>
      `;

      const nameInput = li.querySelector('.file-name-edit');
      nameInput.addEventListener('change', (e) => {
        file.name = e.target.value.trim();
        saveProjectToHistory();
      });

      if (file.name.endsWith('.html')) {
        li.querySelector('.run-file-btn').addEventListener('click', () => {
          showLiveSandboxModal(file);
        });
      }

      li.querySelector('.preview-btn').addEventListener('click', () => {
        showPreviewModal(file);
      });

      li.querySelector('.download-file-btn').addEventListener('click', () => {
        downloadSingleFile(file);
      });

      li.querySelector('.delete-btn').addEventListener('click', () => {
        const idx = detectedFiles.findIndex(f => f.id === file.id);
        if (idx !== -1) {
          detectedFiles.splice(idx, 1);
          renderFileList();
          saveProjectToHistory();
        }
      });

      listEl.appendChild(li);
    });
  }

  // -------------------------------------------------------------------
  // LIVE SANDBOX WEB PREVIEW PREVIEWER
  // -------------------------------------------------------------------

  function showLiveSandboxModal(htmlFile) {
    let modal = document.getElementById('ai-extractor-sandbox-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ai-extractor-sandbox-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-content live-preview-modal">
        <div class="modal-header">
          <h4>Live Sandbox Run: ${htmlFile.name}</h4>
          <button class="sandbox-modal-close">&times;</button>
        </div>
        <div class="modal-body preview-body">
          <iframe id="sandbox-iframe" sandbox="allow-scripts allow-modals"></iframe>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    modal.querySelector('.sandbox-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // Compile self-contained document by inlining CSS and JS
    let compiledHTML = htmlFile.content;

    detectedFiles.forEach(file => {
      if (file.name.endsWith('.css')) {
        const cleanName = file.name.split('/').pop();
        // Replace stylesheet link tags with style elements
        const linkPattern = new RegExp(`<link[^>]*href=["'][^"']*${cleanName}["'][^>]*>`, 'gi');
        compiledHTML = compiledHTML.replace(linkPattern, `<style>${file.content}</style>`);
      } else if (file.name.endsWith('.js')) {
        const cleanName = file.name.split('/').pop();
        // Replace script source links with script tags containing actual code
        const scriptPattern = new RegExp(`<script[^>]*src=["'][^"']*${cleanName}["'][^>]*>\\s*</script>`, 'gi');
        compiledHTML = compiledHTML.replace(scriptPattern, `<script>${file.content}</script>`);
      }
    });

    const iframe = modal.querySelector('#sandbox-iframe');
    iframe.srcdoc = compiledHTML;
  }

  // -------------------------------------------------------------------
  // VISUAL PROJECT ARCHITECTURE DIAGRAM MAPPER
  // -------------------------------------------------------------------

  function showArchitectureMapModal() {
    let modal = document.getElementById('ai-extractor-map-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ai-extractor-map-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-content text-modal architecture-modal">
        <div class="modal-header">
          <h4>Project Architecture Tree</h4>
          <button class="map-modal-close">&times;</button>
        </div>
        <div class="modal-body map-body">
          <div class="architecture-tree-canvas" id="map-tree-canvas"></div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    modal.querySelector('.map-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // Generate Visual Tree Structure
    const canvas = modal.querySelector('#map-tree-canvas');
    canvas.innerHTML = generateVisualTreeHTML();
  }

  function generateVisualTreeHTML() {
    const projectNameInput = document.getElementById('project-name-input');
    const projectName = projectNameInput.value.trim() || 'root';

    // Parse detectedFiles into a tree map
    const tree = { name: projectName, type: 'directory', children: {} };

    detectedFiles.forEach(file => {
      const parts = file.name.split('/');
      let current = tree;
      
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          current.children[part] = { name: part, type: 'file' };
        } else {
          if (!current.children[part]) {
            current.children[part] = { name: part, type: 'directory', children: {} };
          }
          current = current.children[part];
        }
      });
    });

    // Generate nested HTML branches
    function renderNode(node) {
      if (node.type === 'file') {
        return `<div class="tree-node-file">📄 ${node.name}</div>`;
      }
      
      let childrenHTML = '';
      const keys = Object.keys(node.children);
      keys.forEach(key => {
        childrenHTML += `<li>${renderNode(node.children[key])}</li>`;
      });

      return `
        <div class="tree-node-dir">📁 ${node.name}</div>
        ${keys.length > 0 ? `<ul class="tree-branch">${childrenHTML}</ul>` : ''}
      `;
    }

    return `<div class="architecture-visual-wrapper">${renderNode(tree)}</div>`;
  }

  // -------------------------------------------------------------------
  // INDIVIDUAL FILE DOWNLOAD
  // -------------------------------------------------------------------

  function downloadSingleFile(file) {
    try {
      const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.split('/').pop(); 
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Single file download failed: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------
  // CODE EDITOR & DIFF VISUALIZER & LINTER & SEARCH/REPLACE
  // -------------------------------------------------------------------

  function validateCodeSyntax(content, lang) {
    if (!content.trim()) return { ok: true };
    const format = lang.toLowerCase();
    
    if (format === 'json') {
      try {
        JSON.parse(content);
        return { ok: true };
      } catch(e) {
        return { ok: false, message: `JSON syntax error: ${e.message}` };
      }
    }
    
    if (format === 'javascript' || format === 'js') {
      try {
        new Function(content); 
        return { ok: true };
      } catch(e) {
        return { ok: false, message: `JS parsing warning: ${e.message}` };
      }
    }
    
    return { ok: true };
  }

  function generateDiffHTML(originalText, currentText) {
    const originalLines = originalText.split('\n');
    const currentLines = currentText.split('\n');
    let diffHTML = '';
    const maxLength = Math.max(originalLines.length, currentLines.length);

    for (let i = 0; i < maxLength; i++) {
      const orig = originalLines[i] !== undefined ? originalLines[i] : null;
      const curr = currentLines[i] !== undefined ? currentLines[i] : null;

      if (orig === curr) {
        diffHTML += `<div class="diff-line unchanged"><span class="line-number">${i+1}</span> <span class="line-content">${escapeHTML(curr)}</span></div>`;
      } else {
        if (orig !== null) {
          diffHTML += `<div class="diff-line removed"><span class="line-number">-</span> <span class="line-content">${escapeHTML(orig)}</span></div>`;
        }
        if (curr !== null) {
          diffHTML += `<div class="diff-line added"><span class="line-number">+</span> <span class="line-content">${escapeHTML(curr)}</span></div>`;
        }
      }
    }
    return diffHTML;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showPreviewModal(file) {
    let modal = document.getElementById('ai-extractor-preview-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ai-extractor-preview-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title-tabs">
            <button id="tab-editor" class="tab-btn active">✏️ Editor</button>
            <button id="tab-diff" class="tab-btn">⚖️ Diff Viewer</button>
          </div>
          <button class="modal-close">&times;</button>
        </div>
        
        <div class="modal-body">
          <div id="editor-view" class="tab-panel">
            <div class="editor-search-replace-row">
              <input type="text" id="editor-find-input" placeholder="Find text...">
              <input type="text" id="editor-replace-input" placeholder="Replace with...">
              <button id="editor-replace-btn" class="editor-action-btn">Replace All</button>
            </div>
            
            <textarea class="code-preview-area" id="editor-textarea">${file.content}</textarea>
            
            <div id="editor-linter-log" class="linter-log-banner hidden"></div>
          </div>
          <div id="diff-view" class="tab-panel hidden">
            <div class="diff-container" id="diff-container"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="modal-save-btn" class="modal-save-btn primary-btn">Save Changes</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    const textEditor = modal.querySelector('#editor-textarea');
    const linterEl = modal.querySelector('#editor-linter-log');

    const tabEditor = modal.querySelector('#tab-editor');
    const tabDiff = modal.querySelector('#tab-diff');
    const viewEditor = modal.querySelector('#editor-view');
    const viewDiff = modal.querySelector('#diff-view');
    const diffContainer = modal.querySelector('#diff-container');

    function runLinter() {
      const lint = validateCodeSyntax(textEditor.value, file.name.split('.').pop());
      if (lint.ok) {
        linterEl.classList.add('hidden');
        linterEl.innerText = '';
      } else {
        linterEl.classList.remove('hidden');
        linterEl.innerText = lint.message;
      }
    }
    textEditor.addEventListener('input', runLinter);
    runLinter(); 

    modal.querySelector('#editor-replace-btn').addEventListener('click', () => {
      const findVal = modal.querySelector('#editor-find-input').value;
      const replaceVal = modal.querySelector('#editor-replace-input').value;
      if (!findVal) return;
      const content = textEditor.value;
      const newContent = content.split(findVal).join(replaceVal);
      textEditor.value = newContent;
      runLinter();
    });

    tabEditor.addEventListener('click', () => {
      tabEditor.classList.add('active');
      tabDiff.classList.remove('active');
      viewEditor.classList.remove('hidden');
      viewDiff.classList.add('hidden');
    });

    tabDiff.addEventListener('click', () => {
      tabEditor.classList.remove('active');
      tabDiff.classList.add('active');
      viewEditor.classList.add('hidden');
      viewDiff.classList.remove('hidden');

      const orig = originalFiles[file.id] || "";
      const curr = textEditor.value;
      diffContainer.innerHTML = generateDiffHTML(orig, curr);
    });

    const closeFn = () => { modal.style.display = 'none'; };
    modal.querySelector('.modal-close').addEventListener('click', closeFn);

    modal.querySelector('#modal-save-btn').addEventListener('click', () => {
      file.content = textEditor.value;
      saveProjectToHistory();
      closeFn();
    });
  }

  // -------------------------------------------------------------------
  // DIRECT LOCAL FOLDER SYNC
  // -------------------------------------------------------------------

  async function linkLocalDirectory() {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      localDirHandle = handle;

      const db = await openDB();
      await setVal(db, 'dirHandle', handle);

      updateSyncUI(true);
      document.getElementById('sync-disk-btn').disabled = false;
    } catch (e) {
      console.warn("Folder sync linking rejected:", e);
      document.getElementById('linked-folder-status').innerText = "Linking failed.";
    }
  }

  function updateSyncUI(isLinked) {
    const statusEl = document.getElementById('linked-folder-status');
    const syncBtn = document.getElementById('sync-disk-btn');
    if (isLinked && localDirHandle) {
      statusEl.innerText = `Linked: ${localDirHandle.name} ✓`;
      statusEl.style.color = '#10b981';
      syncBtn.disabled = false;
    } else {
      statusEl.innerText = "No folder linked.";
      statusEl.style.color = '#94a3b8';
      syncBtn.disabled = true;
    }
  }

  async function syncToLocalDisk() {
    if (!localDirHandle || detectedFiles.length === 0) return;
    const syncBtn = document.getElementById('sync-disk-btn');
    const originalText = syncBtn.innerText;
    syncBtn.innerText = "Syncing...";
    syncBtn.disabled = true;

    try {
      const permission = await verifyPermission(localDirHandle, true);
      if (!permission) {
        alert("Writing failed: Permission denied.");
        return;
      }

      for (const file of detectedFiles) {
        const parts = file.name.split('/');
        let currentDir = localDirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
        }
        const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.content);
        await writable.close();
      }

      syncBtn.innerText = "Done! ✓";
      setTimeout(() => {
        syncBtn.innerText = originalText;
        syncBtn.disabled = false;
      }, 2000);

    } catch (err) {
      console.error("Local sync error:", err);
      alert(`Sync failed: ${err.message}`);
      syncBtn.innerText = "Failed ❌";
      setTimeout(() => {
        syncBtn.innerText = originalText;
        syncBtn.disabled = false;
      }, 2000);
    }
  }

  async function verifyPermission(fileHandle, readWrite) {
    const options = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ai_project_extractor_db', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function setVal(db, key, val) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function getVal(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get(key);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------
  // GIT & GITHUB REST API UPLOADER
  // -------------------------------------------------------------------

  function createGitModal() {
    let modal = document.getElementById('ai-extractor-git-modal');
    if (modal) return;

    modal = document.createElement('div');
    modal.id = 'ai-extractor-git-modal';
    modal.innerHTML = `
      <div class="modal-content text-modal">
        <div class="modal-header">
          <h4>Configure GitHub Credentials</h4>
          <button class="git-modal-close">&times;</button>
        </div>
        <div class="modal-body form-body">
          <div class="form-group">
            <label>GitHub Personal Access Token (PAT):</label>
            <input type="password" id="git-token-input" placeholder="ghp_xxxxxxxxxxxx">
            <div class="field-desc">Requires 'repo' permission scope.</div>
          </div>
          <div class="form-group">
            <label>GitHub Username:</label>
            <input type="text" id="git-username-input" placeholder="codeoba">
          </div>
          <div class="form-group">
            <label>Repository Name:</label>
            <input type="text" id="git-repo-input" placeholder="ai-project-extractor">
          </div>
        </div>
        <div class="modal-footer">
          <button id="git-save-btn" class="primary-btn">Save Config</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.git-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    modal.querySelector('#git-save-btn').addEventListener('click', saveGitConfig);
  }

  function openGitModal() {
    const modal = document.getElementById('ai-extractor-git-modal');
    if (!modal) return;

    chrome.storage.local.get(['github_token', 'github_username', 'github_repo'], (res) => {
      document.getElementById('git-token-input').value = res.github_token || '';
      document.getElementById('git-username-input').value = res.github_username || '';
      document.getElementById('git-repo-input').value = res.github_repo || '';
      modal.style.display = 'flex';
    });
  }

  function saveGitConfig() {
    const token = document.getElementById('git-token-input').value.trim();
    const username = document.getElementById('git-username-input').value.trim();
    const repo = document.getElementById('git-repo-input').value.trim();

    if (!token || !username || !repo) {
      alert("Please fill in all config parameters.");
      return;
    }

    chrome.storage.local.set({
      github_token: token,
      github_username: username,
      github_repo: repo
    }, () => {
      document.getElementById('ai-extractor-git-modal').style.display = 'none';
      checkGitConfig();
      renderFileList();
    });
  }

  function checkGitConfig() {
    chrome.storage.local.get(['github_token', 'github_username', 'github_repo'], (res) => {
      const pushBtn = document.getElementById('git-push-btn');
      if (res.github_token && res.github_username && res.github_repo) {
        if (detectedFiles.length > 0) pushBtn.disabled = false;
      } else {
        pushBtn.disabled = true;
      }
    });
  }

  async function pushProjectToGitHub() {
    chrome.storage.local.get(['github_token', 'github_username', 'github_repo'], async (res) => {
      const token = res.github_token;
      const username = res.github_username;
      const repo = res.github_repo;

      if (!token || !username || !repo) {
        alert("Please configure Git settings first.");
        return;
      }

      const pushBtn = document.getElementById('git-push-btn');
      const originalText = pushBtn.innerText;
      pushBtn.innerText = "Pushing...";
      pushBtn.disabled = true;

      try {
        const repoCheck = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
          headers: { 'Authorization': `token ${token}` }
        });

        if (!repoCheck.ok) {
          console.log("GitHub Extractor: Creating new repository...");
          const createRes = await fetch(`https://api.github.com/user/repos`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: repo,
              description: "Autogenerated code extract project created by AI Project Extractor Chrome Extension.",
              auto_init: true
            })
          });

          if (!createRes.ok) {
            throw new Error(`Failed to create repository: ${createRes.statusText}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }

        for (const file of detectedFiles) {
          let sha = null;
          try {
            const checkRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${file.name}`, {
              headers: { 'Authorization': `token ${token}` }
            });
            if (checkRes.ok) {
              const fileData = await checkRes.json();
              sha = fileData.sha;
            }
          } catch (e) {}

          const base64Content = btoa(unescape(encodeURIComponent(file.content)));
          const body = {
            message: `Sync file via AI Extractor: ${file.name}`,
            content: base64Content
          };
          if (sha) body.sha = sha;

          const putRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${file.name}`, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });

          if (!putRes.ok) {
            throw new Error(`GitHub upload failed for: ${file.name}`);
          }
        }

        pushBtn.innerText = "Success! ✓";
        setTimeout(() => {
          pushBtn.innerText = originalText;
          pushBtn.disabled = false;
        }, 2000);

      } catch (err) {
        console.error("Git Push failed:", err);
        alert(`Git Push failed: ${err.message}`);
        pushBtn.innerText = "Failed ❌";
        setTimeout(() => {
          pushBtn.innerText = originalText;
          pushBtn.disabled = false;
        }, 2000);
      }
    });
  }

  // -------------------------------------------------------------------
  // ZIP COMPRESSION
  // -------------------------------------------------------------------

  function exportAsZip() {
    if (detectedFiles.length === 0) return;
    
    const zip = new JSZip();
    const projectNameInput = document.getElementById('project-name-input');
    const projectName = projectNameInput.value.trim() || 'ai-project';

    detectedFiles.forEach(file => {
      zip.file(file.name, file.content);
    });

    zip.generateAsync({ type: 'blob' }).then((content) => {
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(err => {
      alert(`ZIP compilation failed: ${err.message}`);
    });
  }

})();
