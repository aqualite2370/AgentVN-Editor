"use strict";

function validateActiveTaskIndex(markdown) {
  const text = String(markdown).replace(/^\uFEFF/, "");
  const title = text.match(/^# (.+)$/m)?.[1];
  if (!title) throw new Error("Active task index is missing its title.");
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  if (!headings.length) throw new Error("Active task index has no dated entries.");
  if (!/^\d{4}-\d{2}-\d{2}\s/.test(headings[0][1])) {
    throw new Error("Active task index has no dated current entry.");
  }
  const firstStart = headings[0].index + headings[0][0].length;
  const firstEnd = headings[1]?.index ?? text.length;
  const activeBody = text.slice(firstStart, firstEnd);
  const bullets = activeBody.split(/\r?\n/).filter(line => /^- /.test(line));
  const evidenceReferenceCount = (activeBody.match(/`(?:[A-Z]:[\\/]|(?:scripts|plans|docs)[\\/])[^`]+`/g) ?? []).length;
  if (!bullets.length) throw new Error("Current task entry has no actionable record.");
  if (!evidenceReferenceCount) throw new Error("Current task entry has no evidence reference.");
  return {
    title,
    activeHeading: headings[0][1],
    activeBulletCount: bullets.length,
    evidenceReferenceCount,
  };
}

module.exports = { validateActiveTaskIndex };
