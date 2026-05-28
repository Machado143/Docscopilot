const STATE = {
	isActive: false,
	debounceTimer: null,
	lastContext: "",
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

	window.__docsCopilotDebug = {
		getLastContext: () => STATE.lastContext,
		isActive: () => STATE.isActive,
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
			return;
		}

		STATE.lastContext = context;
		console.log("[DocsCopilot] Contexto capturado:", context);
	}, DEBOUNCE_DELAY_MS);
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
		"Tab",
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
