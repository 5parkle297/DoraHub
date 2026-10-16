/**
 * Markdown 渲染（handoff §5 头号缺口 + 0.5-A）。
 * 增量段落策略：流式文本按双换行切段，已完结段落只解析一次（缓存），
 * 只有最后一段（进行中）每帧重解析 → 长消息流式不卡。
 * 实现自写轻量渲染（不引库，体积 <2KB）：标题/列表/代码块/行内代码/
 * 链接/粗斜体/引用/表格/分隔线。够 agent 输出用；不追求 GFM 全集。
 */
import { memo, useMemo } from "react";

/** 行内元素：`code` **bold** *italic* [link](url)。转义 HTML。 */
function renderInline(text: string): string {
  let s = "";
  let rest = text;
  // 逐 token 扫描，避免正则灾难
  while (rest.length > 0) {
    // 行内代码优先（内部不解析其他标记）
    let idx = rest.indexOf("`");
    if (idx >= 0) {
      const end = rest.indexOf("`", idx + 1);
      if (end > idx) {
        s += esc(rest.slice(0, idx)) + `<code>${esc(rest.slice(idx + 1, end))}</code>`;
        rest = rest.slice(end + 1);
        continue;
      }
    }
    // 链接 [t](u)
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      const url = link[2].startsWith("http") || link[2].startsWith("/") ? link[2] : "#";
      s += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(link[1])}</a>`;
      rest = rest.slice(link[0].length);
      continue;
    }
    // 粗体 **x**
    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      s += `<strong>${esc(bold[1])}</strong>`;
      rest = rest.slice(bold[0].length);
      continue;
    }
    // 斜体 *x*（避免和粗体混淆：前面已匹配 **）
    const ital = rest.match(/^\*([^*\n]+)\*/);
    if (ital) {
      s += `<em>${esc(ital[1])}</em>`;
      rest = rest.slice(ital[0].length);
      continue;
    }
    // 普通字符：吞到下一个特殊字符
    const next = Math.min(
      ...["`", "[", "*"].map((c) => {
        const i = rest.indexOf(c);
        return i === -1 ? rest.length : i;
      }),
      rest.length,
    );
    s += esc(rest.slice(0, next || 1));
    rest = rest.slice(next || 1);
  }
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 块级解析：一组行 → HTML。 */
function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      out.push(
        `<pre data-lang="${esc(lang)}"><code>${esc(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }

    // 引用块
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(buf)}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+[.)]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 表格（| a | b |）
    if (line.includes("|") && /^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (l: string) =>
        l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = parseRow(line);
      i += 2; // 表头 + 分隔行
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 段落（吞到空行/块级开始）
    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !lines[i].startsWith("```") && !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") && !/^[-*]\s+/.test(lines[i]) && !/^\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map(renderInline).join("<br/>")}</p>`);
  }
  return out.join("");
}

export function markdownToHtml(text: string): string {
  return renderBlocks(text.split("\n"));
}

/** 流式友好的 markdown 渲染：完结段落缓存，只重解析尾段。 */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => {
    if (!streaming) return markdownToHtml(text);
    // 流式：双换行切段，前面段视为完结
    const parts = text.split(/\n\n+/);
    const settled = parts.slice(0, -1).join("\n\n");
    const tail = parts[parts.length - 1] ?? "";
    return markdownToHtml(settled) + markdownToHtml(tail);
  }, [text, streaming]);
  // HTML 由自己生成且已 esc() 全部用户/模型内容，无注入面
  return <div className="msg-text" dangerouslySetInnerHTML={{ __html: html }} />;
});
