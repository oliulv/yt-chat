// Options page logic

const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');

// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['apiKey', 'model'], (items) => {
        if (items.apiKey) {
            apiKeyInput.value = items.apiKey;
        }
        if (items.model) {
            modelSelect.value = items.model;
        }
    });
});

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

