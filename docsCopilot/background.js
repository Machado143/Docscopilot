const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type !== "GET_COMPLETION") {
		return false;
	}

	handleCompletionRequest(message.context)
		.then((response) => sendResponse(response))
		.catch((error) => {
			sendResponse({
				error: "API_ERROR",
				message: error?.message || "Erro inesperado ao consultar o Gemini.",
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

	const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			contents: [
				{
					role: "user",
					parts: [{ text: prompt }],
				},
			],
			generationConfig: {
				maxOutputTokens: 80,
				temperature: 0.4,
			},
		}),
	});

	if (!response.ok) {
		if (response.status === 429) {
			return { error: "RATE_LIMIT", message: "Gemini respondeu com rate limit." };
		}

		throw new Error(`Gemini respondeu com status ${response.status}`);
	}

	const data = await response.json();
	const suggestion = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("").trim() || "";

	if (!suggestion) {
		return { error: "EMPTY_SUGGESTION" };
	}

	return { suggestion };
}
