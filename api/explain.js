export default async function handler(req, res) {
  // CORS configuration for the extension
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or restrict to chrome-extension://
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contextPayload } = req.body;
    
    if (!contextPayload) {
      return res.status(400).json({ error: 'Missing contextPayload' });
    }

    const apiKeys = [];
    if (process.env.GEMINI_API_KEY) {
      apiKeys.push(process.env.GEMINI_API_KEY);
    }
    // Note: Provide your own GEMINI_API_KEY in the environment variables

    const systemPrompt = `You are a privacy expert explaining what web trackers do. You will receive structured facts about a web tracker, the website it was found on, and the Rule Engine's decision on whether it is safe to block.
Your job is to translate these facts into a highly contextual, human-readable explanation in strict JSON format.
DO NOT hallucinate. Use ONLY the provided facts. Keep explanations concise and educational.
If the tracker is unknown or unclassified, mention that this domain does not appear in known threat/tracker databases and might be custom infrastructure.
DO NOT change the rule engine's recommendation. Just explain *why* it made that decision based on the context.

Respond with exactly this JSON format:
{
  "purpose": "<short 2-4 word summary of what this tracker does>",
  "context": "<1-2 sentences explaining why this tracker is running on this specific website during the user's current activity>",
  "impact": "<1 sentence explaining what data it likely collects and if it affects the user's experience if blocked>"
}`;

    const userPrompt = JSON.stringify(contextPayload, null, 2);

    let data = null;
    let lastError = null;

    for (const apiKey of apiKeys) {
      try {
        const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [{
              parts: [{ text: userPrompt }]
            }],
            generationConfig: {
              response_mime_type: "application/json",
              temperature: 0.1
            }
          })
        });

        if (!apiRes.ok) {
          throw new Error(`Gemini API Error: ${apiRes.status} ${apiRes.statusText}`);
        }

        data = await apiRes.json();
        break; // Stop iterating if request is successful
      } catch (err) {
        lastError = err;
        console.warn("Failed with current API key, trying next if available...");
      }
    }

    if (!data) {
      throw lastError || new Error("All provided API keys failed.");
    }

    const jsonString = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(jsonString);

    return res.status(200).json(parsed);

  } catch (error) {
    console.warn("Backend API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
