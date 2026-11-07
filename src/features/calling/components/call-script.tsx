"use client";

import * as React from "react";
import Markdown from "react-markdown";
import type { Business } from "@/db/schema";
import { fillScript } from "../script-tokens";

/** The campaign script with tokens filled from the business. Raw HTML in the script is not rendered. */
export function CallScript({ script, business, agent }: { script: string; business: Business; agent: string }) {
  const text = React.useMemo(() => fillScript(script, business, agent), [script, business, agent]);
  if (!script.trim()) {
    return <p className="text-sm text-muted-foreground">This campaign has no script.</p>;
  }
  return (
    <div className="text-sm leading-relaxed [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown skipHtml>{text}</Markdown>
    </div>
  );
}
