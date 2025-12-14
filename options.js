// Options page logic

const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');
const shortcutDisplay = document.getElementById('shortcut-display');

function init() {
    // Ensure elements exist
    if (!apiKeyInput || !modelSelect || !saveBtn || !statusMsg) {
        console.error('Required elements not found on options page');
        return;
    }

    chrome.storage.sync.get(['apiKey', 'model'], (items) => {
        if (items.apiKey && apiKeyInput) {
            apiKeyInput.value = items.apiKey;
        }
        if (modelSelect) {
            // Ensure select is enabled
            modelSelect.disabled = false;
            
            if (items.model) {
                // Check if the stored model exists in the dropdown options
                const modelExists = Array.from(modelSelect.options).some(option => option.value === items.model);
                if (modelExists) {
                    modelSelect.value = items.model;
                } else {
                    // If old model value doesn't exist, set to default (Claude Sonnet 4.5)
                    modelSelect.value = 'anthropic/claude-sonnet-4.5';
                    // Update storage with the new default
                    chrome.storage.sync.set({ model: 'anthropic/claude-sonnet-4.5' });
                }
            } else {
                // No model stored, set default
                modelSelect.value = 'anthropic/claude-sonnet-4.5';
            }
        }
    });

    updateShortcutDisplay();
    window.addEventListener('focus', updateShortcutDisplay);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateShortcutDisplay();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Save settings
if (saveBtn) {
    saveBtn.addEventListener('click', () => {
        if (!apiKeyInput || !modelSelect) {
            showStatus('ERROR: FORM ELEMENTS NOT FOUND', true);
            return;
        }

        const apiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;

        if (!apiKey) {
            showStatus('API KEY REQUIRED', true);
            return;
        }

        if (!model) {
            showStatus('MODEL SELECTION REQUIRED', true);
            return;
        }

        chrome.storage.sync.set({
            apiKey: apiKey,
            model: model
        }, () => {
            showStatus('CONFIGURATION SAVED.');
        });
    });
}

function showStatus(msg, isError = false) {
    if (!statusMsg) {
        console.error('Status message element not found');
        return;
    }
    statusMsg.textContent = msg;
    statusMsg.style.color = isError ? '#ff7b72' : '#238636';
    statusMsg.classList.remove('hidden');
    setTimeout(() => {
        if (statusMsg) {
            statusMsg.classList.add('hidden');
        }
    }, 3000);
}

function normalizeShortcutPart(part) {
    const normalized = part.trim();
    const map = {
        Command: 'Cmd',
        MacCtrl: 'Ctrl',
        Control: 'Ctrl',
        Option: 'Alt'
    };
    return map[normalized] || normalized;
}

function renderShortcut(shortcut) {
    if (!shortcutDisplay) return;

    shortcutDisplay.textContent = '';

    if (!shortcut) {
        const kbd = document.createElement('kbd');
        kbd.textContent = 'UNASSIGNED';
        shortcutDisplay.appendChild(kbd);
        return;
    }

    const parts = shortcut
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean)
        .map(normalizeShortcutPart);

    parts.forEach((part, index) => {
        if (index > 0) {
            shortcutDisplay.append(' + ');
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = part;
        shortcutDisplay.appendChild(kbd);
    });
}

function updateShortcutDisplay() {
    if (!shortcutDisplay) return;
    if (!chrome?.commands?.getAll) {
        renderShortcut(null);
        return;
    }

    chrome.commands.getAll((commands) => {
        const list = commands || [];
        const preferredNames = ['open_side_panel', '_execute_action'];
        const match =
            preferredNames
                .map((name) => list.find((c) => c?.name === name && c?.shortcut))
                .find(Boolean) ||
            preferredNames.map((name) => list.find((c) => c?.name === name)).find(Boolean);

        renderShortcut(match?.shortcut);
    });
}
