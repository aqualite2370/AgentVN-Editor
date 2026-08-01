import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface AssistantMarkdownMessageProps {
  content: string;
  role: "user" | "assistant";
  streaming?: boolean;
}

const markdownComponents: Components = {
  a({ children, node: _node, ...props }) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  pre({ children, node: _node, ...props }) {
    return (
      <pre {...props} className="assistant-code-block">
        {children}
      </pre>
    );
  },
  code({ children, className, node: _node, ...props }) {
    const language = /language-([a-z0-9_-]+)/i.exec(className ?? "")?.[1];
    return (
      <code
        {...props}
        className={language ? `assistant-code ${className ?? ""}` : "assistant-inline-code"}
        data-language={language}
      >
        {children}
      </code>
    );
  },
  table({ children, node: _node, ...props }) {
    return (
      <div className="assistant-table-scroll">
        <table {...props}>{children}</table>
      </div>
    );
  },
};

function escapeRawHtmlOutsideCode(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?>/g, (tag) => `\`${tag.replace(/`/g, "\\`")}\``);
    })
    .join("\n");
}

export function AssistantMarkdownMessage({ content, role, streaming = false }: AssistantMarkdownMessageProps) {
  const safeMarkdown = escapeRawHtmlOutsideCode(content);
  return (
    <div className={`assistant-markdown is-${role}${streaming ? " is-streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {safeMarkdown}
      </ReactMarkdown>
    </div>
  );
}
