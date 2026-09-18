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
    const profileSecret = profileKey
      ? (localStorage?.getItem(profileKey) || sessionStorage?.getItem(profileKey) || "")
      : "";
    const switchEnabled = document?.getElementById(FORM_IDS.enabled)?.getAttribute("aria-checked") === "true";
    const apiKey =
      profileSecret ||
      value(document, FORM_IDS.apiKey) ||
      (saved.profileId ? localStorage?.getItem(`vela-provider-key:${saved.profileId}`) : "") ||
      localStorage?.getItem("sage-byok-key") ||
      sessionStorage?.getItem("sage-byok-key") ||
      saved.apiKey ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("vela-voice-api-key") : "") ||
      "";
    const model = value(document, FORM_IDS.model) || saved.model || "";
    const endpoint = value(document, FORM_IDS.endpoint) || String(saved.endpoint || "").trim();
    const provider = value(document, FORM_IDS.provider) || saved.provider || "custom";

    const isExplicitlyEnabled = switchEnabled || saved.enabled === true;
    const hasCredentials = Boolean(apiKey && (model || endpoint));
    const enabled = isExplicitlyEnabled || hasCredentials;

    return {
      enabled,
      provider,
      format: value(document, FORM_IDS.format) || saved.format || "openai-chat",
      endpoint,
      model,
      apiKey,
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
