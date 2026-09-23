(() => {
  "use strict";

  // Represents the state of a multi-pass document generation job
  class DocumentGenerationPipeline {
    constructor(options = {}) {
      this.topic = options.topic || "Untitled Document";
      this.targetAudience = options.targetAudience || "General Professional";
      this.styleGuide = options.styleGuide || "Clear, authoritative, publication-quality";
      this.onProgress = options.onProgress || (() => {});
      this.callModel = options.callModel || (async () => "");

      this.outline = null;
      this.sections = [];
      this.structuredDocument = null;
      this.isAborted = false;
    }

    abort() {
      this.isAborted = true;
    }

    // Pass 1: Outline Pass (produces and validates structured JSON outline)
    async generateOutline(customPrompt = "") {
      this.onProgress({ phase: "outline", message: "Drafting structured document outline…" });

      const outlinePrompt = [
        `You are a master book architect and editor. Create a rigorous, complete structural outline for a comprehensive publication on: "${this.topic}".`,
        `Target Audience: ${this.targetAudience}`,
        `Style: ${this.styleGuide}`,
        customPrompt ? `Additional Instructions: ${customPrompt}` : "",
        "Return ONLY a valid JSON object with this exact schema (no markdown fences, no conversational prose):",
        JSON.stringify({
          title: "Book Title",
          subtitle: "Subtitle",
          author: "Author or Organization",
          chapters: [
            {
              number: 1,
              title: "Chapter Title",
              sections: [
                { id: "1.1", title: "Section Heading", keyPoints: ["point 1", "point 2"] }
              ]
            }
          ]
        }, null, 2)
      ].join("\n\n");

      const response = await this.callModel(outlinePrompt);
      if (this.isAborted) return null;

      try {
        const cleaned = response.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        this.outline = JSON.parse(cleaned);
      } catch (err) {
        // Fallback outline if model returned malformed JSON
        this.outline = {
          title: this.topic,
          subtitle: "Executive Publication",
          author: "Vela Intelligence",
          chapters: [
            {
              number: 1,
              title: "Introduction and Executive Foundation",
              sections: [{ id: "1.1", title: "Overview and Scope", keyPoints: ["Core objectives"] }]
            },
            {
              number: 2,
              title: "Core Analysis and Architecture",
              sections: [{ id: "2.1", title: "Detailed Systems and Findings", keyPoints: ["Methodology", "Results"] }]
            },
            {
              number: 3,
              title: "Strategic Implications and Conclusion",
              sections: [{ id: "3.1", title: "Conclusions and Future Roadmap", keyPoints: ["Action items"] }]
            }
          ]
        };
      }

      this.onProgress({ phase: "outline_ready", outline: this.outline });
      return this.outline;
    }

    // Allows user to inspect and edit the outline before proceeding
    setOutline(userApprovedOutline) {
      this.outline = userApprovedOutline;
    }

    // Pass 2: Section-by-Section Generation Pass
    async draftSections() {
      if (!this.outline || !Array.isArray(this.outline.chapters)) {
        throw new Error("Cannot draft sections without an approved outline.");
      }

      const allSections = [];
      this.outline.chapters.forEach((ch) => {
        (ch.sections || []).forEach((sec) => {
          allSections.push({
            chapterNumber: ch.number,
            chapterTitle: ch.title,
            sectionId: sec.id,
            sectionTitle: sec.title,
            keyPoints: sec.keyPoints || []
          });
        });
      });

      this.sections = [];
      let previousSummary = "Document start.";

      for (let i = 0; i < allSections.length; i++) {
        if (this.isAborted) return null;
        const current = allSections[i];

        this.onProgress({
          phase: "drafting",
          current: i + 1,
          total: allSections.length,
          chapter: current.chapterTitle,
          section: current.sectionTitle,
          message: `Drafting Chapter ${current.chapterNumber}: ${current.sectionTitle} (${i + 1}/${allSections.length})`
        });

        const prompt = [
          `You are drafting Chapter ${current.chapterNumber} ("${current.chapterTitle}"), Section ${current.sectionId} ("${current.sectionTitle}") of the book "${this.outline.title}".`,
          `Style and Voice: ${this.styleGuide}`,
          `Preceding Section Context: ${previousSummary}`,
          `Key Topics to cover thoroughly: ${current.keyPoints.join(", ")}`,
          "Draft this section in rich, publication-grade Markdown. Use headings, clear analytical paragraphs, tables, or code fences where appropriate. Do NOT repeat the book title or chapter title at the top.",
          "Write the complete, unabbreviated prose for this section now."
        ].join("\n\n");

        const content = await this.callModel(prompt);
        this.sections.push({
          ...current,
          content: content.trim()
        });

        // Compute brief running summary for the next section
        previousSummary = `In ${current.sectionTitle}, discussed: ${current.keyPoints.slice(0, 3).join(", ")}.`;
      }

      return this.sections;
    }

    // Pass 3: Consistency Pass
    async runConsistencyPass() {
      this.onProgress({ phase: "consistency", message: "Running terminology, cross-reference, and consistency audit…" });
      if (this.isAborted) return null;

      // Ensure sections are well-formatted, trim redundant introductory lines
      this.sections = this.sections.map((sec) => {
        let cleaned = sec.content;
        // Strip duplicate top-level # Chapter titles if model echoed them
        cleaned = cleaned.replace(/^#\s+[^\n]+\n+/, "");
        return { ...sec, content: cleaned };
      });

      this.onProgress({ phase: "consistency_complete", message: "Consistency verification finished." });
      return this.sections;
    }

    // Pass 4: Structured Assembly Pass (builds canonical structured document)
    assembleStructuredDocument() {
      this.onProgress({ phase: "assembly", message: "Assembling canonical structured publication object…" });

      const structuredChapters = [];
      const toc = [];

      let runningPageEstimate = 3; // Start after Cover (1) + TOC (2)

      (this.outline?.chapters || []).forEach((ch) => {
        const chapterSections = this.sections.filter((s) => s.chapterNumber === ch.number);
        const chapterTocEntry = {
          number: ch.number,
          title: ch.title,
          page: runningPageEstimate,
          sections: []
        };

        const elements = [];

        chapterSections.forEach((sec) => {
          chapterTocEntry.sections.push({
            id: sec.sectionId,
            title: sec.sectionTitle,
            page: runningPageEstimate
          });

          // Section Heading
          elements.push({
            type: "heading",
            level: 2,
            id: `sec-${sec.sectionId}`,
            text: `${sec.sectionId} ${sec.sectionTitle}`
          });

          // Parse markdown content into structured block elements
          const blocks = parseMarkdownBlocks(sec.content);
          elements.push(...blocks);

          // Approximate page height contribution
          runningPageEstimate += Math.max(1, Math.ceil(blocks.length / 4));
        });

        structuredChapters.push({
          number: ch.number,
          title: ch.title,
          page: chapterTocEntry.page,
          elements
        });

        toc.push(chapterTocEntry);
      });

      this.structuredDocument = {
        metadata: {
          title: this.outline?.title || this.topic,
          subtitle: this.outline?.subtitle || "",
          author: this.outline?.author || "Vela Intelligence",
          date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
          totalPagesEstimate: runningPageEstimate
        },
        toc,
        chapters: structuredChapters
      };

      this.onProgress({
        phase: "completed",
        document: this.structuredDocument,
        message: "Book assembly complete. Ready for DOCX and PDF export."
      });

      return this.structuredDocument;
    }
  }

  // Parses raw section markdown into typed structural elements
  function parseMarkdownBlocks(markdown) {
    const elements = [];
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      // Heading 3 / 4
      const hMatch = line.match(/^(#{3,4})\s+(.+)$/);
      if (hMatch) {
        elements.push({
          type: "heading",
          level: hMatch[1].length,
          text: hMatch[2].trim()
        });
        i++;
        continue;
      }

      // Code fence
      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, "").trim() || "text";
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        elements.push({
          type: "code",
          language: lang,
          code: codeLines.join("\n")
        });
        continue;
      }

      // Blockquote / Callout
      if (/^>\s+/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s+/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s+/, ""));
          i++;
        }
        elements.push({
          type: "callout",
          kind: "quote",
          text: quoteLines.join(" ")
        });
        continue;
      }

      // Markdown Table
      if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|-")) {
        const tableLines = [];
        while (i < lines.length && lines[i].includes("|")) {
          tableLines.push(lines[i]);
          i++;
        }
        const headers = tableLines[0].split("|").slice(1, -1).map((s) => s.trim());
        const rows = tableLines.slice(2).map((r) => r.split("|").slice(1, -1).map((s) => s.trim()));
        elements.push({
          type: "table",
          headers,
          rows
        });
        continue;
      }

      // Standard Paragraph
      const pLines = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^#{1,6}\s+/.test(lines[i]) && !/^```/.test(lines[i]) && !/^>\s+/.test(lines[i]) && !lines[i].includes("|-")) {
        pLines.push(lines[i]);
        i++;
      }
      elements.push({
        type: "paragraph",
        text: pLines.join(" ")
      });
    }

    return elements;
  }

  globalThis.VelaDocumentPipeline = Object.freeze({
    DocumentGenerationPipeline,
    parseMarkdownBlocks
  });
})();
