(() => {
  "use strict";

  const FORM_IDS = Object.freeze({
    enabled: "byokSwitch",
    provider: "providerSelect",
    format: "providerFormat",
    endpoint: "providerEndpoint",
    model: "providerModel",
    apiKey: "providerApiKey"
  });

  function parseSaved(storage, key = "sage-byok-config") {
    try {
      const parsed = JSON.parse(storage?.getItem(key) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function value(document, id) {
    return String(document?.getElementById(id)?.value || "").trim();
  }

  function read({ document, localStorage, sessionStorage, key = "sage-byok-config" }) {
    const saved = parseSaved(localStorage, key);
    const profileKey = saved.profileId ? `vela-provider-key:${saved.profileId}` : "";
    const profileSecret = profileKey ? sessionStorage?.getItem(profileKey) || "" : "";
    const switchEnabled = document?.getElementById(FORM_IDS.enabled)?.getAttribute("aria-checked") === "true";
    return {
      enabled: switchEnabled || saved.enabled === true,
      provider: value(document, FORM_IDS.provider) || saved.provider || "custom",
      format: value(document, FORM_IDS.format) || saved.format || "openai-chat",
      endpoint: value(document, FORM_IDS.endpoint) || String(saved.endpoint || "").trim(),
      model: value(document, FORM_IDS.model) || saved.model || "",
      apiKey: profileSecret || value(document, FORM_IDS.apiKey) || sessionStorage?.getItem("sage-byok-key") || "",
      profileId: String(saved.profileId || "")
    };
  }

  function prepare(requests, config, messages, userIndex, searchContext, basePrompt, taskGuidance) {
    const validationError = requests.validate(config);
    if (validationError) throw new Error(validationError);
    const history = requests.buildHistory(messages, userIndex, config.format, searchContext);
    const systemPrompt = requests.buildSystemPrompt(basePrompt, taskGuidance);
    return requests.buildProxyPayload(
      config,
      requests.resolveEndpoint(config.endpoint, config.format),
      history,
      systemPrompt
    );
  }

  globalThis.VelaProviderConfig = Object.freeze({ FORM_IDS, parseSaved, read, prepare });
})();
