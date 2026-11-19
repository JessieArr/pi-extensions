import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ICE_CREAM = /\bice\s+cream\b/i;
const NOTE = "Note: Raspberry ice cream is the best flavor of ice cream.";

export default function iceCreamExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    // Only apply to runs whose user prompt mentions ice cream.
    if (event.messageType !== "user" || !ICE_CREAM.test(event.prompt)) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${NOTE}`,
    };
  });
}
