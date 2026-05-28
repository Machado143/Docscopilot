const STATE = {
	isActive: false,
	debounceTimer: null,
	lastContext: "",
	lastSuggestion: "",
	lastRequestId: 0,
	panelElement: null,
	panelVisible: false,
	cooldownUntil: 0,
};

const DEBOUNCE_DELAY_MS = 650;
const MAX_CONTEXT_LENGTH = 500;
const CONTEXT_PARAGRAPH_LIMIT = 3;
const PANEL_ID = "docsCopilot-panel";

init().catch((error) => {
	console.error("[DocsCopilot] Falha ao inicializar o content script:", error);
});

async function init() {
	await loadSettings();
	chrome.storage.onChanged.addListener(handleStorageChange);
	document.addEventListener("keyup", handleKeyUp, true);
	document.addEventListener("keydown", handleKeyDown, true);
	ensurePanel();

	window.__docsCopilotDebug = {
		getLastContext: () => STATE.lastContext,
		isActive: () => STATE.isActive,
		getLastSuggestion: () => STATE.lastSuggestion,
	};
}

async function loadSettings() {
	const stored = await chrome.storage.local.get(["isActive"]);
	STATE.isActive = Boolean(stored.isActive);
	updatePanelStatus();
}

function handleStorageChange(changes, areaName) {
	if (areaName !== "local" || !changes.isActive) {
		return;
	}

	STATE.isActive = Boolean(changes.isActive.newValue);
	updatePanelStatus();
}

function handleKeyUp(event) {
	if (!STATE.isActive || !isRelevantKey(event)) {
		return;
	}

	clearTimeout(STATE.debounceTimer);
	STATE.debounceTimer = setTimeout(() => {
		const context = extractContext();

		if (!context) {
			showPanelMessage("Sem contexto visível no documento.");
			return;
		}

		STATE.lastContext = context;
		showPanel();
		showPanelMessage("Gerando resposta com base no documento...");
		requestCompletion(buildDefaultPrompt(context), context);
	}, getDebounceDelayMs());
}

function handleKeyDown(event) {
	if (!STATE.panelVisible) {
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		hidePanel();
	}
}

function isRelevantKey(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}

	const textKeys = new Set(["Backspace", "Delete", "Enter", "Space"]);
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

function buildDefaultPrompt(context) {
	return [
		"Continue o seguinte texto de forma natural.",
		"Retorne APENAS a continuação direta, sem repetir nada do que já foi escrito.",
		"Sem aspas, sem explicações, sem prefixos.",
		"Máximo 2 frases curtas.",
		"",
		"Texto:",
		String(context).trim(),
	].join("\n");
}

async function requestCompletion(prompt, freshnessContext = "") {
	const requestId = ++STATE.lastRequestId;
	showPanelLoading();

	try {
		const response = await chrome.runtime.sendMessage({
			type: "GET_COMPLETION",
			context: prompt,
		});

		if (requestId !== STATE.lastRequestId) {
			return;
		}

		if (freshnessContext) {
			const currentContext = extractContext();
			if (!currentContext || cleanText(currentContext) !== cleanText(freshnessContext)) {
				showPanelMessage("O documento mudou. Gere a resposta de novo para atualizar.");
				return;
			}
		}

		if (response?.suggestion) {
			STATE.lastSuggestion = response.suggestion;
			showPanelSuggestion(response.suggestion);
			return;
		}

		if (response?.error === "NO_API_KEY") {
			showPanelMessage("Salve uma chave Gemini no popup da extensão.");
			return;
		}

		if (response?.error === "RATE_LIMIT") {
			STATE.cooldownUntil = Date.now() + 2000;
			showPanelMessage("Rate limit detectado. Vou desacelerar por alguns segundos.");
			return;
		}

		if (response?.error) {
			showPanelMessage(response.message || "Não consegui gerar uma resposta.");
		}
	} catch (error) {
		showPanelMessage(`Falha ao consultar o Gemini: ${error?.message || "erro desconhecido"}`);
		console.error("[DocsCopilot] Falha ao solicitar sugestão:", error);
	}
}

function getDebounceDelayMs() {
	return Date.now() < STATE.cooldownUntil ? 2000 : DEBOUNCE_DELAY_MS;
}

