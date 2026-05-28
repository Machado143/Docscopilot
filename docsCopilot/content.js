const STATE = {
	isActive: false,
	debounceTimer: null,
	lastContext: "",
	lastSuggestion: "",
	lastRequestId: 0,
	overlayElement: null,
	overlayType: null,
	cooldownUntil: 0,
};

const DEBOUNCE_DELAY_MS = 650;
const MAX_CONTEXT_LENGTH = 500;
const CONTEXT_PARAGRAPH_LIMIT = 3;

init().catch((error) => {
	console.error("[DocsCopilot] Falha ao inicializar o content script:", error);
});

async function init() {
	await loadSettings();
	chrome.storage.onChanged.addListener(handleStorageChange);
	document.addEventListener("keyup", handleKeyUp, true);
	document.addEventListener("keydown", handleKeyDown, true);

	window.__docsCopilotDebug = {
		getLastContext: () => STATE.lastContext,
		isActive: () => STATE.isActive,
		getLastSuggestion: () => STATE.lastSuggestion,
	};
}

async function loadSettings() {
	const stored = await chrome.storage.local.get(["isActive"]);
	STATE.isActive = Boolean(stored.isActive);
}

function handleStorageChange(changes, areaName) {
	if (areaName !== "local" || !changes.isActive) {
		return;
	}

	STATE.isActive = Boolean(changes.isActive.newValue);
}

function handleKeyUp(event) {
	if (!STATE.isActive || !isRelevantKey(event)) {
		return;
	}

	clearTimeout(STATE.debounceTimer);
	STATE.debounceTimer = setTimeout(() => {
		const context = extractContext();

		if (!context) {
			removeOverlay();
			return;
		}

		STATE.lastContext = context;
		console.log("[DocsCopilot] Contexto capturado:", context);
		requestCompletion(context);
	}, getDebounceDelayMs());
}

function handleKeyDown(event) {
	if (!hasOverlay()) {
		return;
	}

	if (event.key === "Tab") {
		event.preventDefault();
		acceptSuggestion();
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		removeOverlay();
		return;
	}

	if (!isRelevantKey(event)) {
		return;
	}

	removeOverlay();
}

function isRelevantKey(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}

	const textKeys = new Set([
		"Backspace",
		"Delete",
		"Enter",
		"Space",
	]);

	return event.key.length === 1 || textKeys.has(event.key);
}

function extractContext() {
	const paragraphs = Array.from(document.querySelectorAll(".kix-paragraphrenderer"));

	if (paragraphs.length === 0) {
		return "";
	}

	const visibleParagraphs = paragraphs
		.filter(isVisibleElement)
		.map((element) => cleanText(element.textContent || ""))
		.filter(Boolean);

	if (visibleParagraphs.length === 0) {
		return "";
	}

	const recentParagraphs = visibleParagraphs.slice(-CONTEXT_PARAGRAPH_LIMIT);
	const context = recentParagraphs.join("\n").trim();

	if (context.length <= MAX_CONTEXT_LENGTH) {
		return context;
	}

	return context.slice(-MAX_CONTEXT_LENGTH);
}

function isVisibleElement(element) {
	const rect = element.getBoundingClientRect();

	if (rect.width === 0 || rect.height === 0) {
		return false;
	}

	const styles = window.getComputedStyle(element);
	if (styles.display === "none" || styles.visibility === "hidden") {
		return false;
	}

	return rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function cleanText(text) {
	return text.replace(/\s+/g, " ").trim();
}

async function requestCompletion(context) {
	const requestId = ++STATE.lastRequestId;
	showLoadingIndicator();

	try {
		const response = await chrome.runtime.sendMessage({
			type: "GET_COMPLETION",
			context,
		});

		if (requestId !== STATE.lastRequestId) {
			return;
		}

		const currentContext = extractContext();
		if (!currentContext || cleanText(currentContext) !== cleanText(context)) {
			removeOverlay();
			return;
		}

		if (response?.suggestion) {
			STATE.lastSuggestion = response.suggestion;
			console.log("[DocsCopilot] Sugestão recebida:", response.suggestion);
			showGhostText(response.suggestion);
			return;
		}

		if (response?.error === "NO_API_KEY") {
			removeOverlay();
			console.warn("[DocsCopilot] Configure a chave da API no popup.");
			return;
		}

		if (response?.error === "RATE_LIMIT") {
			STATE.cooldownUntil = Date.now() + 2000;
			removeOverlay();
			console.warn("[DocsCopilot] Rate limit da API. Aplicando cooldown temporário.");
			return;
		}

		if (response?.error) {
			removeOverlay();
			console.warn("[DocsCopilot] Resposta sem sugestão:", response.error, response.message || "");
		}
	} catch (error) {
		removeOverlay();
		console.error("[DocsCopilot] Falha ao solicitar sugestão:", error);
	}
}

function getDebounceDelayMs() {
	return Date.now() < STATE.cooldownUntil ? 2000 : DEBOUNCE_DELAY_MS;
}

function showLoadingIndicator() {
	removeOverlay();
	const loading = document.createElement("span");
	loading.id = "docsCopilot-ghost";
	loading.className = "docsCopilot-loading";
	loading.textContent = "...";
	positionOverlay(loading);
	document.body.appendChild(loading);
	STATE.overlayElement = loading;
	STATE.overlayType = "loading";
}

function showGhostText(text) {
	const suggestion = cleanText(String(text || ""));

	if (!suggestion) {
		removeOverlay();
		return;
	}

	removeOverlay();
	const ghost = document.createElement("span");
	ghost.id = "docsCopilot-ghost";
	ghost.className = "docsCopilot-ghost";
	ghost.textContent = suggestion;
	positionOverlay(ghost);
	document.body.appendChild(ghost);
	STATE.overlayElement = ghost;
	STATE.overlayType = "ghost";
}

function positionOverlay(element) {
	const rect = getCaretRect();
	const left = Math.min(rect.right, window.innerWidth - 20);
	const top = rect.bottom > window.innerHeight - 24 ? rect.bottom : rect.top;

	element.style.left = `${Math.max(0, left)}px`;
	element.style.top = `${Math.max(0, top)}px`;
}

function getCaretRect() {
	const selection = window.getSelection();

	if (!selection || selection.rangeCount === 0) {
		return { left: 0, top: 0, right: 0, bottom: 0 };
	}

	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(true);
	const rect = range.getBoundingClientRect();

	if (rect && (rect.width || rect.height)) {
		return rect;
	}

	const nodeRect = selection.anchorNode?.parentElement?.getBoundingClientRect?.();
	if (nodeRect) {
		return nodeRect;
	}

	return { left: 0, top: 0, right: 0, bottom: 0 };
}

function acceptSuggestion() {
	if (!STATE.overlayElement || STATE.overlayType !== "ghost") {
		return;
	}

	const text = STATE.overlayElement.textContent || "";
	removeOverlay();
	insertTextAtCursor(text);
}

function insertTextAtCursor(text) {
	if (document.execCommand("insertText", false, text)) {
		return;
	}

	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return;
	}

	const range = selection.getRangeAt(0);
	range.deleteContents();
	range.insertNode(document.createTextNode(text));
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

function removeOverlay() {
	if (STATE.overlayElement?.parentNode) {
		STATE.overlayElement.parentNode.removeChild(STATE.overlayElement);
	}

	STATE.overlayElement = null;
	STATE.overlayType = null;
}

function hasOverlay() {
	return Boolean(STATE.overlayElement);
}
