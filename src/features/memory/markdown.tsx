import type { ReactNode } from "react";

/**
 * The preview beside the editor: the small Markdown the memory files use (headings,
 * bullets, numbered steps, rules, paragraphs), rendered as React elements from text.
 * Never HTML. A line indented under a list item continues that item, as the skill
 * templates wrap their guidance.
 */
export function MarkdownPreview({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let steps: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key++} className="my-2 flex flex-col gap-1 pl-5">
        {list.map((item, index) => (
          <li key={index} className="list-disc">
            {item || <span className="text-fg-subtle">…</span>}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushSteps = () => {
    if (steps.length === 0) return;
    blocks.push(
      <ol key={key++} className="my-2 flex flex-col gap-1 pl-5">
        {steps.map((item, index) => (
          <li key={index} className="list-decimal">
            {item}
          </li>
        ))}
      </ol>,
    );
    steps = [];
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={key++} className="my-2">
        {paragraph.join(" ")}
      </p>,
    );
    paragraph = [];
  };

  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushSteps();
      flushParagraph();
      const level = heading[1]!.length;
      const textContent = heading[2] ?? "";
      blocks.push(
        level === 1 ? (
          <h2 key={key++} className="mt-1 mb-2 font-display text-2xl tracking-tight">
            {textContent}
          </h2>
        ) : level === 2 ? (
          <h3 key={key++} className="mt-5 mb-1.5 text-sm font-semibold">
            {textContent}
          </h3>
        ) : (
          <h4 key={key++} className="mt-3 mb-1 text-xs font-semibold text-fg-muted uppercase">
            {textContent}
          </h4>
        ),
      );
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      flushList();
      flushSteps();
      flushParagraph();
      blocks.push(<hr key={key++} className="my-4 border-border" />);
      continue;
    }
    const bullet = /^\s*[-*]\s?(.*)$/.exec(line);
    if (bullet) {
      flushSteps();
      flushParagraph();
      list.push((bullet[1] ?? "").trim());
      continue;
    }
    const step = /^\d{1,2}[.)]\s+(.*)$/.exec(line);
    if (step) {
      flushList();
      flushParagraph();
      steps.push((step[1] ?? "").trim());
      continue;
    }
    if (line.trim() === "") {
      flushList();
      flushSteps();
      flushParagraph();
      continue;
    }
    // An indented line right under a list item wraps that item.
    const open = steps.length > 0 ? steps : list.length > 0 ? list : null;
    if (open && /^\s/.test(line)) {
      open[open.length - 1] = `${open[open.length - 1]} ${line.trim()}`.trim();
      continue;
    }
    flushList();
    flushSteps();
    paragraph.push(line.trim());
  }
  flushList();
  flushSteps();
  flushParagraph();

  return <div className="text-[0.95rem] leading-relaxed">{blocks}</div>;
}