function ensurePanel() {
	if (STATE.panelElement) {
		return STATE.panelElement;
	}

	const panel = document.createElement("aside");
	panel.id = PANEL_ID;
	panel.className = "docsCopilot-hidden";
	panel.innerHTML = `
		<div class="docsCopilot-panel__header">
			<div>
				<div class="docsCopilot-panel__title">DocsCopilot Chat</div>
				<div class="docsCopilot-panel__status" data-role="status">Inativo</div>
			</div>
			<button class="docsCopilot-panel__close" type="button" data-role="close">×</button>
		</div>
		<div class="docsCopilot-panel__body">
			<div class="docsCopilot-panel__section">
				<div class="docsCopilot-panel__label">Prompt</div>
				<textarea class="docsCopilot-panel__input" data-role="prompt" placeholder="Digite o que você quer pedir para o Gemini. Ctrl+Enter para enviar."></textarea>
			</div>
			<div class="docsCopilot-panel__actions">
				<button class="docsCopilot-panel__button" type="button" data-role="send">Gerar resposta</button>
				<button class="docsCopilot-panel__button docsCopilot-panel__button--secondary" type="button" data-role="copy">Copiar resposta</button>
			</div>
			<div class="docsCopilot-panel__section" style="flex: 1; min-height: 0;">
				<div class="docsCopilot-panel__label">Resposta</div>
				<div class="docsCopilot-panel__output" data-role="output">Abra o painel e gere uma resposta para copiar.</div>
			</div>
			<div class="docsCopilot-panel__meta" data-role="meta">A resposta aparece aqui para você copiar e colar no documento.</div>
		</div>
	`;

	panel.querySelector('[data-role="close"]').addEventListener("click", hidePanel);
	panel.querySelector('[data-role="send"]').addEventListener("click", handlePanelSend);
	panel.querySelector('[data-role="copy"]').addEventListener("click", copyPanelOutput);
	panel.querySelector('[data-role="prompt"]').addEventListener("keydown", (event) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			handlePanelSend();
		}
	});

	document.body.appendChild(panel);
	STATE.panelElement = panel;
	updatePanelStatus();
	return panel;
}

function showPanel() {
	const panel = ensurePanel();
	panel.classList.remove("docsCopilot-hidden");
	STATE.panelVisible = true;
	updatePanelStatus();
}

function hidePanel() {
	if (!STATE.panelElement) {
		return;
	}

	STATE.panelElement.classList.add("docsCopilot-hidden");
	STATE.panelVisible = false;
}

function updatePanelStatus() {
	if (!STATE.panelElement) {
		return;
	}

	const status = STATE.panelElement.querySelector('[data-role="status"]');
	if (status) {
		status.textContent = STATE.isActive ? "Ativo" : "Inativo";
	}
}

function showPanelLoading() {
	showPanel();
	const output = STATE.panelElement?.querySelector('[data-role="output"]');
	if (output) {
		output.textContent = "Carregando resposta...";
		output.classList.add("docsCopilot-panel__loading");
	}
	setMetaText("Consultando o Gemini...");
}

function showPanelMessage(message) {
	showPanel();
	const output = STATE.panelElement?.querySelector('[data-role="output"]');
	if (output) {
		output.textContent = message;
		output.classList.remove("docsCopilot-panel__loading");
	}
	setMetaText(message);
}

function showPanelSuggestion(text) {
	showPanel();
	const output = STATE.panelElement?.querySelector('[data-role="output"]');
	if (output) {
		output.textContent = cleanText(String(text || ""));
		output.classList.remove("docsCopilot-panel__loading");
	}
	setMetaText("Use o botão Copiar resposta para colar no documento.");
}

function setMetaText(message) {
	const meta = STATE.panelElement?.querySelector('[data-role="meta"]');
	if (meta) {
		meta.textContent = message;
	}
}

async function handlePanelSend() {
	const promptElement = STATE.panelElement?.querySelector('[data-role="prompt"]');
	const promptValue = cleanText(String(promptElement?.value || ""));
	const context = extractContext();

	if (!promptValue && !context) {
		showPanelMessage("Digite um prompt ou deixe o texto aberto no documento.");
		return;
	}

	const fullPrompt = promptValue
		? (context ? `${promptValue}\n\nContexto do documento:\n${context}` : promptValue)
		: buildDefaultPrompt(context);

	STATE.lastContext = context;
	await requestCompletion(fullPrompt, context);
}

async function copyPanelOutput() {
	const output = STATE.panelElement?.querySelector('[data-role="output"]');
	const text = cleanText(String(output?.textContent || ""));

	if (!text) {
		showPanelMessage("Não há resposta para copiar.");
		return;
	}

	try {
		await navigator.clipboard.writeText(text);
		setMetaText("Resposta copiada para a área de transferência.");
	} catch (error) {
		showPanelMessage("Não consegui copiar automaticamente. Selecione e copie manualmente.");
		console.error("[DocsCopilot] Falha ao copiar texto:", error);
	}
}
