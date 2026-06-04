"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Renders assistant turns as GitHub-flavored markdown so LeadQuery's pipe
// tables become real <table>s (selectable / copyable), links are clickable,
// and SQL code fences render as code blocks. react-markdown does NOT allow
// raw HTML by default, so this is XSS-safe even though the SQL results it
// summarizes are untrusted DB data.

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 break-all hover:opacity-80"
    >
      {children}
    </a>
  ),

  // Real table, wrapped so wide CRM results scroll horizontally inside the
  // bubble instead of blowing out the layout. Native <table> selection means
  // you can click-drag across cells and copy straight into a sheet.
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3 py-2 text-left align-top font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-r border-border/50 px-3 py-2 align-top last:border-0">
      {children}
    </td>
  ),

  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  code: ({ className, children }) => {
    const text = String(children ?? "");
    // Block code has newlines or a language- class; the <pre> wrapper supplies
    // its background, so block <code> stays transparent to avoid double-fill.
    const isBlock = text.includes("\n") || /language-/.test(className ?? "");
    return isBlock ? (
      <code className={cn("font-mono", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),

  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
