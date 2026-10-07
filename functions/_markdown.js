// Shared rendering helpers for Pages Functions.

export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The agent writes a small markdown subset: "## " → h2, "### " → h3, other
// non-empty lines → paragraphs. Everything is escaped, so model output can't
// inject markup into a client's site or the review page.
export function markdownToHtml(md) {
  return (md || "")
    .split("\n")
    .map((line) => {
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.trim() === "") return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}
