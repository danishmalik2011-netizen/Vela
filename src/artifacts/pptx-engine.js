(() => {
  "use strict";

  function cleanHex(color, fallback = "5FA77F") {
    if (!color || typeof color !== "string") return fallback;
    const stripped = color.replace(/\/\*[\s\S]*?\*\//g, "").replace(/["';,]/g, "").trim();
    const match = stripped.match(/#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (!match) return fallback;
    let hex = match[1];
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    return hex.toUpperCase();
  }

  function cleanColorCss(color, fallback = "#5fa77f") {
    if (!color || typeof color !== "string") return fallback;
    const stripped = color.replace(/\/\*[\s\S]*?\*\//g, "").replace(/["';]/g, "").trim();
    if (/^(?:#[0-9a-fA-F]{3,8}|rgba?\(.+?\)|linear-gradient\(.+?\)|var\(--.+?\))$/.test(stripped)) {
      return stripped;
    }
    const hex = cleanHex(stripped, "");
    return hex ? `#${hex}` : fallback;
  }

  const THEMES = Object.freeze({
    vibrant: {
      id: "vibrant",
      name: "Vibrant Indigo",
      bg: "0B0F19",
      bgCss: "linear-gradient(135deg, #0b0f19 0%, #1e1b4b 55%, #180d2e 100%)",
      cardBg: "14192A",
      cardBgCss: "rgba(20, 25, 42, 0.75)",
      cardBorder: "312E81",
      cardBorderCss: "rgba(99, 102, 241, 0.25)",
      text: "FFFFFF",
      textCss: "#ffffff",
      muted: "94A3B8",
      mutedCss: "#94a3b8",
      accent: "F97316", // Coral
      accentCss: "#f97316",
      accent2: "0D9488", // Teal
      accent2Css: "#0d9488",
      primary: "4338CA", // Deep Indigo
      primaryCss: "#4338ca"
    },
    midnight: {
      id: "midnight",
      name: "Midnight Obsidian",
      bg: "09090B",
      bgCss: "linear-gradient(135deg, #09090b 0%, #141418 60%, #1c1917 100%)",
      cardBg: "141416",
      cardBgCss: "rgba(20, 20, 22, 0.8)",
      cardBorder: "27272A",
      cardBorderCss: "rgba(255, 255, 255, 0.1)",
      text: "FAFAFA",
      textCss: "#fafafa",
      muted: "A1A1AA",
      mutedCss: "#a1a1aa",
      accent: "5FA77F", // Vela Green
      accentCss: "#5fa77f",
      accent2: "38BDF8",
      accent2Css: "#38bdf8",
      primary: "5FA77F",
      primaryCss: "#5fa77f"
    },
    dark: {
      id: "dark",
      name: "Matte Black",
      bg: "0A0A0A",
      bgCss: "#0a0a0a",
      cardBg: "141414",
      cardBgCss: "#141414",
      cardBorder: "262626",
      cardBorderCss: "rgba(255, 255, 255, 0.08)",
      text: "FAFAFA",
      textCss: "#fafafa",
      muted: "A1A1AA",
      mutedCss: "#a1a1aa",
      accent: "5FA77F",
      accentCss: "#5fa77f",
      accent2: "38BDF8",
      accent2Css: "#38bdf8",
      primary: "5FA77F",
      primaryCss: "#5fa77f"
    },
    emerald: {
      id: "emerald",
      name: "Deep Emerald",
      bg: "022C22",
      bgCss: "linear-gradient(135deg, #022c22 0%, #064e3b 60%, #042f2e 100%)",
      cardBg: "064E3B",
      cardBgCss: "rgba(6, 78, 59, 0.7)",
      cardBorder: "065F46",
      cardBorderCss: "rgba(52, 211, 153, 0.25)",
      text: "ECFDF5",
      textCss: "#ecfdf5",
      muted: "A7F3D0",
      mutedCss: "#a7f3d0",
      accent: "34D399",
      accentCss: "#34d399",
      accent2: "FBBF24",
      accent2Css: "#fbbf24",
      primary: "059669",
      primaryCss: "#059669"
    },
    slate: {
      id: "slate",
      name: "Modern Slate",
      bg: "0F172A",
      bgCss: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
      cardBg: "1E293B",
      cardBgCss: "rgba(30, 41, 59, 0.75)",
      cardBorder: "334155",
      cardBorderCss: "rgba(148, 163, 184, 0.2)",
      text: "F8FAFC",
      textCss: "#f8fafc",
      muted: "94A3B8",
      mutedCss: "#94a3b8",
      accent: "38BDF8",
      accentCss: "#38bdf8",
      accent2: "F59E0B",
      accent2Css: "#f59e0b",
      primary: "2563EB",
      primaryCss: "#2563eb"
    },
    light: {
      id: "light",
      name: "Clean Editorial",
      bg: "F8FAFC",
      bgCss: "linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)",
      cardBg: "FFFFFF",
      cardBgCss: "#ffffff",
      cardBorder: "E2E8F0",
      cardBorderCss: "#e2e8f0",
      text: "0F172A",
      textCss: "#0f172a",
      muted: "64748B",
      mutedCss: "#64748b",
      accent: "2563EB",
      accentCss: "#2563eb",
      accent2: "0D9488",
      accent2Css: "#0d9488",
      primary: "1E40AF",
      primaryCss: "#1e40af"
    }
  });

  function resolveTheme(themeSpec, customColors = {}) {
    const spec = typeof themeSpec === "string" ? themeSpec.trim().toLowerCase() : "";
    const baseKey = THEMES[themeSpec]
      ? themeSpec
      : THEMES[spec]
      ? spec
      : (spec.includes("vibrant") || spec.includes("indigo") ? "vibrant"
         : spec.includes("midnight") || spec.includes("obsidian") ? "midnight"
         : spec.includes("dark") || spec.includes("matte") || spec.includes("black") ? "dark"
         : spec.includes("emerald") || spec.includes("green") ? "emerald"
         : spec.includes("slate") || spec.includes("blue") ? "slate"
         : spec.includes("light") || spec.includes("clean") || spec.includes("editorial") || spec.includes("white") ? "light"
         : "vibrant");

    const base = { ...(THEMES[baseKey] || THEMES.vibrant) };

    if (customColors.primary) {
      base.primary = cleanHex(customColors.primary, base.primary);
      base.primaryCss = cleanColorCss(customColors.primary, base.primaryCss);
    }
    if (customColors.accent || customColors.accentCoral) {
      const acc = customColors.accent || customColors.accentCoral;
      base.accent = cleanHex(acc, base.accent);
      base.accentCss = cleanColorCss(acc, base.accentCss);
    }
    if (customColors.accentTeal || customColors.accent2 || customColors.secondary) {
      const acc2 = customColors.accentTeal || customColors.accent2 || customColors.secondary;
      base.accent2 = cleanHex(acc2, base.accent2);
      base.accent2Css = cleanColorCss(acc2, base.accent2Css);
    }
    if (customColors.bg || customColors.bgLight || customColors.background) {
      const bg = customColors.bg || customColors.bgLight || customColors.background;
      base.bg = cleanHex(bg, base.bg);
      base.bgCss = cleanColorCss(bg, base.bgCss);
    }
    if (customColors.text || customColors.textColor) {
      const txt = customColors.text || customColors.textColor;
      base.text = cleanHex(txt, base.text);
      base.textCss = cleanColorCss(txt, base.textCss);
    }

    return base;
  }

  function escapeXml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function stripComments(line) {
    return String(line ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/, "")
      .trim();
  }

  function cleanSlideTitle(raw) {
    return String(raw || "")
      .replace(/^#+\s*/, "")
      .replace(/^Slide\s+\d+[:.]\s*/i, "")
      .trim();
  }

  function cleanJsonString(str) {
    let s = String(str ?? "").trim();
    if (!s) return "";

    // 1. Strip markdown fences
    if (s.startsWith("```")) {
      s = s.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n?/i, "").replace(/\r?\n?```\s*$/i, "").trim();
    }

    // 2. Normalize smart quotes & unicode whitespace
    s = s.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
         .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
         .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");

    // 3. Find first { or [
    const firstBrace = s.indexOf("{");
    const firstBracket = s.indexOf("[");
    let startIdx = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }
    if (startIdx !== -1) {
      s = s.slice(startIdx);
    }

    // 4. Tokenizer / Character-level pass:
    // - Strip comments (// and /* */) without breaking URLs in strings
    // - Convert single quotes to double quotes when used as string delimiters
    // - Escape unescaped newlines in strings
    // - Fix invalid escape sequences (e.g. \' -> ')
    // - Track unclosed brackets/braces for truncation repair
    let inString = false;
    let quoteChar = '"';
    let out = "";
    const openStack = [];

    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      const next = s[i + 1];

      if (!inString) {
        // Inline comment //
        if (ch === "/" && next === "/") {
          i += 2;
          while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
          continue;
        }
        // Block comment /* */
        if (ch === "/" && next === "*") {
          i += 2;
          while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
          i += 2;
          continue;
        }

        if (ch === "{" || ch === "[") {
          openStack.push(ch);
          out += ch;
          i++;
          continue;
        }

        if (ch === "}") {
          if (openStack.length && openStack[openStack.length - 1] === "{") openStack.pop();
          out += ch;
          i++;
          continue;
        }

        if (ch === "]") {
          if (openStack.length && openStack[openStack.length - 1] === "[") openStack.pop();
          out += ch;
          i++;
          continue;
        }

        // Start of string literal
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = true;
          quoteChar = ch;
          out += '"';
          i++;
          continue;
        }

        out += ch;
        i++;
      } else {
        // Inside string literal
        if (ch === "\\") {
          if (next === quoteChar && quoteChar === "'") {
            out += "'";
            i += 2;
            continue;
          }
          if (next === '"') {
            out += '\\"';
            i += 2;
            continue;
          }
          if (next === "'") {
            out += "'"; // inside JSON double-quotes, \' is invalid JSON, must be just '
            i += 2;
            continue;
          }
          if (next && /["\\\/bfnrtu]/i.test(next)) {
            out += "\\" + next;
            i += 2;
            continue;
          }
          // Non-standard escape: drop the backslash and output character
          if (next) {
            out += next;
            i += 2;
            continue;
          }
          out += "\\";
          i++;
          continue;
        }

        if (ch === quoteChar) {
          inString = false;
          out += '"';
          i++;
          continue;
        }

        if (ch === '"' && quoteChar !== '"') {
          out += '\\"'; // Escape double quote inside single-quoted string
          i++;
          continue;
        }

        if (ch === "\n") {
          out += "\\n";
          i++;
          continue;
        }

        if (ch === "\r") {
          i++;
          continue;
        }

        if (ch === "\t") {
          out += "\\t";
          i++;
          continue;
        }

        out += ch;
        i++;
      }
    }

    // Auto-close string if stream cut off
    if (inString) {
      out += '"';
    }

    // 5. Fix unquoted keys: { title: "..." } -> { "title": "..." }
    out = out.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":');

    // 6. Fix trailing commas before } or ]
    out = out.replace(/,\s*([}\]])/g, "$1");

    // 7. Auto-repair truncated JSON:
    if (openStack.length > 0) {
      out = out.replace(/,\s*$/, "");
      out = out.replace(/:\s*$/, ': ""');
      out = out.replace(/,\s*"[^"]*"\s*:\s*$/, "");
      out = out.replace(/([{,]\s*)"[^"]*"\s*$/, "");

      while (openStack.length > 0) {
        const top = openStack.pop();
        if (top === "{") out += "}";
        else if (top === "[") out += "]";
      }
    }

    out = out.replace(/,\s*([}\]])/g, "$1");
    return out;
  }

  function extractSlideObjectsFallback(text) {
    const slides = [];
    const regex = /\{\s*["']?(?:layout|title|headline|cards|stats|timeline)["']?\s*:/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      let depth = 0;
      let inStr = false;
      let q = '"';
      let end = -1;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (!inStr) {
          if (c === '"' || c === "'") { inStr = true; q = c; }
          else if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        } else {
          if (c === "\\") i++;
          else if (c === q) inStr = false;
        }
      }
      if (end > start) {
        const chunk = text.slice(start, end + 1);
        try {
          const repaired = cleanJsonString(chunk);
          const obj = JSON.parse(repaired);
          if (obj && typeof obj === "object" && !Array.isArray(obj.slides) && !Array.isArray(obj.deck)) {
            if (obj.layout || obj.title || obj.headline || obj.cards || obj.stats) {
              slides.push(obj);
              regex.lastIndex = end + 1;
            }
          }
        } catch {}
      }
    }
    return slides;
  }

  function extractInlineKeyValuePairs(text) {
    let str = String(text ?? "").trim().replace(/^[-*+]\s+/, "");
    if (!/^[a-zA-Z0-9_-]+\s*:/i.test(str)) return null;

    const pairs = [];
    let currentKey = "";
    let currentValue = "";
    let inQuotes = null;
    let bracketDepth = 0;
    let i = 0;

    const firstKeyMatch = str.match(/^([a-zA-Z0-9_-]+)\s*:\s*/);
    if (!firstKeyMatch) return null;
    currentKey = firstKeyMatch[1].trim();
    i = firstKeyMatch[0].length;

    while (i < str.length) {
      const ch = str[i];

      if (inQuotes) {
        if (ch === inQuotes && str[i - 1] !== "\\") {
          inQuotes = null;
        }
        currentValue += ch;
        i++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inQuotes = ch;
        currentValue += ch;
        i++;
        continue;
      }

      if (ch === "[" || ch === "{" || ch === "(") {
        bracketDepth++;
        currentValue += ch;
        i++;
        continue;
      }

      if (ch === "]" || ch === "}" || ch === ")") {
        if (bracketDepth > 0) bracketDepth--;
        currentValue += ch;
        i++;
        continue;
      }

      if (ch === "," && bracketDepth === 0) {
        const rest = str.slice(i + 1);
        const nextKeyMatch = rest.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*/);
        if (nextKeyMatch) {
          pairs.push({ key: currentKey, value: currentValue.trim() });
          currentKey = nextKeyMatch[1].trim();
          currentValue = "";
          i += 1 + nextKeyMatch[0].length;
          continue;
        }
      }

      currentValue += ch;
      i++;
    }

    if (currentKey) {
      pairs.push({ key: currentKey, value: currentValue.trim() });
    }

    if (pairs.length === 0) return null;

    const result = {};
    for (const pair of pairs) {
      let v = pair.value.replace(/^["']|["']$/g, "").trim();
      if (v === "null") v = null;
      else if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (v.startsWith("[") && v.endsWith("]")) {
        try {
          v = JSON.parse(v);
        } catch {
          v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
      }
      result[pair.key] = v;
    }
    return result;
  }

  function normalizeEffectName(raw) {
    if (!raw || typeof raw !== "string") return "";
    const clean = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (["fade-up", "fadeup", "fadeinup", "slide-up", "slideup", "up"].includes(clean)) return "fade-up";
    if (["fade-in", "fadein", "fade"].includes(clean)) return "fade-in";
    if (["fade-down", "fadedown", "slide-down", "slidedown", "down"].includes(clean)) return "fade-down";
    if (["fade-left", "fadeinleft", "slide-left", "slideleft", "left"].includes(clean)) return "fade-left";
    if (["fade-right", "fadeinright", "slide-right", "slideright", "right"].includes(clean)) return "fade-right";
    if (["zoom-in", "zoomin", "zoom", "scale", "scale-up", "scaleup"].includes(clean)) return "zoom-in";
    if (["pop", "bounce", "bounce-in", "pulse"].includes(clean)) return "pop";
    if (["flip-up", "flipup", "flip"].includes(clean)) return "flip-up";
    if (["glow", "shimmer"].includes(clean)) return "glow";
    return clean.slice(0, 30);
  }

  function normalizeTransitionName(raw) {
    if (!raw || typeof raw !== "string") return "fade";
    const clean = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (["slide", "push", "move"].includes(clean)) return "slide";
    if (["zoom", "scale"].includes(clean)) return "zoom";
    if (["flip", "rotate"].includes(clean)) return "flip";
    if (["wipe"].includes(clean)) return "wipe";
    return "fade";
  }

  function normalizeTimingValue(val) {
    if (val === null || val === undefined || val === "") return "";
    if (typeof val === "number") return `${val}ms`;
    const str = String(val).trim();
    if (/^\d+$/.test(str)) return `${str}ms`;
    if (/^\d+(?:\.\d+)?(?:ms|s)$/i.test(str)) return str;
    return "";
  }

  function normalizeCardObject(obj, fallbackTitle = "Feature") {
    if (!obj || typeof obj !== "object") return { title: fallbackTitle, desc: "", color: "", icon: "diamond", badge: "", price: "", features: [], colSpan: 1, minHeight: "", width: "", height: "", effect: "", delay: "", duration: "" };
    const title = obj.title || obj.heading || obj.card || obj.name || fallbackTitle;
    let desc = obj.desc || obj.description || obj.body || obj.text || obj.detail || "";
    const color = obj.color || obj.indicatorColor || obj.indicator || obj.accent || "";
    const icon = obj.icon || "diamond";
    const badge = obj.badge && obj.badge !== "null" ? String(obj.badge).trim() : "";
    const price = obj.price ? String(obj.price).trim() : "";
    const features = Array.isArray(obj.features) ? obj.features : (Array.isArray(obj.items) ? obj.items : []);
    const colSpan = Number(obj.colSpan || obj.span || 1) || 1;
    const minHeight = obj.minHeight || "";
    const width = obj.width || "";
    const height = obj.height || "";
    const rawEffect = String(obj.effect || obj.animation || obj.animate || obj.entrance || "").trim();
    const effect = normalizeEffectName(rawEffect);
    const delay = normalizeTimingValue(obj.delay ?? obj.animationDelay);
    const duration = normalizeTimingValue(obj.duration ?? obj.animationDuration);

    if (!desc && price) {
      desc = price;
    }
    if (!desc && features.length) {
      desc = features.join(" • ");
    } else if (desc && features.length && !desc.includes(features[0])) {
      desc += " • " + features.join(" • ");
    }

    return { title, desc, color, icon, badge, price, features, colSpan, minHeight, width, height, effect, delay, duration };
  }

  function normalizeStatObject(obj) {
    if (!obj || typeof obj !== "object") return { value: "", label: "", effect: "", delay: "", duration: "" };
    const value = String(obj.value ?? obj.val ?? obj.stat ?? obj.metric ?? obj.kpi ?? obj.number ?? "");
    const label = String(obj.label ?? obj.lbl ?? obj.title ?? obj.name ?? obj.desc ?? "");
    const rawEffect = String(obj.effect || obj.animation || obj.animate || "").trim();
    const effect = normalizeEffectName(rawEffect);
    const delay = normalizeTimingValue(obj.delay ?? obj.animationDelay);
    const duration = normalizeTimingValue(obj.duration ?? obj.animationDuration);
    return { value, label, effect, delay, duration };
  }

  function parseJsonDeck(text) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        const cleaned = cleanJsonString(text);
        parsed = JSON.parse(cleaned);
      } catch {}
    }

    // If whole JSON parsing failed, try extracting individual slide objects directly
    if (!parsed || (typeof parsed !== "object")) {
      const fallbackSlides = extractSlideObjectsFallback(text);
      if (fallbackSlides.length) {
        parsed = { slides: fallbackSlides };
      }
    }

    if (!parsed || (typeof parsed !== "object")) return null;

    let rawSlides = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.slides)
          ? parsed.slides
          : (Array.isArray(parsed.deck)
              ? parsed.deck
              : (Array.isArray(parsed.presentation)
                  ? parsed.presentation
                  : (Array.isArray(parsed.pages) ? parsed.pages : []))));

    if (!rawSlides.length) {
      const fallbackSlides = extractSlideObjectsFallback(text);
      if (fallbackSlides.length) rawSlides = fallbackSlides;
    }

    if (!rawSlides.length && !parsed.title && !parsed.theme) return null;

    const rawThemeName = parsed.theme || parsed.themeName || parsed.style || rawSlides[0]?.theme || "vibrant";
    const deckThemeName = typeof rawThemeName === "string" ? rawThemeName : (rawThemeName?.id || "vibrant");
    const deckColors = parsed.colors || parsed.palette || {};
    const resolvedDeckTheme = resolveTheme(deckThemeName, deckColors);

    const deckTitle = parsed.title || parsed.deckTitle || parsed.name || rawSlides[0]?.title || rawSlides[0]?.headline || rawSlides[0]?.heading || "Presentation";
    const deckSubtitle = parsed.subtitle || parsed.slides?.[0]?.subtitle || rawSlides[0]?.subheading || "";

    const slides = rawSlides.map((slide, index) => {
      const slideColors = slide.colors || {};
      const slideTheme = resolveTheme(slide.theme || deckThemeName, { ...deckColors, ...slideColors });
      const rawTitle = slide.title || slide.headline || slide.heading || (index === 0 ? deckTitle : `Slide ${index + 1}`);
      const sTitle = cleanSlideTitle(rawTitle);
      const sSubtitle = slide.subtitle || slide.subheading || (index === 0 ? deckSubtitle : "");

      const rawCards = Array.isArray(slide.cards) ? slide.cards : (Array.isArray(slide.features) ? slide.features : []);
      const cards = rawCards.map((c, cIdx) => normalizeCardObject(c, c.title || c.heading || `Feature ${cIdx + 1}`));

      const rawStats = Array.isArray(slide.stats) ? slide.stats : (Array.isArray(slide.metrics) ? slide.metrics : (Array.isArray(slide.kpis) ? slide.kpis : []));
      const stats = rawStats.map((st) => normalizeStatObject(st));

      const rawSteps = Array.isArray(slide.timeline) ? slide.timeline : (Array.isArray(slide.steps) ? slide.steps : (Array.isArray(slide.process) ? slide.process : (Array.isArray(slide.roadmap) ? slide.roadmap : [])));
      const timeline = rawSteps.map((st, sIdx) => ({
        step: String(st.step ?? st.number ?? st.num ?? (sIdx < 9 ? `0${sIdx + 1}` : sIdx + 1)),
        title: st.title || st.name || "",
        desc: st.desc || st.description || st.text || "",
        effect: normalizeEffectName(st.effect || st.animation || st.animate || ""),
        delay: normalizeTimingValue(st.delay ?? st.animationDelay),
        duration: normalizeTimingValue(st.duration ?? st.animationDuration)
      }));

      let col1 = slide.col1 || null;
      let col2 = slide.col2 || null;
      if (!col1 && slide.left && typeof slide.left === "object") {
        col1 = {
          title: slide.left.title || slide.left.heading || "Column 1",
          items: Array.isArray(slide.left.items) ? slide.left.items : (Array.isArray(slide.left.bullets) ? slide.left.bullets : [])
        };
      }
      if (!col2 && slide.right && typeof slide.right === "object") {
        col2 = {
          title: slide.right.title || slide.right.heading || "Column 2",
          items: Array.isArray(slide.right.items) ? slide.right.items : (Array.isArray(slide.right.bullets) ? slide.right.bullets : [])
        };
      }
      if (!col1 && (slide.leftTitle || slide.leftBullets || slide.leftItems)) {
        col1 = {
          title: slide.leftTitle || "Column 1",
          items: Array.isArray(slide.leftBullets) ? slide.leftBullets : (Array.isArray(slide.leftItems) ? slide.leftItems : [])
        };
      }
      if (!col2 && (slide.rightTitle || slide.rightBullets || slide.rightItems)) {
        col2 = {
          title: slide.rightTitle || "Column 2",
          items: Array.isArray(slide.rightBullets) ? slide.rightBullets : (Array.isArray(slide.rightItems) ? slide.rightItems : [])
        };
      }

      let bullets = [];
      if (Array.isArray(slide.bullets)) bullets = slide.bullets;
      else if (Array.isArray(slide.items)) bullets = slide.items;
      else if (Array.isArray(slide.rows)) {
        bullets = slide.rows.map((r) => {
          if (typeof r === "string") return r;
          if (r && typeof r === "object") {
            const lead = r.lead || r.title || r.label || "";
            const detail = r.detail || r.desc || r.description || r.text || "";
            return lead ? `${lead}: ${detail}` : detail;
          }
          return String(r ?? "");
        });
      }

      const rawLayout = slide.layout || "";
      const sLayout = rawLayout || (index === 0 ? "title" : (cards.length ? "cards" : (stats.length ? "stats" : (timeline.length ? "timeline" : (col1 && col2 ? "two-column" : (slide.quote ? "quote" : "bullets"))))));

      const cols = Number(slide.cols || slide.columns || (slide.grid ? parseInt(slide.grid, 10) : null)) || null;
      const rawSlideTrans = slide.transition || slide.trans || parsed.transition || parsed.trans || "";
      const sTransition = normalizeTransitionName(rawSlideTrans);
      const rawSlideEffect = slide.effect || slide.animation || slide.animate || "";
      const sEffect = normalizeEffectName(rawSlideEffect);

      return {
        layout: sLayout,
        title: sTitle,
        subtitle: sSubtitle,
        kicker: slide.kicker || slide.badge || slide.category || "",
        badge: slide.badge || slide.kicker || "",
        cards,
        stats,
        timeline,
        bullets,
        col1,
        col2,
        cols,
        grid: slide.grid || "",
        cardWidth: slide.cardWidth || "",
        cardHeight: slide.cardHeight || "",
        quote: slide.quote || slide.testimonial || "",
        author: slide.author || slide.citation || "",
        notes: slide.notes || slide.speakerNotes || slide.presenterNotes || "",
        theme: slideTheme,
        transition: sTransition,
        effect: sEffect,
        background: slide.background || slide.bg || slideTheme.bgCss
      };
    });

    const deckTransition = normalizeTransitionName(parsed.transition || parsed.trans || "");

    return {
      title: deckTitle,
      subtitle: deckSubtitle,
      theme: resolvedDeckTheme.id,
      themeObj: resolvedDeckTheme,
      transition: deckTransition,
      aspectRatio: "16:9",
      slides: slides.length ? slides : [{ layout: "title", title: deckTitle, subtitle: deckSubtitle, notes: "", theme: resolvedDeckTheme, transition: deckTransition, effect: "", background: resolvedDeckTheme.bgCss }]
    };
  }

  function parseYamlDeck(text) {
    if (!/\bslides:\s*$/m.test(text) && !/^[ ]{0,4}-\s+layout:\s*/m.test(text)) return null;

    let deckTheme = "vibrant";
    let deckTitle = "Presentation";
    let deckSubtitle = "";
    const deckColors = {};

    const slidesIdx = text.search(/^slides:\s*$/m);
    let headerText = slidesIdx !== -1 ? text.slice(0, slidesIdx) : "";
    let slidesText = slidesIdx !== -1 ? text.slice(slidesIdx + text.slice(slidesIdx).indexOf("\n") + 1) : text;

    for (const line of headerText.split("\n")) {
      const trimmed = line.trim();
      if (/^theme:\s*["']?([^"'\n]+)/i.test(trimmed)) {
        deckTheme = trimmed.match(/^theme:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
      } else if (/^title:\s*["']?([^"'\n]+)/i.test(trimmed)) {
        deckTitle = trimmed.match(/^title:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
      } else if (/^subtitle:\s*["']?([^"'\n]+)/i.test(trimmed)) {
        deckSubtitle = trimmed.match(/^subtitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
      } else if (/^(?:primary|accentCoral|accentTeal|accentColor|accent|bgLight|bgDark|bg|background|textColor|text):\s*["']?([^"'\n]+)/i.test(trimmed)) {
        const m = trimmed.match(/^([a-zA-Z0-9_]+):\s*["']?([^"'\n]+)/i);
        if (m) deckColors[m[1]] = m[2].trim();
      }
    }

    const slideChunks = slidesText.split(/\n(?=[ ]{0,4}-\s+(?:layout|title|headline|kicker|badge|cards|stats|timeline|quote|bullets)\s*:)/i);
    const slides = [];

    for (const chunk of slideChunks) {
      const trimmedChunk = chunk.trim().replace(/^[ ]{0,4}-\s+/, "");
      if (!trimmedChunk) continue;

      const lines = trimmedChunk.split("\n");
      let layout = "";
      let title = "";
      let subtitle = "";
      let kicker = "";
      let notes = "";
      let quote = "";
      let author = "";
      let col1Title = "Column 1";
      let col2Title = "Column 2";
      const slideColors = {};
      let slideBg = "";
      const cards = [];
      const stats = [];
      const timeline = [];
      const bullets = [];
      const leftBullets = [];
      const rightBullets = [];
      let slideTransition = "";
      let slideEffect = "";

      let currentSection = null;
      let currentItem = null;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        if (/^layout:\s*["']?([^"'\n]+)/i.test(line)) {
          layout = line.match(/^layout:\s*["']?([^"'\n]+)/i)[1].trim().toLowerCase();
          currentSection = null;
        } else if (!currentSection && /^(?:transition|trans):\s*["']?([^"'\n]+)/i.test(line)) {
          slideTransition = normalizeTransitionName(line.match(/^(?:transition|trans):\s*["']?([^"'\n]+)/i)[1]);
        } else if (!currentSection && /^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i.test(line)) {
          slideEffect = normalizeEffectName(line.match(/^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i)[1]);
        } else if (!currentSection && /^(?:title|headline|heading):\s*["']?([^"'\n]+)/i.test(line)) {
          title = cleanSlideTitle(line.match(/^(?:title|headline|heading):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, ""));
        } else if (!currentSection && /^subtitle:\s*["']?([^"'\n]+)/i.test(line)) {
          subtitle = line.match(/^subtitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
        } else if (!currentSection && /^(?:kicker|badge|category):\s*["']?([^"'\n]+)/i.test(line)) {
          kicker = line.match(/^(?:kicker|badge|category):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
        } else if (/^notes?:\s*(?:>|\|)?\s*(.*)/i.test(line)) {
          const noteMatch = line.match(/^notes?:\s*(?:>|\|)?\s*(.*)/i);
          notes = (noteMatch[1] || "").trim();
          currentSection = "notes";
        } else if (/^quote:\s*["']?([^"'\n]+)/i.test(line)) {
          quote = line.match(/^quote:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          currentSection = null;
        } else if (/^(?:author|citation|attribution):\s*["']?([^"'\n]+)/i.test(line)) {
          author = line.match(/^(?:author|citation|attribution):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          currentSection = null;
        } else if (/^leftTitle:\s*["']?([^"'\n]+)/i.test(line)) {
          col1Title = line.match(/^leftTitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          currentSection = null;
        } else if (/^rightTitle:\s*["']?([^"'\n]+)/i.test(line)) {
          col2Title = line.match(/^rightTitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          currentSection = null;
        } else if (/^(?:cards|features):\s*$/i.test(line)) {
          currentSection = "cards";
          currentItem = null;
        } else if (/^(?:stats|metrics|kpis):\s*$/i.test(line)) {
          currentSection = "stats";
          currentItem = null;
        } else if (/^(?:timeline|steps|process|roadmap):\s*$/i.test(line)) {
          currentSection = "timeline";
          currentItem = null;
        } else if (/^(?:bullets|items|rows|points):\s*$/i.test(line)) {
          currentSection = "bullets";
        } else if (/^(?:leftBullets|leftItems|left|col1):\s*$/i.test(line)) {
          currentSection = "leftBullets";
        } else if (/^(?:rightBullets|rightItems|right|col2):\s*$/i.test(line)) {
          currentSection = "rightBullets";
        } else if (currentSection === "cards") {
          const isBullet = /^[-*+]\s+/.test(line);
          const inline = extractInlineKeyValuePairs(line);
          const isMulti = inline && Object.keys(inline).length > 1;

          if ((isBullet || isMulti) && inline && (inline.title || inline.name || inline.heading || inline.card || inline.indicator || inline.desc || inline.description || inline.price || inline.features)) {
            currentItem = normalizeCardObject(inline, `Feature ${cards.length + 1}`);
            cards.push(currentItem);
          } else if (/^-\s*(?:title|heading|card):\s*["']?([^"'\n]+)/i.test(line)) {
            const t = line.match(/^-\s*(?:title|heading|card):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            currentItem = { title: t, desc: "", color: "", badge: "", price: "", features: [] };
            cards.push(currentItem);
          } else if (/^-\s*["']?([^"':\n]+)["']?:\s*(.*)/.test(line)) {
            const m = line.match(/^-\s*["']?([^"':\n]+)["']?:\s*(.*)/);
            currentItem = { title: m[1].trim(), desc: m[2].trim().replace(/^["']|["']$/g, ""), color: "", badge: "", price: "", features: [] };
            cards.push(currentItem);
          } else if (currentItem && /^(?:desc|description|body|text):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.desc = line.match(/^(?:desc|description|body|text):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:indicatorColor|indicator|color|accent):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.color = line.match(/^(?:indicatorColor|indicator|color|accent):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:price):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.price = line.match(/^(?:price):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:badge):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.badge = line.match(/^(?:badge):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:title|name):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.title = line.match(/^(?:title|name):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.effect = normalizeEffectName(line.match(/^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i)[1]);
          } else if (currentItem && /^(?:delay):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.delay = normalizeTimingValue(line.match(/^(?:delay):\s*["']?([^"'\n]+)/i)[1]);
          } else if (currentItem && /^(?:duration):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.duration = normalizeTimingValue(line.match(/^(?:duration):\s*["']?([^"'\n]+)/i)[1]);
          }
        } else if (currentSection === "stats") {
          const isBullet = /^[-*+]\s+/.test(line);
          const inline = extractInlineKeyValuePairs(line);
          const isMulti = inline && Object.keys(inline).length > 1;

          if ((isBullet || isMulti) && inline && (inline.value || inline.val || inline.stat || inline.metric || inline.label || inline.lbl)) {
            currentItem = normalizeStatObject(inline);
            stats.push(currentItem);
          } else if (/^-\s*(?:value|val|stat|metric):\s*["']?([^"'\n]+)/i.test(line)) {
            const v = line.match(/^-\s*(?:value|val|stat|metric):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            currentItem = { value: v, label: "" };
            stats.push(currentItem);
          } else if (currentItem && /^(?:label|lbl|title|name|desc):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.label = line.match(/^(?:label|lbl|title|name|desc):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          }
        } else if (currentSection === "timeline") {
          const isBullet = /^[-*+]\s+/.test(line);
          const inline = extractInlineKeyValuePairs(line);
          const isMulti = inline && Object.keys(inline).length > 1;

          if ((isBullet || isMulti) && inline && (inline.step || inline.title || inline.desc || inline.description)) {
            currentItem = {
              step: String(inline.step || inline.num || (timeline.length + 1)),
              title: inline.title || inline.name || `Step ${timeline.length + 1}`,
              desc: inline.desc || inline.description || inline.text || "",
              effect: normalizeEffectName(inline.effect || inline.animation || ""),
              delay: normalizeTimingValue(inline.delay),
              duration: normalizeTimingValue(inline.duration)
            };
            timeline.push(currentItem);
          } else if (/^-\s*(?:step|number|phase):\s*["']?([^"'\n]+)/i.test(line)) {
            const s = line.match(/^-\s*(?:step|number|phase):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            currentItem = { step: s, title: "", desc: "", effect: "", delay: "", duration: "" };
            timeline.push(currentItem);
          } else if (currentItem && /^(?:title|name):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.title = line.match(/^(?:title|name):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          } else if (currentItem && /^(?:desc|description|text):\s*["']?([^"'\n]+)/i.test(line)) {
            currentItem.desc = line.match(/^(?:desc|description|text):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          }
        } else if (currentSection === "bullets" && /^[-*+]\s+(.*)/.test(line)) {
          bullets.push(line.replace(/^[-*+]\s+/, "").trim());
        } else if (currentSection === "leftBullets" && /^[-*+]\s+(.*)/.test(line)) {
          leftBullets.push(line.replace(/^[-*+]\s+/, "").trim());
        } else if (currentSection === "rightBullets" && /^[-*+]\s+(.*)/.test(line)) {
          rightBullets.push(line.replace(/^[-*+]\s+/, "").trim());
        } else if (currentSection === "notes") {
          notes += (notes ? " " : "") + line;
        }
      }

      if (!layout) {
        if (cards.length) layout = "cards";
        else if (stats.length) layout = "stats";
        else if (timeline.length) layout = "timeline";
        else if (quote) layout = "quote";
        else if (leftBullets.length && rightBullets.length) layout = "two-column";
        else if (slides.length === 0 && !bullets.length) layout = "title";
        else layout = "bullets";
      }

      const slideTheme = resolveTheme(deckTheme, { ...deckColors, ...slideColors });

      slides.push({
        layout,
        title: title || (slides.length === 0 ? deckTitle : `Slide ${slides.length + 1}`),
        subtitle,
        kicker,
        badge: kicker,
        cards,
        stats,
        timeline,
        bullets,
        col1: leftBullets.length ? { title: col1Title, items: leftBullets } : null,
        col2: rightBullets.length ? { title: col2Title, items: rightBullets } : null,
        quote,
        author,
        notes,
        theme: slideTheme,
        transition: slideTransition || "fade",
        effect: slideEffect || "",
        background: slideBg ? cleanColorCss(slideBg) : slideTheme.bgCss
      });
    }

    if (deckTitle === "Presentation" && slides[0]?.title) {
      deckTitle = slides[0].title;
    }

    const finalDeckTheme = resolveTheme(deckTheme, deckColors);

    return {
      title: deckTitle,
      subtitle: deckSubtitle,
      theme: finalDeckTheme.id,
      themeObj: finalDeckTheme,
      aspectRatio: "16:9",
      slides: slides.length ? slides : [{ layout: "title", title: deckTitle, subtitle: deckSubtitle, notes: "", theme: finalDeckTheme, background: finalDeckTheme.bgCss }]
    };
  }

  function parseMarkdownDeck(text) {
    let rawText = text.trim();
    if (rawText.startsWith("{") || rawText.startsWith("[")) {
      const recovered = parseJsonDeck(rawText);
      if (recovered && recovered.slides.length) return recovered;
    }
    let deckTitle = "Presentation";
    let deckSubtitle = "";
    let deckThemeName = "vibrant";
    let deckTransition = "fade";
    const deckColors = {};

    // 1. Strip YAML frontmatter at the very beginning
    const frontmatterMatch = rawText.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
    if (frontmatterMatch) {
      const fmLines = frontmatterMatch[1].split(/\r?\n/);
      for (const line of fmLines) {
        const trimmed = line.trim();
        if (/^theme:\s*["']?([^"'\n]+)/i.test(trimmed)) {
          deckThemeName = trimmed.match(/^theme:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
        } else if (/^title:\s*["']?([^"'\n]+)/i.test(trimmed)) {
          deckTitle = trimmed.match(/^title:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
        } else if (/^subtitle:\s*["']?([^"'\n]+)/i.test(trimmed)) {
          deckSubtitle = trimmed.match(/^subtitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
        } else if (/^(?:transition|trans):\s*["']?([^"'\n]+)/i.test(trimmed)) {
          deckTransition = normalizeTransitionName(trimmed.match(/^(?:transition|trans):\s*["']?([^"'\n]+)/i)[1]);
        } else if (/^(?:primary|accentCoral|accentTeal|accentColor|accent|bgLight|bgDark|bg|background|textColor|text):\s*["']?([^"'\n]+)/i.test(trimmed)) {
          const m = trimmed.match(/^([a-zA-Z0-9_]+):\s*["']?([^"'\n]+)/i);
          if (m) deckColors[m[1]] = m[2].trim();
        }
      }
      rawText = rawText.slice(frontmatterMatch[0].length).trim();
    }

    // 2. Split chunks
    let rawChunks = rawText.split(/(?:\r?\n|^)\s*(?:---|---slide---|={3,}|\*{3,}|_{3,}|<hr\s*\/?>)\s*(?:\r?\n|$)/).map((c) => c.trim()).filter(Boolean);

    // If only 1 chunk was found, see if slides are split by slide headers
    if (rawChunks.length <= 1) {
      const headerSplit = rawText.split(/(?:\r?\n|^)(?=(?:#+\s*(?:Slide\s+\d+|[A-Z0-9])|\bSlide\s+\d+[:.]))/im).map((c) => c.trim()).filter(Boolean);
      if (headerSplit.length > 1) {
        rawChunks = headerSplit;
      }
    }

    const slides = [];

    rawChunks.forEach((chunk, chunkIndex) => {
      const rawLines = chunk.split(/\r?\n/);
      const lines = [];

      for (const rawLine of rawLines) {
        const cleaned = stripComments(rawLine);
        if (cleaned) lines.push(cleaned);
      }
      if (!lines.length) return;

      let slideTitle = "";
      let slideSubtitle = "";
      let slideKicker = "";
      let slideBadge = "";
      let slideLayout = "";
      let slideBackground = "";
      const slideColors = {};
      let notes = "";
      let slideTransition = "";
      let slideEffect = "";

      const cards = [];
      let currentCard = null;

      const stats = [];
      let currentStat = null;
      const timeline = [];
      const bullets = [];
      const col1Items = [];
      const col2Items = [];
      let currentCol = null;
      let currentSection = null;
      let col1Title = "Column 1";
      let col2Title = "Column 2";
      let quoteText = "";
      let quoteAuthor = "";

      let inNotes = false;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        // Speaker notes
        if (/^notes?:\s*(?:>|\|)?/i.test(line)) {
          inNotes = true;
          const inlineNote = line.replace(/^notes?:\s*(?:>|\|)?/i, "").trim();
          if (inlineNote) notes = inlineNote;
          continue;
        }

        if (inNotes) {
          if (/^[a-zA-Z0-9_-]+:\s*/.test(line) || line.startsWith("#")) {
            inNotes = false;
          } else {
            notes += (notes ? " " : "") + line.trim();
            continue;
          }
        }

        // Metadata
        if (/^\s*theme:\s*["']?([^"'\n]+)/i.test(line)) {
          const tName = line.match(/^\s*theme:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          if (chunkIndex === 0) deckThemeName = tName;
          continue;
        }

        if (/^\s*colors:\s*$/i.test(line)) continue;

        if (/^\s*(?:primary|accentCoral|accentTeal|accentColor|accent|bgLight|bgDark|bg|background|textColor|text):\s*["']?([^"'\n]+)/i.test(line)) {
          const match = line.match(/^\s*([a-zA-Z0-9_]+):\s*["']?([^"'\n]+)/i);
          if (match) {
            const key = match[1];
            const val = match[2].trim().replace(/^["']|["']$/g, "");
            if (chunkIndex === 0) deckColors[key] = val;
            slideColors[key] = val;
            if (key === "background" || key === "bg" || key === "bgLight" || key === "bgDark") {
              slideBackground = val;
            }
          }
          continue;
        }

        if (/^\s*layout:\s*["']?([a-zA-Z0-9_-]+)/i.test(line)) {
          slideLayout = line.match(/^\s*layout:\s*["']?([a-zA-Z0-9_-]+)/i)[1].trim().toLowerCase();
          continue;
        }

        if (!currentSection && /^\s*(?:transition|trans):\s*["']?([a-zA-Z0-9_-]+)/i.test(line)) {
          slideTransition = normalizeTransitionName(line.match(/^\s*(?:transition|trans):\s*["']?([a-zA-Z0-9_-]+)/i)[1]);
          if (chunkIndex === 0 && deckTransition === "fade") deckTransition = slideTransition;
          continue;
        }

        if (!currentSection && /^\s*(?:effect|animation|animate):\s*["']?([a-zA-Z0-9_-]+)/i.test(line)) {
          slideEffect = normalizeEffectName(line.match(/^\s*(?:effect|animation|animate):\s*["']?([a-zA-Z0-9_-]+)/i)[1]);
          continue;
        }

        if (/^\s*(?:badge|kicker|category):\s*["']?([^"'\n]+)/i.test(line)) {
          const val = line.match(/^\s*(?:badge|kicker|category):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          slideBadge = val;
          slideKicker = val;
          continue;
        }

        if (/^\s*subtitle:\s*["']?([^"'\n]+)/i.test(line)) {
          slideSubtitle = line.match(/^\s*subtitle:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
          if (chunkIndex === 0 && !deckSubtitle) deckSubtitle = slideSubtitle;
          continue;
        }

        if (/^\s*(?:title|headline|heading):\s*["']?([^"'\n]+)/i.test(line)) {
          const val = cleanSlideTitle(line.match(/^\s*(?:title|headline|heading):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, ""));
          slideTitle = val;
          if (chunkIndex === 0 && (deckTitle === "Presentation" || !deckTitle)) deckTitle = val;
          continue;
        }

        // Headings
        if (line.startsWith("# ")) {
          slideTitle = cleanSlideTitle(line.slice(2).trim());
          if (chunkIndex === 0 && deckTitle === "Presentation") deckTitle = slideTitle;
          continue;
        }

        if (line.startsWith("## ")) {
          const heading = line.slice(3).trim();
          if (!currentCol) {
            currentCol = 1;
            currentSection = "col1";
            col1Title = heading;
          } else {
            currentCol = 2;
            currentSection = "col2";
            col2Title = heading;
          }
          continue;
        }

        // Section / container transition lines
        if (/^\s*(?:cards|features):\s*$/i.test(line)) {
          currentSection = "cards";
          currentCard = null;
          if (!slideLayout) slideLayout = "cards";
          currentCol = null;
          continue;
        }

        if (/^\s*(?:stats|metrics|kpis):\s*$/i.test(line)) {
          currentSection = "stats";
          currentStat = null;
          if (!slideLayout) slideLayout = "stats";
          currentCol = null;
          continue;
        }

        if (/^\s*(?:timeline|steps|process|roadmap):\s*$/i.test(line)) {
          currentSection = "timeline";
          if (!slideLayout) slideLayout = "timeline";
          currentCol = null;
          continue;
        }

        if (/^\s*(?:two-column|two-columns|columns|split):\s*$/i.test(line)) {
          currentSection = "two-column";
          slideLayout = "two-column";
          continue;
        }

        if (/^\s*(?:left|col1|column1|left-column|left_column):\s*(.*)$/i.test(line)) {
          const tm = line.match(/^\s*(?:left|col1|column1|left-column|left_column):\s*(.*)$/i);
          if (tm && tm[1].trim()) col1Title = tm[1].trim().replace(/^["']|["']$/g, "");
          currentCol = 1;
          currentSection = "col1";
          slideLayout = "two-column";
          continue;
        }

        if (/^\s*(?:right|col2|column2|right-column|right_column):\s*(.*)$/i.test(line)) {
          const tm = line.match(/^\s*(?:right|col2|column2|right-column|right_column):\s*(.*)$/i);
          if (tm && tm[1].trim()) col2Title = tm[1].trim().replace(/^["']|["']$/g, "");
          currentCol = 2;
          currentSection = "col2";
          slideLayout = "two-column";
          continue;
        }

        if (/^\s*leftTitle:\s*(.+)$/i.test(line)) {
          col1Title = line.match(/^\s*leftTitle:\s*(.+)$/i)[1].trim().replace(/^["']|["']$/g, "");
          slideLayout = "two-column";
          continue;
        }

        if (/^\s*rightTitle:\s*(.+)$/i.test(line)) {
          col2Title = line.match(/^\s*rightTitle:\s*(.+)$/i)[1].trim().replace(/^["']|["']$/g, "");
          slideLayout = "two-column";
          continue;
        }

        if (/^\s*(?:content|items|bullets|points|list):\s*$/i.test(line)) {
          // Container wrapper, ignore!
          continue;
        }

        // Card items
        if (currentSection === "cards" || slideLayout === "cards") {
          const trimmedLine = line.trim();
          const isBullet = /^[-*+]\s+/.test(trimmedLine);
          const inline = extractInlineKeyValuePairs(trimmedLine);
          const isMulti = inline && Object.keys(inline).length > 1;

          if ((isBullet || isMulti) && inline && (inline.title || inline.name || inline.heading || inline.card || inline.indicator || inline.desc || inline.description || inline.price || inline.features)) {
            currentCard = normalizeCardObject(inline, `Feature ${cards.length + 1}`);
            cards.push(currentCard);
            continue;
          }
          if (/^[-*+]?\s*(?:card|\d+\.\s*card|title|heading):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            const cTitle = trimmedLine.match(/(?:card|\d+\.\s*card|title|heading):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            currentCard = { title: cTitle, desc: "", icon: "diamond", color: "", badge: "", price: "", features: [], effect: "", delay: "", duration: "" };
            cards.push(currentCard);
            continue;
          }
          if (currentCard && /^(?:desc|description|body|text|detail):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.desc = trimmedLine.match(/^(?:desc|description|body|text|detail):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            continue;
          }
          if (currentCard && /^icon:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.icon = trimmedLine.match(/^icon:\s*["']?([^"'\n]+)/i)[1].trim();
            continue;
          }
          if (currentCard && /^(?:color|indicatorColor|indicator|accent):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.color = trimmedLine.match(/^(?:color|indicatorColor|indicator|accent):\s*["']?([^"'\n]+)/i)[1].trim();
            continue;
          }
          if (currentCard && /^price:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.price = trimmedLine.match(/^price:\s*["']?([^"'\n]+)/i)[1].trim();
            continue;
          }
          if (currentCard && /^badge:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.badge = trimmedLine.match(/^badge:\s*["']?([^"'\n]+)/i)[1].trim();
            continue;
          }
          if (currentCard && /^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.effect = normalizeEffectName(trimmedLine.match(/^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
          if (currentCard && /^delay:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.delay = normalizeTimingValue(trimmedLine.match(/^delay:\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
          if (currentCard && /^duration:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentCard.duration = normalizeTimingValue(trimmedLine.match(/^duration:\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
        }

        // Stat items
        if (currentSection === "stats" || slideLayout === "stats") {
          const trimmedLine = line.trim();
          const isBullet = /^[-*+]\s+/.test(trimmedLine);
          const inline = extractInlineKeyValuePairs(trimmedLine);
          const isMulti = inline && Object.keys(inline).length > 1;

          if ((isBullet || isMulti) && inline && (inline.value || inline.val || inline.metric || inline.stat || inline.label || inline.lbl)) {
            currentStat = normalizeStatObject(inline);
            stats.push(currentStat);
            continue;
          }
          if (/^[-*+]?\s*(?:stat|value|val|metric):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            const sVal = trimmedLine.match(/(?:stat|value|val|metric):\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            currentStat = { value: sVal, label: "", effect: "", delay: "", duration: "" };
            stats.push(currentStat);
            continue;
          }
          if (stats.length && !stats[stats.length - 1].label && /^label:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            stats[stats.length - 1].label = trimmedLine.match(/^label:\s*["']?([^"'\n]+)/i)[1].trim().replace(/^["']|["']$/g, "");
            continue;
          }
          if (currentStat && /^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentStat.effect = normalizeEffectName(trimmedLine.match(/^(?:effect|animation|animate):\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
          if (currentStat && /^delay:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentStat.delay = normalizeTimingValue(trimmedLine.match(/^delay:\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
          if (currentStat && /^duration:\s*["']?([^"'\n]+)/i.test(trimmedLine)) {
            currentStat.duration = normalizeTimingValue(trimmedLine.match(/^duration:\s*["']?([^"'\n]+)/i)[1]);
            continue;
          }
        }

        // Markdown KPI style
        if (line.startsWith("### ")) {
          const content = line.slice(4).trim();
          if (/^[\d$%+><~xX-]+/.test(content)) {
            stats.push({ value: content, label: "" });
          } else if (stats.length && !stats[stats.length - 1].label) {
            stats[stats.length - 1].label = content;
          } else {
            currentCard = { title: content, desc: "", icon: "circle", color: "", badge: "", price: "", features: [] };
            cards.push(currentCard);
          }
          continue;
        }

        // Blockquotes
        if (line.startsWith("> ")) {
          quoteText = line.slice(2).trim();
          continue;
        }

        // Timeline step
        const timelineMatch = line.match(/^(\d+)\.\s+(?:step:)?\s*([^:]+)(?::\s*(.+))?/i);
        if (timelineMatch) {
          timeline.push({
            step: timelineMatch[1],
            title: timelineMatch[2].trim(),
            desc: timelineMatch[3]?.trim() || ""
          });
          continue;
        }

        // Bullets
        if (/^[-*+]\s+/.test(line)) {
          const item = line.replace(/^[-*+]\s+/, "").trim();
          if (currentCol === 1) col1Items.push(item);
          else if (currentCol === 2) col2Items.push(item);
          else if (currentCard && !currentCard.desc) currentCard.desc = item;
          else bullets.push(item);
          continue;
        }

        // Author attribution
        if (quoteText && !quoteAuthor && /^[-—]\s*(.+)/.test(line)) {
          quoteAuthor = line.replace(/^[-—]\s*/, "").trim();
          continue;
        }

        // Plain descriptive text
        if (!slideTitle) {
          slideTitle = cleanSlideTitle(line);
          if (chunkIndex === 0 && deckTitle === "Presentation") deckTitle = slideTitle;
        } else if (!slideSubtitle && chunkIndex === 0) {
          slideSubtitle = line;
          deckSubtitle = line;
        } else if (currentCard && !currentCard.desc) {
          currentCard.desc = line;
        } else if (stats.length && !stats[stats.length - 1].label) {
          stats[stats.length - 1].label = line;
        } else if (currentCol === 1) {
          col1Items.push(line);
        } else if (currentCol === 2) {
          col2Items.push(line);
        } else {
          bullets.push(line);
        }
      }

      // Check if chunk was just preamble metadata
      const hasContent = slideTitle || cards.length || stats.length || timeline.length || bullets.length || col1Items.length || col2Items.length || quoteText;
      if (!hasContent && chunkIndex === 0 && rawChunks.length > 1) {
        return;
      }

      if (slideLayout === "two-column") {
        if (!col1Items.length && !col2Items.length && bullets.length >= 2) {
          const mid = Math.ceil(bullets.length / 2);
          col1Items.push(...bullets.slice(0, mid));
          col2Items.push(...bullets.slice(mid));
          bullets.length = 0;
        } else if (col1Items.length >= 2 && !col2Items.length) {
          const mid = Math.ceil(col1Items.length / 2);
          const items = [...col1Items];
          col1Items.length = 0;
          col1Items.push(...items.slice(0, mid));
          col2Items.push(...items.slice(mid));
        } else if (!col1Items.length && col2Items.length >= 2) {
          const mid = Math.ceil(col2Items.length / 2);
          const items = [...col2Items];
          col2Items.length = 0;
          col1Items.push(...items.slice(0, mid));
          col2Items.push(...items.slice(mid));
        }
      }

      if (slideLayout === "cards" && !cards.length && bullets.length) {
        bullets.forEach((b, bIdx) => {
          const inline = extractInlineKeyValuePairs(b);
          if (inline && (inline.title || inline.name || inline.heading || inline.desc || inline.description || inline.indicator)) {
            cards.push(normalizeCardObject(inline, `Feature ${bIdx + 1}`));
            return;
          }
          const m = b.match(/^([^*:]+[:—-])\s*(.*)$/);
          if (m) {
            const rawTitle = m[1].replace(/[:—-\s]+$/, "").trim();
            if (!/^(?:cards|features|indicator|title|desc|description)$/i.test(rawTitle)) {
              cards.push({ title: rawTitle, desc: m[2].trim(), icon: "diamond", color: "", badge: "", price: "", features: [] });
              return;
            }
          }
          cards.push({ title: `Feature ${bIdx + 1}`, desc: b.trim(), icon: "diamond", color: "", badge: "", price: "", features: [] });
        });
        bullets.length = 0;
      }

      if (slideLayout === "stats" && !stats.length && bullets.length) {
        bullets.forEach((b) => {
          const inline = extractInlineKeyValuePairs(b);
          if (inline && (inline.value || inline.val || inline.stat || inline.metric || inline.label || inline.lbl)) {
            stats.push(normalizeStatObject(inline));
            return;
          }
          const m = b.match(/^([^*:]+[:—-])\s*(.*)$/);
          if (m) {
            const rawVal = m[1].replace(/[:—-\s]+$/, "").trim();
            if (!/^(?:stats|metrics|kpis|value|val|stat|metric|label|lbl)$/i.test(rawVal)) {
              stats.push({ value: rawVal, label: m[2].trim() });
              return;
            }
          }
          stats.push({ value: b.trim(), label: "" });
        });
        bullets.length = 0;
      }

      if (slideLayout === "timeline" && !timeline.length && bullets.length) {
        bullets.forEach((b, bIdx) => {
          const m = b.match(/^([^*:]+[:—-])\s*(.*)$/);
          timeline.push({
            step: String(bIdx + 1).padStart(2, "0"),
            title: m ? m[1].replace(/[:—-\s]+$/, "").trim() : `Step ${bIdx + 1}`,
            desc: m ? m[2].trim() : b.trim()
          });
        });
        bullets.length = 0;
      }

      let finalLayout = slideLayout;
      if (!finalLayout) {
        if (cards.length >= 2) finalLayout = "cards";
        else if (stats.length >= 2) finalLayout = "stats";
        else if (timeline.length >= 2) finalLayout = "timeline";
        else if (quoteText) finalLayout = "quote";
        else if (col1Items.length && col2Items.length) finalLayout = "two-column";
        else if (slides.length === 0 && !bullets.length && !cards.length && !stats.length) finalLayout = "title";
        else finalLayout = "bullets";
      }

      // Contextual title heuristics for two-column
      if (finalLayout === "two-column" && col1Title === "Column 1" && col2Title === "Column 2") {
        const c1 = col1Items.join(" ").toLowerCase();
        const c2 = col2Items.join(" ").toLowerCase();
        if (/(?:ceo|cto|cfo|founder|vp|head of|lead)/i.test(c1)) {
          col1Title = "Leadership";
          if (/(?:value|principle|mission|obsession|transparency)/i.test(c2)) {
            col2Title = "Values";
          }
        } else if (/(?:problem|challenge|pain|legacy|issue|disconnected|recreating|slow|manual)/i.test(c1) &&
                   /(?:solution|unified|integrated|native|smart|auto|single source|truth)/i.test(c2)) {
          col1Title = "Current Challenges";
          col2Title = "Vela Solution";
        }
      }

      const mergedTheme = resolveTheme(deckThemeName, { ...deckColors, ...slideColors });

      slides.push({
        layout: finalLayout,
        title: slideTitle || (slides.length === 0 ? deckTitle : `Slide ${slides.length + 1}`),
        subtitle: slideSubtitle,
        kicker: slideKicker || slideBadge,
        badge: slideBadge || slideKicker,
        cards,
        stats,
        timeline,
        bullets,
        col1: (col1Items.length || finalLayout === "two-column") ? { title: col1Title, items: col1Items } : null,
        col2: (col2Items.length || finalLayout === "two-column") ? { title: col2Title, items: col2Items } : null,
        quote: quoteText,
        author: quoteAuthor,
        notes,
        theme: mergedTheme,
        transition: slideTransition || deckTransition || "fade",
        effect: slideEffect || "",
        background: slideBackground ? cleanColorCss(slideBackground) : mergedTheme.bgCss
      });
    });

    if (deckTitle === "Presentation" && slides[0]?.title) {
      deckTitle = slides[0].title;
    }

    const finalDeckTheme = resolveTheme(deckThemeName, deckColors);

    return {
      title: deckTitle,
      subtitle: deckSubtitle,
      theme: finalDeckTheme.id,
      themeObj: finalDeckTheme,
      transition: deckTransition || "fade",
      aspectRatio: "16:9",
      slides: slides.length ? slides : [{ layout: "title", title: deckTitle, subtitle: deckSubtitle, notes: "", theme: finalDeckTheme, transition: deckTransition || "fade", effect: "", background: finalDeckTheme.bgCss }]
    };
  }

  // Parse structured JSON, YAML, or rich Markdown presentation into slide models
  function parsePresentation(source) {
    if (typeof source === "object" && source !== null) {
      try {
        const jsonText = JSON.stringify(source);
        const parsed = parseJsonDeck(jsonText);
        if (parsed) return parsed;
      } catch {}
    }
    const text = String(source ?? "").trim();
    if (!text) {
      const th = resolveTheme("vibrant");
      return {
        title: "Presentation",
        subtitle: "",
        theme: th.id,
        themeObj: th,
        aspectRatio: "16:9",
        slides: [{ layout: "title", title: "Untitled Presentation", subtitle: "Created with Vela", notes: "", theme: th, background: th.bgCss }]
      };
    }

    // 1. Resilient JSON deck
    const jsonDeck = parseJsonDeck(text);
    if (jsonDeck) return jsonDeck;

    // 2. Structured YAML deck
    const yamlDeck = parseYamlDeck(text);
    if (yamlDeck) return yamlDeck;

    // 3. Rich Markdown deck with slide separators / headers
    return parseMarkdownDeck(text);
  }

  // Compile presentation deck into full ECMA-376 OpenXML .pptx ZIP archive
  function buildPptx(deckInput) {
    const deck = typeof deckInput === "object" && deckInput !== null ? deckInput : parsePresentation(String(deckInput || ""));
    const theme = deck.themeObj || (typeof deck.theme === "object" && deck.theme !== null ? deck.theme : resolveTheme(deck.theme, deck.colors || {}));
    const slides = Array.isArray(deck.slides) && deck.slides.length ? deck.slides : [{ layout: "title", title: deck.title || "Presentation", theme }];

    const files = [];

    // 1. [Content_Types].xml
    const slideOverrides = slides
      .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
      .join("\n  ");

    files.push({
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  ${slideOverrides}
</Types>`
    });

    // 2. _rels/.rels
    files.push({
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
    });

    // 3. docProps/core.xml
    const nowIso = new Date().toISOString();
    files.push({
      path: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(deck.title || "Presentation")}</dc:title>
  <dc:creator>Vela Intelligence Workspace</dc:creator>
  <cp:lastModifiedBy>Vela Intelligence Workspace</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`
    });

    // 4. ppt/presentation.xml (16:9 widescreen: cx="12192000" cy="6858000")
    const sldIdEntries = slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
      .join("\n    ");

    files.push({
      path: "ppt/presentation.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    ${sldIdEntries}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`
    });

    // 5. ppt/_rels/presentation.xml.rels
    const slideRels = slides
      .map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
      .join("\n  ");

    files.push({
      path: "ppt/_rels/presentation.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`
    });

    // 6. ppt/slideMasters/slideMaster1.xml
    files.push({
      path: "ppt/slideMasters/slideMaster1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
    });

    // 7. ppt/slideMasters/_rels/slideMaster1.xml.rels
    files.push({
      path: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
    });

    // 8. ppt/slideLayouts/slideLayout1.xml
    files.push({
      path: "ppt/slideLayouts/slideLayout1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMap/></p:clrMapOvr>
</p:sldLayout>`
    });

    // 9. ppt/slideLayouts/_rels/slideLayout1.xml.rels
    files.push({
      path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
    });

    // 10. ppt/theme/theme1.xml
    files.push({
      path: "ppt/theme/theme1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Vela Widescreen Theme">
  <a:themeElements>
    <a:clrScheme name="Vela Palette">
      <a:dk1><a:srgbClr val="${theme.text}"/></a:dk1>
      <a:lt1><a:srgbClr val="${theme.bg}"/></a:lt1>
      <a:dk2><a:srgbClr val="${theme.cardBg}"/></a:dk2>
      <a:lt2><a:srgbClr val="${theme.cardBorder}"/></a:lt2>
      <a:accent1><a:srgbClr val="${theme.accent}"/></a:accent1>
      <a:accent2><a:srgbClr val="${theme.accent2 || '0D9488'}"/></a:accent2>
      <a:accent3><a:srgbClr val="${theme.primary || '4338CA'}"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="8B5CF6"/></a:accent5>
      <a:accent6><a:srgbClr val="10B981"/></a:accent6>
      <a:hlink><a:srgbClr val="${theme.accent}"/></a:hlink>
      <a:folHlink><a:srgbClr val="${theme.muted}"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Vela Modern Fonts">
      <a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Vela Format Scheme">
      <a:fillStyleLst><a:solidFill><a:srgbClr val="${theme.cardBg}"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:srgbClr val="${theme.cardBorder}"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:srgbClr val="${theme.bg}"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
    });

    // 11. Individual Slide Files
    slides.forEach((slide, index) => {
      const slideNum = index + 1;
      const sTheme = slide.theme || theme;
      let spId = 2;

      // Slide Background Rectangle
      let shapesXml = `
        <p:sp>
          <p:nvSpPr><p:cNvPr id="${spId++}" name="SlideBackground"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="${sTheme.bg}"/></a:solidFill>
          </p:spPr>
        </p:sp>
      `;

      if (slide.layout === "title") {
        // Title Slide: Hero Badge, Headline, Subtitle
        if (slide.badge || slide.kicker) {
          shapesXml += `
            <p:sp>
              <p:nvSpPr><p:cNvPr id="${spId++}" name="HeroBadge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="4096000" y="1600000"/><a:ext cx="4000000" cy="500000"/></a:xfrm>
                <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>
                <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
                <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:ln>
              </p:spPr>
              <p:txBody>
                <a:bodyPr anchor="ctr"/>
                <a:lstStyle/>
                <a:p>
                  <a:pPr algn="ctr"/>
                  <a:r>
                    <a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr>
                    <a:t>${escapeXml((slide.badge || slide.kicker).toUpperCase())}</a:t>
                  </a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          `;
        }

        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="HeroTitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="1000000" y="2400000"/><a:ext cx="10192000" cy="1800000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="ctr"/>
              <a:lstStyle/>
              <a:p>
                <a:pPr algn="ctr"/>
                <a:r>
                  <a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr>
                  <a:t>${escapeXml(slide.title)}</a:t>
                </a:r>
              </a:p>
              ${slide.subtitle ? `
              <a:p>
                <a:pPr algn="ctr"><a:spcBfr><a:spcPts val="1600"/></a:spcBfr></a:pPr>
                <a:r>
                  <a:rPr sz="2000"><a:solidFill><a:srgbClr val="${sTheme.muted}"/></a:solidFill></a:rPr>
                  <a:t>${escapeXml(slide.subtitle)}</a:t>
                </a:r>
              </a:p>` : ""}
            </p:txBody>
          </p:sp>
        `;
      } else if (slide.layout === "cards" && Array.isArray(slide.cards) && slide.cards.length) {
        // Cards Grid Slide
        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Header"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="600000"/><a:ext cx="10592000" cy="900000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t"/>
              <a:lstStyle/>
              ${slide.kicker ? `
              <a:p>
                <a:r><a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.kicker.toUpperCase())}</a:t></a:r>
              </a:p>` : ""}
              <a:p>
                <a:r><a:rPr sz="3000" b="1"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.title)}</a:t></a:r>
              </a:p>
            </p:txBody>
          </p:sp>
        `;

        const totalCards = slide.cards.length;
        const userCols = Number(slide.cols || slide.columns || (slide.grid ? parseInt(slide.grid, 10) : null)) || null;
        const cols = userCols || (totalCards <= 4 ? totalCards : (totalCards % 3 === 0 ? 3 : (totalCards % 2 === 0 ? 2 : 3)));
        const numRows = Math.ceil(totalCards / cols);
        const gapX = 200000;
        const gapY = 200000;
        const totalW = 10592000;
        const startX = 800000;
        const startY = 1800000;
        const totalH = 4400000;
        const cardW = Math.floor((totalW - ((cols - 1) * gapX)) / cols);
        const cardH = numRows > 1
          ? Math.floor((totalH - ((numRows - 1) * gapY)) / numRows)
          : 4200000;

        slide.cards.forEach((card, cIdx) => {
          const rowIdx = Math.floor(cIdx / cols);
          const colIdx = cIdx % cols;
          const cardX = startX + (colIdx * (cardW + gapX));
          const cardY = startY + (rowIdx * (cardH + gapY));
          const cardAccent = card.color ? cleanHex(card.color, sTheme.accent) : sTheme.accent;

          shapesXml += `
            <p:sp>
              <p:nvSpPr><p:cNvPr id="${spId++}" name="Card${cIdx}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="${cardX}" y="${cardY}"/><a:ext cx="${cardW}" cy="${cardH}"/></a:xfrm>
                <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 3000"/></a:avLst></a:prstGeom>
                <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
                <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.cardBorder}"/></a:solidFill></a:ln>
              </p:spPr>
              <p:txBody>
                <a:bodyPr anchor="t" lIns="250000" tIns="250000" rIns="250000" bIns="250000"/>
                <a:lstStyle/>
                <a:p>
                  <a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="${cardAccent}"/></a:solidFill></a:rPr><a:t>${escapeXml(card.title || `Card ${cIdx + 1}`)}</a:t></a:r>
                </a:p>
                ${card.desc ? `
                <a:p>
                  <a:pPr><a:spcBfr><a:spcPts val="1200"/></a:spcBfr></a:pPr>
                  <a:r><a:rPr sz="1400"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(card.desc)}</a:t></a:r>
                </a:p>` : ""}
              </p:txBody>
            </p:sp>
          `;
        });
      } else if (slide.layout === "stats" && Array.isArray(slide.stats) && slide.stats.length) {
        // High-impact Stats Slide
        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Header"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="600000"/><a:ext cx="10592000" cy="900000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t"/>
              <a:lstStyle/>
              ${slide.kicker ? `
              <a:p><a:r><a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.kicker.toUpperCase())}</a:t></a:r></a:p>` : ""}
              <a:p><a:r><a:rPr sz="3000" b="1"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        `;

        const count = Math.min(4, slide.stats.length);
        const gap = 200000;
        const totalW = 10592000;
        const cardW = Math.floor((totalW - ((count - 1) * gap)) / count);

        slide.stats.slice(0, count).forEach((st, sIdx) => {
          const cardX = 800000 + (sIdx * (cardW + gap));
          shapesXml += `
            <p:sp>
              <p:nvSpPr><p:cNvPr id="${spId++}" name="StatBox${sIdx}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="${cardX}" y="2000000"/><a:ext cx="${cardW}" cy="3800000"/></a:xfrm>
                <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 3000"/></a:avLst></a:prstGeom>
                <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
                <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.cardBorder}"/></a:solidFill></a:ln>
              </p:spPr>
              <p:txBody>
                <a:bodyPr anchor="ctr" lIns="200000" tIns="200000" rIns="200000" bIns="200000"/>
                <a:lstStyle/>
                <a:p>
                  <a:pPr algn="ctr"/>
                  <a:r><a:rPr sz="4800" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(st.value)}</a:t></a:r>
                </a:p>
                <a:p>
                  <a:pPr algn="ctr"><a:spcBfr><a:spcPts val="1200"/></a:spcBfr></a:pPr>
                  <a:r><a:rPr sz="1500"><a:solidFill><a:srgbClr val="${sTheme.muted}"/></a:solidFill></a:rPr><a:t>${escapeXml(st.label)}</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          `;
        });
      } else if (slide.layout === "two-column" || (slide.col1 && slide.col2)) {
        const col1 = slide.col1 || { title: "Column 1", items: [] };
        const col2 = slide.col2 || { title: "Column 2", items: [] };
        // Split Two Column Slide
        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Header"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="600000"/><a:ext cx="10592000" cy="900000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t"/>
              <a:lstStyle/>
              ${slide.kicker ? `<a:p><a:r><a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.kicker.toUpperCase())}</a:t></a:r></a:p>` : ""}
              <a:p><a:r><a:rPr sz="3000" b="1"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        `;

        const colW = 5100000;
        const col1P = (Array.isArray(col1.items) ? col1.items : []).map((it) => `
          <a:p><a:pPr marL="288000" indent="-288000"><a:buChar char="•"/><a:spcBfr><a:spcPts val="600"/></a:spcBfr></a:pPr><a:r><a:rPr sz="1500"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(it)}</a:t></a:r></a:p>`).join("");

        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Col1Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="1800000"/><a:ext cx="${colW}" cy="4200000"/></a:xfrm>
              <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 3000"/></a:avLst></a:prstGeom>
              <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
              <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.cardBorder}"/></a:solidFill></a:ln>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t" lIns="250000" tIns="250000" rIns="250000" bIns="250000"/>
              <a:lstStyle/>
              <a:p><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(col1.title || "Column 1")}</a:t></a:r></a:p>
              ${col1P}
            </p:txBody>
          </p:sp>
        `;

        const col2P = (Array.isArray(col2.items) ? col2.items : []).map((it) => `
          <a:p><a:pPr marL="288000" indent="-288000"><a:buChar char="•"/><a:spcBfr><a:spcPts val="600"/></a:spcBfr></a:pPr><a:r><a:rPr sz="1500"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(it)}</a:t></a:r></a:p>`).join("");

        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Col2Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="${800000 + colW + 392000}" y="1800000"/><a:ext cx="${colW}" cy="4200000"/></a:xfrm>
              <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 3000"/></a:avLst></a:prstGeom>
              <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
              <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.cardBorder}"/></a:solidFill></a:ln>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t" lIns="250000" tIns="250000" rIns="250000" bIns="250000"/>
              <a:lstStyle/>
              <a:p><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(col2.title || "Column 2")}</a:t></a:r></a:p>
              ${col2P}
            </p:txBody>
          </p:sp>
        `;
      } else {
        // High-end Bullet / Feature Row Slide
        const bulletP = (Array.isArray(slide.bullets) ? slide.bullets : []).map((item) => `
          <a:p>
            <a:pPr marL="360000" indent="-360000"><a:buChar char="•"/><a:spcBfr><a:spcPts val="1200"/></a:spcBfr></a:pPr>
            <a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(item)}</a:t></a:r>
          </a:p>`).join("");

        shapesXml += `
          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Header"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="600000"/><a:ext cx="10592000" cy="1000000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t"/>
              <a:lstStyle/>
              ${slide.kicker ? `
              <a:p><a:r><a:rPr sz="1300" b="1"><a:solidFill><a:srgbClr val="${sTheme.accent}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.kicker.toUpperCase())}</a:t></a:r></a:p>` : ""}
              <a:p><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="${sTheme.text}"/></a:solidFill></a:rPr><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>

          <p:sp>
            <p:nvSpPr><p:cNvPr id="${spId++}" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="800000" y="1900000"/><a:ext cx="10592000" cy="4300000"/></a:xfrm>
              <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 2000"/></a:avLst></a:prstGeom>
              <a:solidFill><a:srgbClr val="${sTheme.cardBg}"/></a:solidFill>
              <a:ln w="12700"><a:solidFill><a:srgbClr val="${sTheme.cardBorder}"/></a:solidFill></a:ln>
            </p:spPr>
            <p:txBody>
              <a:bodyPr anchor="t" lIns="300000" tIns="300000" rIns="300000" bIns="300000"/>
              <a:lstStyle/>
              ${bulletP}
            </p:txBody>
          </p:sp>
        `;
      }

      // Running Slide Footer
      shapesXml += `
        <p:sp>
          <p:nvSpPr><p:cNvPr id="${spId++}" name="Footer"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="800000" y="6350000"/><a:ext cx="10592000" cy="300000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr anchor="b"/>
            <a:lstStyle/>
            <a:p>
              <a:r><a:rPr sz="1000"><a:solidFill><a:srgbClr val="${sTheme.muted}"/></a:solidFill></a:rPr><a:t>${escapeXml(deck.title || "Vela")}  ·  ${slideNum} / ${slides.length}</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      `;

      const slideTrans = normalizeTransitionName(slide.transition || deck.transition || "fade");
      let transitionXml = "";
      if (slideTrans === "slide") {
        transitionXml = `\n  <p:transition spd="med"><p:push dir="r"/></p:transition>`;
      } else if (slideTrans === "zoom") {
        transitionXml = `\n  <p:transition spd="med"><p:zoom/></p:transition>`;
      } else if (slideTrans === "wipe") {
        transitionXml = `\n  <p:transition spd="med"><p:wipe dir="r"/></p:transition>`;
      } else {
        transitionXml = `\n  <p:transition spd="med"><p:fade/></p:transition>`;
      }

      files.push({
        path: `ppt/slides/slide${slideNum}.xml`,
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapesXml}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMap/></p:clrMapOvr>${transitionXml}
</p:sld>`
      });

      files.push({
        path: `ppt/slides/_rels/slide${slideNum}.xml.rels`,
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`
      });
    });

    if (typeof globalThis.VelaExport?.createZip !== "function") {
      throw new Error("VelaExport.createZip is not available.");
    }

    return globalThis.VelaExport.createZip(files);
  }

  // Create high-end, responsive presentation player in the artifact canvas
  function createPreview(document, source, options = {}) {
    const deck = parsePresentation(source);
    let currentTheme = deck.themeObj || (typeof deck.theme === "object" && deck.theme !== null ? deck.theme : resolveTheme(deck.theme, deck.colors || {}));
    let currentTransition = deck.transition || "fade";
    const escape = options.escape || ((val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    const wrap = document.createElement("div");
    wrap.className = "artifact-preview-surface artifact-pptx-player";

    // Player Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "artifact-pptx-toolbar";
    toolbar.innerHTML = `
      <div class="artifact-pptx-nav">
        <button class="artifact-tool artifact-pptx-prev" type="button" aria-label="Previous slide" title="Previous slide (Left Arrow)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button>
        <span class="artifact-pptx-slide-indicator">Slide <span class="artifact-pptx-current">1</span> of <span class="artifact-pptx-total">${deck.slides.length}</span></span>
        <button class="artifact-tool artifact-pptx-next" type="button" aria-label="Next slide" title="Next slide (Right Arrow)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button>
      </div>
      <div class="artifact-pptx-controls-group">
        <button class="artifact-tool artifact-pptx-overview-toggle" type="button" title="View all slides grid (O)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg><span>Slides</span></button>
        <select class="artifact-tool artifact-pptx-theme-select" aria-label="Slide theme">
          <option value="vibrant" ${currentTheme.id === "vibrant" ? "selected" : ""}>Vibrant Indigo</option>
          <option value="midnight" ${currentTheme.id === "midnight" ? "selected" : ""}>Midnight Obsidian</option>
          <option value="dark" ${currentTheme.id === "dark" ? "selected" : ""}>Matte Black</option>
          <option value="emerald" ${currentTheme.id === "emerald" ? "selected" : ""}>Deep Emerald</option>
          <option value="slate" ${currentTheme.id === "slate" ? "selected" : ""}>Modern Slate</option>
          <option value="light" ${currentTheme.id === "light" ? "selected" : ""}>Clean Editorial</option>
        </select>
        <select class="artifact-tool artifact-pptx-trans-select" aria-label="Slide transition">
          <option value="fade" ${currentTransition === "fade" ? "selected" : ""}>Fade</option>
          <option value="slide" ${currentTransition === "slide" ? "selected" : ""}>Slide</option>
          <option value="zoom" ${currentTransition === "zoom" ? "selected" : ""}>Zoom</option>
          <option value="flip" ${currentTransition === "flip" ? "selected" : ""}>Flip</option>
          <option value="wipe" ${currentTransition === "wipe" ? "selected" : ""}>Wipe</option>
        </select>
      </div>
      <div class="artifact-pptx-actions">
        <button class="artifact-tool artifact-pptx-notes-toggle" type="button" aria-pressed="false" title="Toggle speaker notes (N)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"></path></svg><span>Notes</span></button>
        <button class="artifact-tool artifact-pptx-present" type="button" title="Fullscreen presentation (F)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg><span>Present</span></button>
        <button class="artifact-tool artifact-pptx-download" type="button" title="Download PowerPoint presentation"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg><span>Download .pptx</span></button>
      </div>
    `;

    // Stage area
    const stage = document.createElement("div");
    stage.className = "artifact-pptx-stage";

    const slideFrame = document.createElement("div");
    slideFrame.className = `artifact-pptx-slide transition-${currentTransition}`;

    // Floating On-Stage Arrow Buttons
    const stagePrev = document.createElement("button");
    stagePrev.className = "artifact-tool artifact-pptx-stage-arrow artifact-pptx-stage-prev";
    stagePrev.type = "button";
    stagePrev.setAttribute("aria-label", "Previous slide");
    stagePrev.setAttribute("title", "Previous slide (Left Arrow)");
    stagePrev.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>`;

    const stageNext = document.createElement("button");
    stageNext.className = "artifact-tool artifact-pptx-stage-arrow artifact-pptx-stage-next";
    stageNext.type = "button";
    stageNext.setAttribute("aria-label", "Next slide");
    stageNext.setAttribute("title", "Next slide (Right Arrow)");
    stageNext.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>`;

    // Floating Presenter HUD
    const presenterHud = document.createElement("div");
    presenterHud.className = "artifact-pptx-presenter-hud";
    presenterHud.innerHTML = `
      <button class="artifact-tool artifact-pptx-hud-btn artifact-pptx-hud-prev" type="button" aria-label="Previous slide" title="Previous (Left Arrow)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button>
      <span class="artifact-pptx-hud-indicator"><span class="artifact-pptx-hud-current">1</span> / <span class="artifact-pptx-hud-total">${deck.slides.length}</span></span>
      <button class="artifact-tool artifact-pptx-hud-btn artifact-pptx-hud-next" type="button" aria-label="Next slide" title="Next (Right Arrow)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button>
      <div class="artifact-pptx-hud-divider"></div>
      <button class="artifact-tool artifact-pptx-hud-btn artifact-pptx-hud-overview" type="button" title="All slides (O)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg></button>
      <button class="artifact-tool artifact-pptx-hud-btn artifact-pptx-hud-notes" type="button" title="Presenter notes (N)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"></path></svg></button>
      <button class="artifact-tool artifact-pptx-hud-btn artifact-pptx-hud-fullscreen" type="button" title="Toggle Fullscreen (F)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg></button>
    `;

    // Floating stage notes overlay (for presentation mode)
    const stageNotes = document.createElement("div");
    stageNotes.className = "artifact-pptx-stage-notes";
    stageNotes.hidden = true;
    stageNotes.innerHTML = `
      <div class="artifact-pptx-stage-notes-head">
        <span>Presenter Notes</span>
        <button class="artifact-tool artifact-pptx-stage-notes-close" type="button" aria-label="Close notes"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
      </div>
      <div class="artifact-pptx-stage-notes-body"></div>
    `;

    // Overview Thumbnail Grid Drawer
    const overviewDrawer = document.createElement("div");
    overviewDrawer.className = "artifact-pptx-overview";
    overviewDrawer.hidden = true;

    // Speaker notes drawer
    const notesDrawer = document.createElement("div");
    notesDrawer.className = "artifact-pptx-notes-drawer";
    notesDrawer.hidden = true;
    notesDrawer.innerHTML = `<span class="artifact-pptx-notes-title">Presenter Notes</span><div class="artifact-pptx-notes-content"></div>`;

    stage.appendChild(slideFrame);
    stage.appendChild(stagePrev);
    stage.appendChild(stageNext);
    stage.appendChild(presenterHud);
    stage.appendChild(stageNotes);
    stage.appendChild(overviewDrawer);
    wrap.append(toolbar, stage, notesDrawer);

    let activeSlideIndex = 0;

    function renderSlideContent(slide, index) {
      const sTheme = slide.theme || currentTheme;
      let contentHtml = "";

      if (slide.layout === "title") {
        const eff = slide.effect || "fade-up";
        const kickerEff = eff === "fade-up" ? "fade-down" : eff;
        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-title">
            ${slide.badge || slide.kicker ? `<div class="artifact-pptx-badge pptx-elem-effect pptx-effect-${kickerEff}" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 350ms;">${escape(slide.badge || slide.kicker)}</div>` : ""}
            <h1 class="artifact-pptx-title-hero pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: 80ms; --pptx-elem-duration: 400ms;">${escape(slide.title)}</h1>
            ${slide.subtitle ? `<p class="artifact-pptx-subtitle-hero pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: 160ms; --pptx-elem-duration: 400ms;">${escape(slide.subtitle)}</p>` : ""}
          </div>
        `;
      } else if (slide.layout === "cards" && Array.isArray(slide.cards) && slide.cards.length) {
        const cardElements = slide.cards.map((card, cIdx) => {
          const cardColor = card.color ? cleanColorCss(card.color) : "var(--pptx-accent)";
          const cardBadge = card.badge ? `<span class="artifact-pptx-card-badge">${escape(card.badge)}</span>` : "";
          const cardPrice = card.price ? `<div class="artifact-pptx-card-price">${escape(card.price)}</div>` : "";
          const cardFeatures = Array.isArray(card.features) && card.features.length ? `
            <ul class="artifact-pptx-card-feature-list">
              ${card.features.map((f) => `<li><span class="artifact-pptx-feature-check"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"></path></svg></span> <span>${escape(f)}</span></li>`).join("")}
            </ul>
          ` : (card.desc ? `<p class="artifact-pptx-card-desc">${escape(card.desc)}</p>` : "");

          const colSpan = Number(card.colSpan || card.span || 1) || 1;
          const eff = card.effect || slide.effect || "fade-up";
          const delay = card.delay || `${cIdx * 80 + 100}ms`;
          const duration = card.duration || "400ms";

          const cardStyle = [
            `--card-accent: ${cardColor}`,
            `--pptx-elem-delay: ${delay}`,
            `--pptx-elem-duration: ${duration}`,
            colSpan > 1 ? `grid-column: span ${colSpan}` : "",
            card.minHeight ? `min-height: ${escape(card.minHeight)}` : "",
            card.height ? `height: ${escape(card.height)}` : "",
            card.width ? `width: ${escape(card.width)}` : ""
          ].filter(Boolean).join("; ");

          return `
            <div class="artifact-pptx-card pptx-elem-effect pptx-effect-${eff}" style="${cardStyle};">
              <div class="artifact-pptx-card-indicator" style="background: ${cardColor};"></div>
              <div class="artifact-pptx-card-head">
                <h3 class="artifact-pptx-card-title">${escape(card.title || `Feature ${cIdx + 1}`)}</h3>
                ${cardBadge}
              </div>
              ${cardPrice}
              ${cardFeatures}
            </div>
          `;
        }).join("");

        const totalCards = slide.cards.length;
        const userCols = Number(slide.cols || slide.columns || (slide.grid ? parseInt(slide.grid, 10) : null)) || null;
        const cols = userCols || (totalCards <= 4 ? totalCards : (totalCards % 3 === 0 ? 3 : (totalCards % 2 === 0 ? 2 : 3)));
        const gridStyle = userCols || totalCards > 4
          ? `style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));"`
          : "";

        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-cards">
            <header class="artifact-pptx-header pptx-elem-effect pptx-effect-fade-down" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 320ms;">
              ${slide.kicker ? `<span class="artifact-pptx-kicker">${escape(slide.kicker)}</span>` : ""}
              <h2 class="artifact-pptx-title">${escape(slide.title)}</h2>
            </header>
            <div class="artifact-pptx-cards-grid grid-${Math.min(4, cols)}" ${gridStyle}>
              ${cardElements}
            </div>
          </div>
        `;
      } else if (slide.layout === "stats" && Array.isArray(slide.stats) && slide.stats.length) {
        const statElements = slide.stats.map((st, sIdx) => {
          const eff = st.effect || slide.effect || "zoom-in";
          const delay = st.delay || `${sIdx * 80 + 100}ms`;
          const duration = st.duration || "400ms";
          return `
            <div class="artifact-pptx-stat-box pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: ${delay}; --pptx-elem-duration: ${duration};">
              <span class="artifact-pptx-stat-val">${escape(st.value)}</span>
              <span class="artifact-pptx-stat-lbl">${escape(st.label)}</span>
            </div>
          `;
        }).join("");

        const userStatCols = Number(slide.cols || slide.columns || (slide.grid ? parseInt(slide.grid, 10) : null)) || null;
        const statGridStyle = userStatCols
          ? `style="grid-template-columns: repeat(${userStatCols}, minmax(0, 1fr));"`
          : "";

        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-stats">
            <header class="artifact-pptx-header pptx-elem-effect pptx-effect-fade-down" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 320ms;">
              ${slide.kicker ? `<span class="artifact-pptx-kicker">${escape(slide.kicker)}</span>` : ""}
              <h2 class="artifact-pptx-title">${escape(slide.title)}</h2>
            </header>
            <div class="artifact-pptx-stats-grid" ${statGridStyle}>
              ${statElements}
            </div>
          </div>
        `;
      } else if (slide.layout === "timeline" && Array.isArray(slide.timeline) && slide.timeline.length) {
        const stepElements = slide.timeline.map((step, sIdx) => {
          const eff = step.effect || slide.effect || "fade-left";
          const delay = step.delay || `${sIdx * 90 + 100}ms`;
          const duration = step.duration || "380ms";
          return `
            <div class="artifact-pptx-step-item pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: ${delay}; --pptx-elem-duration: ${duration};">
              <div class="artifact-pptx-step-num">${escape(step.step || String(sIdx + 1))}</div>
              <div class="artifact-pptx-step-info">
                <h4 class="artifact-pptx-step-title">${escape(step.title)}</h4>
                ${step.desc ? `<p class="artifact-pptx-step-desc">${escape(step.desc)}</p>` : ""}
              </div>
            </div>
          `;
        }).join("");

        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-timeline">
            <header class="artifact-pptx-header pptx-elem-effect pptx-effect-fade-down" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 320ms;">
              ${slide.kicker ? `<span class="artifact-pptx-kicker">${escape(slide.kicker)}</span>` : ""}
              <h2 class="artifact-pptx-title">${escape(slide.title)}</h2>
            </header>
            <div class="artifact-pptx-timeline-track">
              ${stepElements}
            </div>
          </div>
        `;
      } else if (slide.layout === "two-column" || (slide.col1 && slide.col2)) {
        const col1 = slide.col1 || { title: "Column 1", items: [] };
        const col2 = slide.col2 || { title: "Column 2", items: [] };
        const eff = slide.effect || "fade-up";
        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-cols">
            <header class="artifact-pptx-header pptx-elem-effect pptx-effect-fade-down" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 320ms;">
              ${slide.kicker ? `<span class="artifact-pptx-kicker">${escape(slide.kicker)}</span>` : ""}
              <h2 class="artifact-pptx-title">${escape(slide.title)}</h2>
            </header>
            <div class="artifact-pptx-cols-grid">
              <div class="artifact-pptx-col-card pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: 100ms; --pptx-elem-duration: 380ms;">
                <h3 class="artifact-pptx-col-title">${escape(col1.title || "Column 1")}</h3>
                <ul class="artifact-pptx-list">
                  ${(Array.isArray(col1.items) ? col1.items : []).map((it) => {
                    const match = it.match(/^([^*:]+[:—-])\s*(.*)$/);
                    if (match && match[1].length < 60) {
                      return `<li><strong class="artifact-pptx-lead">${escape(match[1])}</strong> ${escape(match[2])}</li>`;
                    }
                    return `<li>${escape(it)}</li>`;
                  }).join("")}
                </ul>
              </div>
              <div class="artifact-pptx-col-card pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: 180ms; --pptx-elem-duration: 380ms;">
                <h3 class="artifact-pptx-col-title">${escape(col2.title || "Column 2")}</h3>
                <ul class="artifact-pptx-list">
                  ${(Array.isArray(col2.items) ? col2.items : []).map((it) => {
                    const match = it.match(/^([^*:]+[:—-])\s*(.*)$/);
                    if (match && match[1].length < 60) {
                      return `<li><strong class="artifact-pptx-lead">${escape(match[1])}</strong> ${escape(match[2])}</li>`;
                    }
                    return `<li>${escape(it)}</li>`;
                  }).join("")}
                </ul>
              </div>
            </div>
          </div>
        `;
      } else if (slide.layout === "quote" && slide.quote) {
        const eff = slide.effect || "zoom-in";
        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-quote">
            <blockquote class="artifact-pptx-blockquote pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: 100ms; --pptx-elem-duration: 450ms;">
              "${escape(slide.quote)}"
              ${slide.author ? `<cite class="artifact-pptx-cite">-- ${escape(slide.author)}</cite>` : ""}
            </blockquote>
          </div>
        `;
      } else {
        // High-end Bullet / Feature Row Layout
        const eff = slide.effect || "fade-left";
        const bulletItems = (Array.isArray(slide.bullets) ? slide.bullets : []).map((b, bIdx) => {
          const match = b.match(/^([^*:]+[:—-])\s*(.*)$/);
          if (match) {
            return `<li class="pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: ${bIdx * 60 + 80}ms; --pptx-elem-duration: 350ms;"><strong class="artifact-pptx-lead">${escape(match[1])}</strong> ${escape(match[2])}</li>`;
          }
          return `<li class="pptx-elem-effect pptx-effect-${eff}" style="--pptx-elem-delay: ${bIdx * 60 + 80}ms; --pptx-elem-duration: 350ms;">${escape(b)}</li>`;
        }).join("");

        contentHtml = `
          <div class="artifact-pptx-content artifact-pptx-layout-bullets">
            <header class="artifact-pptx-header pptx-elem-effect pptx-effect-fade-down" style="--pptx-elem-delay: 0ms; --pptx-elem-duration: 320ms;">
              ${slide.kicker ? `<span class="artifact-pptx-kicker">${escape(slide.kicker)}</span>` : ""}
              <h2 class="artifact-pptx-title">${escape(slide.title)}</h2>
            </header>
            <ul class="artifact-pptx-feature-list">
              ${bulletItems}
            </ul>
          </div>
        `;
      }

      return `
        ${contentHtml}
        <footer class="artifact-pptx-footer">
          <span>${escape(deck.title || "Vela")}</span>
          <span>${index + 1} / ${deck.slides.length}</span>
        </footer>
      `;
    }

    function updateNavState() {
      const isFirst = activeSlideIndex <= 0;
      const isLast = activeSlideIndex >= deck.slides.length - 1;
      const currentNumStr = String(activeSlideIndex + 1);

      const tbPrev = toolbar.querySelector(".artifact-pptx-prev");
      const tbNext = toolbar.querySelector(".artifact-pptx-next");
      const tbCurr = toolbar.querySelector(".artifact-pptx-current");
      if (tbPrev) tbPrev.disabled = isFirst;
      if (tbNext) tbNext.disabled = isLast;
      if (tbCurr) tbCurr.textContent = currentNumStr;

      stagePrev.disabled = isFirst;
      stageNext.disabled = isLast;
      stagePrev.classList?.toggle?.("disabled", isFirst);
      stageNext.classList?.toggle?.("disabled", isLast);

      const hudPrev = presenterHud.querySelector(".artifact-pptx-hud-prev");
      const hudNext = presenterHud.querySelector(".artifact-pptx-hud-next");
      const hudCurr = presenterHud.querySelector(".artifact-pptx-hud-current");
      if (hudPrev) hudPrev.disabled = isFirst;
      if (hudNext) hudNext.disabled = isLast;
      if (hudCurr) hudCurr.textContent = currentNumStr;
    }

    function renderActiveSlide(direction = null) {
      const slide = deck.slides[activeSlideIndex] || deck.slides[0];
      const sTheme = slide.theme || currentTheme;
      const slideTrans = slide.transition || currentTransition || "fade";

      slideFrame.style.background = slide.background || sTheme.bgCss;
      slideFrame.style.color = sTheme.textCss;
      slideFrame.style.setProperty("--pptx-card-bg", sTheme.cardBgCss);
      slideFrame.style.setProperty("--pptx-card-border", sTheme.cardBorderCss);
      slideFrame.style.setProperty("--pptx-text", sTheme.textCss);
      slideFrame.style.setProperty("--pptx-muted", sTheme.mutedCss);
      slideFrame.style.setProperty("--pptx-accent", sTheme.accentCss);
      slideFrame.style.setProperty("--pptx-accent2", sTheme.accent2Css || sTheme.accentCss);
      slideFrame.style.setProperty("--pptx-primary", sTheme.primaryCss || sTheme.accentCss);

      if (direction) {
        slideFrame.className = `artifact-pptx-slide transition-${slideTrans} animate-${direction}`;
        if (typeof setTimeout === "function") {
          setTimeout(() => {
            slideFrame.classList?.remove?.(`animate-${direction}`);
          }, 400);
        }
      } else {
        slideFrame.className = `artifact-pptx-slide transition-${slideTrans}`;
      }
      slideFrame.innerHTML = renderSlideContent(slide, activeSlideIndex);

      updateNavState();

      // Update speaker notes
      const notesContent = notesDrawer.querySelector(".artifact-pptx-notes-content");
      if (notesContent) {
        notesContent.textContent = slide.notes || "No presenter notes for this slide.";
      }

      const stageNotesBody = stageNotes.querySelector(".artifact-pptx-stage-notes-body");
      if (stageNotesBody) {
        stageNotesBody.textContent = slide.notes || "No presenter notes for this slide.";
      }

      const notesToggle = toolbar.querySelector(".artifact-pptx-notes-toggle");
      if (notesToggle) {
        notesToggle.classList?.toggle?.("has-notes", Boolean(slide.notes));
      }
    }

    function renderOverview() {
      overviewDrawer.innerHTML = `
        <div class="artifact-pptx-overview-head">
          <span>All Slides (${deck.slides.length})</span>
          <button class="artifact-tool artifact-pptx-overview-close" type="button" aria-label="Close overview"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg><span>Close</span></button>
        </div>
        <div class="artifact-pptx-overview-grid">
          ${deck.slides.map((s, idx) => `
            <div class="artifact-pptx-thumb-card ${idx === activeSlideIndex ? 'active' : ''}" data-slide-index="${idx}">
              <span class="artifact-pptx-thumb-num">${idx + 1}</span>
              <span class="artifact-pptx-thumb-title">${escape(s.title || `Slide ${idx + 1}`)}</span>
              <span class="artifact-pptx-thumb-layout">${escape(s.layout)}</span>
            </div>
          `).join("")}
        </div>
      `;

      overviewDrawer.querySelector(".artifact-pptx-overview-close")?.addEventListener("click", () => {
        overviewDrawer.hidden = true;
      });

      overviewDrawer.querySelectorAll(".artifact-pptx-thumb-card").forEach((card) => {
        card.addEventListener("click", () => {
          const target = Number(card.dataset.slideIndex);
          setSlide(target);
          overviewDrawer.hidden = true;
        });
      });
    }

    function setSlide(index) {
      if (!deck.slides.length) return;
      const target = Math.max(0, Math.min(index, deck.slides.length - 1));
      if (target === activeSlideIndex) return;
      const direction = target > activeSlideIndex ? "next" : "prev";
      activeSlideIndex = target;
      renderActiveSlide(direction);
    }

    function toggleFullscreen() {
      const isFs = (document.fullscreenElement === stage || document.webkitFullscreenElement === stage);
      if (isFs) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
        else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
      }
    }

    function toggleNotes() {
      const isFs = (document.fullscreenElement === stage || document.webkitFullscreenElement === stage);
      if (isFs) {
        stageNotes.hidden = !stageNotes.hidden;
      } else {
        const isVisible = !notesDrawer.hidden;
        notesDrawer.hidden = isVisible;
        const notesToggle = toolbar.querySelector(".artifact-pptx-notes-toggle");
        if (notesToggle) {
          notesToggle.setAttribute("aria-pressed", String(!isVisible));
          notesToggle.classList?.toggle?.("active", !isVisible);
        }
      }
    }

    function toggleOverview() {
      const isVisible = !overviewDrawer.hidden;
      overviewDrawer.hidden = isVisible;
      if (!isVisible) renderOverview();
    }

    // Toolbar listeners
    toolbar.querySelector(".artifact-pptx-prev")?.addEventListener("click", () => setSlide(activeSlideIndex - 1));
    toolbar.querySelector(".artifact-pptx-next")?.addEventListener("click", () => setSlide(activeSlideIndex + 1));
    toolbar.querySelector(".artifact-pptx-overview-toggle")?.addEventListener("click", toggleOverview);
    toolbar.querySelector(".artifact-pptx-theme-select")?.addEventListener("change", (e) => {
      currentTheme = THEMES[e.target.value] || THEMES.vibrant;
      renderActiveSlide();
    });
    toolbar.querySelector(".artifact-pptx-trans-select")?.addEventListener("change", (e) => {
      currentTransition = e.target.value;
    });
    toolbar.querySelector(".artifact-pptx-notes-toggle")?.addEventListener("click", toggleNotes);
    toolbar.querySelector(".artifact-pptx-present")?.addEventListener("click", toggleFullscreen);

    if (typeof window !== "undefined" && window.VelaCustomSelect?.enhanceAll) {
      try {
        window.VelaCustomSelect.enhanceAll(toolbar);
      } catch {}
    }

    // Stage arrow listeners
    stagePrev.addEventListener("click", (e) => {
      e.stopPropagation?.();
      setSlide(activeSlideIndex - 1);
    });
    stageNext.addEventListener("click", (e) => {
      e.stopPropagation?.();
      setSlide(activeSlideIndex + 1);
    });

    // Stage click-to-advance
    slideFrame.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("button, a, input, select, textarea, .artifact-tool")) return;
      setSlide(activeSlideIndex + 1);
    });

    // Presenter HUD listeners
    presenterHud.querySelector(".artifact-pptx-hud-prev")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      setSlide(activeSlideIndex - 1);
    });
    presenterHud.querySelector(".artifact-pptx-hud-next")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      setSlide(activeSlideIndex + 1);
    });
    presenterHud.querySelector(".artifact-pptx-hud-overview")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      toggleOverview();
    });
    presenterHud.querySelector(".artifact-pptx-hud-notes")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      toggleNotes();
    });
    presenterHud.querySelector(".artifact-pptx-hud-fullscreen")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      toggleFullscreen();
    });

    // Stage notes close listener
    stageNotes.querySelector(".artifact-pptx-stage-notes-close")?.addEventListener("click", (e) => {
      e.stopPropagation?.();
      stageNotes.hidden = true;
    });

    // Fullscreen idle cursor & HUD auto-hide
    let idleTimeout = null;
    stage.addEventListener("mousemove", () => {
      stage.classList?.remove?.("mouse-idle");
      if (idleTimeout) clearTimeout(idleTimeout);
      const isFs = (document.fullscreenElement === stage || document.webkitFullscreenElement === stage);
      if (isFs) {
        idleTimeout = setTimeout(() => {
          stage.classList?.add?.("mouse-idle");
        }, 2500);
      }
    });

    toolbar.querySelector(".artifact-pptx-download")?.addEventListener("click", () => {
      const bytes = buildPptx(deck);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(deck.title || "presentation").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pptx`;
      a.click();
      if (typeof setTimeout === "function") {
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    });

    // Keyboard navigation (both on container focus and document fullscreen)
    function handleKeydown(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      const isFs = (document.fullscreenElement === stage || document.webkitFullscreenElement === stage);
      const isWrapFocused = (wrap.contains && wrap.contains(document.activeElement)) || wrap === document.activeElement;
      if (!isFs && !isWrapFocused) return;

      if (["ArrowRight", "Space", "PageDown"].includes(e.code)) {
        e.preventDefault?.();
        setSlide(activeSlideIndex + 1);
      } else if (["ArrowLeft", "PageUp"].includes(e.code)) {
        e.preventDefault?.();
        setSlide(activeSlideIndex - 1);
      } else if (e.code === "Home") {
        e.preventDefault?.();
        setSlide(0);
      } else if (e.code === "End") {
        e.preventDefault?.();
        setSlide(deck.slides.length - 1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault?.();
        toggleFullscreen();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault?.();
        toggleNotes();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault?.();
        toggleOverview();
      } else if (e.code === "Escape") {
        if (!overviewDrawer.hidden) {
          overviewDrawer.hidden = true;
        } else if (!stageNotes.hidden) {
          stageNotes.hidden = true;
        }
      }
    }

    wrap.tabIndex = 0;
    wrap.addEventListener("keydown", handleKeydown);
    if (typeof document !== "undefined" && document?.addEventListener) {
      document.addEventListener("keydown", handleKeydown);
    }

    renderActiveSlide();
    return wrap;
  }

  globalThis.VelaPptx = Object.freeze({
    THEMES,
    resolveTheme,
    cleanHex,
    cleanColorCss,
    parsePresentation,
    buildPptx,
    createPreview
  });
})();
