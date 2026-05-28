const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type !== "GET_COMPLETION") {
		return false;
	}

	handleCompletionRequest(message.context)
		.then((response) => sendResponse(response))
		.catch((error) => {
			sendResponse({
				error: "API_ERROR",
				message: error?.message || "Erro inesperado ao consultar a Anthropic.",
			});
		});

	return true;
});

async function handleCompletionRequest(context) {
	const stored = await chrome.storage.local.get(["apiKey"]);
	const apiKey = String(stored.apiKey || "").trim();

	if (!apiKey) {
		return { error: "NO_API_KEY" };
	}

	if (!context || !String(context).trim()) {
		return { error: "EMPTY_CONTEXT" };
	}

	const prompt = [
		"Continue o seguinte texto de forma natural.",
		"Retorne APENAS a continuação direta, sem repetir nada do que já foi escrito.",
		"Sem aspas, sem explicações, sem prefixos.",
		"Máximo 2 frases curtas.",
		"",
		"Texto:",
		String(context).trim(),
	].join("\n");

	const response = await fetch(ANTHROPIC_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: ANTHROPIC_MODEL,
			max_tokens: 80,
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
		}),
	});

	if (!response.ok) {
		if (response.status === 429) {
			return { error: "RATE_LIMIT", message: "Anthropic respondeu com rate limit." };
		}

		throw new Error(`Anthropic respondeu com status ${response.status}`);
	}

	const data = await response.json();
	const suggestion = data?.content?.[0]?.text?.trim() || "";

	if (!suggestion) {
		return { error: "EMPTY_SUGGESTION" };
	}

	return { suggestion };
}
