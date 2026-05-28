const STORAGE_KEYS = {
  apiKey: "apiKey",
  isActive: "isActive",
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  elements.apiKey = document.getElementById("apiKey");
  elements.isActive = document.getElementById("isActive");
  elements.saveButton = document.getElementById("saveButton");
  elements.statusLabel = document.getElementById("statusLabel");
  elements.message = document.getElementById("message");

  await loadState();

  elements.isActive.addEventListener("change", async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.isActive]: elements.isActive.checked });
    updateStatus(elements.isActive.checked);
    showMessage(elements.isActive.checked ? "Extensão ativada." : "Extensão desativada.");
  });

  elements.saveButton.addEventListener("click", saveSettings);
});

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiKey, STORAGE_KEYS.isActive]);
  elements.apiKey.value = stored[STORAGE_KEYS.apiKey] ?? "";
  elements.isActive.checked = Boolean(stored[STORAGE_KEYS.isActive]);
  updateStatus(elements.isActive.checked);
  showMessage("Configurações carregadas.");
}

async function saveSettings() {
  const apiKey = elements.apiKey.value.trim();
  const isActive = elements.isActive.checked;

  await chrome.storage.local.set({
    [STORAGE_KEYS.apiKey]: apiKey,
    [STORAGE_KEYS.isActive]: isActive,
  });

  updateStatus(isActive);
  showMessage(apiKey ? "Configurações salvas." : "Salvo sem chave de API.");
}

function updateStatus(isActive) {
  elements.statusLabel.textContent = isActive ? "Ativo" : "Inativo";
  elements.statusLabel.dataset.state = isActive ? "active" : "inactive";
}

function showMessage(text) {
  elements.message.textContent = text;
}