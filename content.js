// AI Project Extractor - Content Script

(function () {
  let detectedFiles = [];
  let sidebarEl = null;
  let floatingBtnEl = null;

  // Initial detection
  window.addEventListener('load', () => {
    setTimeout(createUI, 2000);
  });

  // Re-run UI creation if DOM shifts or on SPA navigation
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

  // -------------------------------------------------------------------
  // PARSING / EXTRACTION LOGIC
  // -------------------------------------------------------------------

  function cleanFilename(text) {
    if (!text) return '';
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^[📁📂📄⚙️🔨💻🐍☕️]+/g, ''); // remove emojis
    cleaned = cleaned.replace(/^\d+[\.\)]\s*/, ''); // remove numeric bullet points like "1. " or "2. "
    cleaned = cleaned.trim();
    return cleaned;
  }

  function getFilenameFromPrecedingSiblings(preElement) {
    const fileRegex = /(?:📁|\d+[\.\)]|\s)*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/;
    
    // Heuristic 1: Check preceding siblings of the pre element itself
    let sibling = preElement.previousElementSibling;
    let count = 0;
    while (sibling && count < 3) {
      const text = sibling.innerText || sibling.textContent || '';
      if (text.length < 150 && text.trim().length > 0) {
        const match = text.match(fileRegex);
        if (match && match[1].includes('.')) {
          return cleanFilename(match[1]);
        }
      }
      sibling = sibling.previousElementSibling;
      count++;
    }

    // Heuristic 2: Check preceding siblings of the parent element (in case pre is inside a wrapper div)
    let parent = preElement.parentElement;
    if (parent && parent !== document.body) {
      sibling = parent.previousElementSibling;
      count = 0;
      while (sibling && count < 3) {
        const text = sibling.innerText || sibling.textContent || '';
        if (text.length < 150 && text.trim().length > 0) {
          const match = text.match(fileRegex);
          if (match && match[1].includes('.')) {
            return cleanFilename(match[1]);
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
    try {
      console.log("AI Extractor: Starting page scan...");
      detectedFiles = [];
      
      const preElements = document.querySelectorAll('pre');
      console.log(`AI Extractor: Found ${preElements.length} <pre> elements on page`);

      preElements.forEach((pre, index) => {
        const codeEl = pre.querySelector('code') || pre;
        const codeText = codeEl.innerText || codeEl.textContent || '';
        if (!codeText.trim()) return;

        // Determine language
        let langClass = '';
        if (codeEl.classList) {
          codeEl.classList.forEach(cls => {
            if (cls.startsWith('language-') || cls.startsWith('lang-') || cls.startsWith('hljs')) {
              langClass = cls;
            }
          });
        }
        if (!langClass && pre.classList) {
          pre.classList.forEach(cls => {
            if (cls.startsWith('language-') || cls.startsWith('lang-')) {
              langClass = cls;
            }
          });
        }

        // Try different heuristics to extract a filename
        let filename = getFilenameFromPrecedingSiblings(pre);
        if (!filename) {
          filename = getFilenameFromCodeHeader(codeText, langClass);
        }
        if (!filename) {
          const ext = getExtensionFromLang(langClass);
          filename = `file_${index + 1}.${ext}`;
        }

        // Check if code text starts with the filename
        let cleanedCode = codeText;
        const lines = codeText.split('\n');
        if (lines.length > 0) {
          const firstLineClean = lines[0].replace(/^[#\/\/\|\*\-\s]+/, '').trim();
          if (firstLineClean.toLowerCase() === filename.toLowerCase()) {
            cleanedCode = lines.slice(1).join('\n');
          }
        }

        detectedFiles.push({
          id: `file-${index}-${Date.now()}`,
          name: filename,
          content: cleanedCode,
          lang: langClass ? langClass.replace(/(?:language-|lang-)/, '') : 'text'
        });
      });

      console.log(`AI Extractor: Successfully extracted ${detectedFiles.length} files`);
      renderFileList();
    } catch (err) {
      console.error("AI Extractor: Scan failed with error:", err);
    }
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
        <button id="scan-btn" class="primary-btn">🔍 Scan Page</button>
        <button id="export-zip-btn" class="accent-btn" disabled>📦 Export ZIP</button>
      </div>
      <div class="project-info">
        <label for="project-name-input">Project Name:</label>
        <input type="text" id="project-name-input" value="ai-exported-project" placeholder="project-name">
      </div>
      <div class="file-list-container">
        <div id="no-files-msg">No files detected yet. Click "Scan Page" to find project code.</div>
        <ul id="file-list" class="file-tree"></ul>
      </div>
      <div class="sidebar-footer">
        <span>AI Project Extractor v1.0</span>
      </div>
    `;
    document.body.appendChild(sidebarEl);

    // Event Listeners
    floatingBtnEl.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-close-btn').addEventListener('click', toggleSidebar);
    document.getElementById('scan-btn').addEventListener('click', scanForCodeBlocks);
    document.getElementById('export-zip-btn').addEventListener('click', exportAsZip);

    // Auto scan on open
    scanForCodeBlocks();
  }

  function toggleSidebar() {
    sidebarEl.classList.toggle('open');
  }

  function renderFileList() {
    const listEl = document.getElementById('file-list');
    const noFilesEl = document.getElementById('no-files-msg');
    const exportBtn = document.getElementById('export-zip-btn');

    listEl.innerHTML = '';

    if (detectedFiles.length === 0) {
      noFilesEl.style.display = 'block';
      exportBtn.disabled = true;
      return;
    }

    noFilesEl.style.display = 'none';
    exportBtn.disabled = false;

    detectedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.innerHTML = `
        <div class="file-item-row">
          <span class="file-icon">📄</span>
          <input type="text" class="file-name-edit" value="${file.name}" data-id="${file.id}">
          <div class="file-item-actions">
            <button class="preview-btn" title="Preview Content">👁️</button>
            <button class="delete-btn" title="Delete File">&times;</button>
          </div>
        </div>
      `;

      // Event listener for renaming files
      const nameInput = li.querySelector('.file-name-edit');
      nameInput.addEventListener('change', (e) => {
        file.name = e.target.value.trim();
      });

      // Preview file click
      li.querySelector('.preview-btn').addEventListener('click', () => {
        showPreviewModal(file);
      });

      // Delete file click
      li.querySelector('.delete-btn').addEventListener('click', () => {
        detectedFiles.splice(index, 1);
        renderFileList();
      });

      listEl.appendChild(li);
    });
  }

  // -------------------------------------------------------------------
  // PREVIEW MODAL
  // -------------------------------------------------------------------

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
          <h4>Preview: ${file.name}</h4>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <textarea readonly class="code-preview-area">${file.content}</textarea>
        </div>
        <div class="modal-footer">
          <button class="modal-save-btn primary-btn">Close</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    const closeFn = () => { modal.style.display = 'none'; };
    modal.querySelector('.modal-close').addEventListener('click', closeFn);
    modal.querySelector('.modal-save-btn').addEventListener('click', closeFn);
  }

  // -------------------------------------------------------------------
  // EXPORT AS ZIP
  // -------------------------------------------------------------------

  function exportAsZip() {
    if (detectedFiles.length === 0) return;
    
    const zip = new JSZip();
    const projectNameInput = document.getElementById('project-name-input');
    const projectName = projectNameInput.value.trim() || 'ai-project';

    detectedFiles.forEach(file => {
      // Add file to ZIP, creating subdirectories if needed (JSZip handles slashes automatically)
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
      alert(`Error generating ZIP file: ${err.message}`);
    });
  }

})();
