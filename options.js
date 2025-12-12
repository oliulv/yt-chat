// Options page logic

const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');
const shortcutDisplay = document.getElementById('shortcut-display');

function init() {
    chrome.storage.sync.get(['apiKey', 'model'], (items) => {
        if (items.apiKey) {
            apiKeyInput.value = items.apiKey;
        }
        if (items.model) {
            modelSelect.value = items.model;
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
saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
        showStatus('API KEY REQUIRED', true);
        return;
    }

    chrome.storage.sync.set({
        apiKey: apiKey,
        model: model
    }, () => {
        showStatus('CONFIGURATION SAVED.');
    });
});

function showStatus(msg, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.style.color = isError ? '#ff7b72' : '#238636';
    statusMsg.classList.remove('hidden');
    setTimeout(() => {
        statusMsg.classList.add('hidden');
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
