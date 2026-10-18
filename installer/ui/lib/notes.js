const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

export function parseNotes(notes, version) {
  const blocks = [];
  String(notes || "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (i === 0 && line.replace(/[^0-9.]/g, "") === version) return;
    if (line.startsWith("- ") || line.startsWith("* ") || line.startsWith("• ")) {
      blocks.push({ kind: "item", text: line.slice(2).trim() });
      return;
    }
    if (line.length <= 34 && !/[.!?]$/.test(line)) {
      blocks.push({ kind: "head", text: line });
      return;
    }
    blocks.push({ kind: "prose", text: line });
  });
  return blocks;
}
