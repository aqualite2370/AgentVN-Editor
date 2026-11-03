"use strict";

// Post-measurement CDP document/trace correlation. This runs in Node, never in
// the sampled page. Removed nodes remain unresolved rather than being guessed.
function attributeStyleInvalidations(root, events) {
  if (!root || !Number.isInteger(root.backendNodeId) || typeof root.nodeName !== "string")
    throw new Error("valid CDP document required");
  if (!Array.isArray(events)) throw new Error("trace events array required");
  const owners = new Map();
  function visit(node, context) {
    const attributes = {};
    for (let i = 0; i < (node.attributes || []).length; i += 2)
      attributes[node.attributes[i]] = node.attributes[i + 1];
    const classes = new Set((attributes.class || "").split(/\s+/));
    const next = { ...context };
    if (classes.has("toolbar-popover-morph-ghost")) next.ghost = true;
    if (classes.has("advanced-tab-content")) {
      next.tab = attributes["data-tab"] || "unknown";
      next.region = undefined;
    }
    if (classes.has("runtime-layout-inspector")) next.region = "inspector";
    else if (classes.has("runtime-layout-sidebar")) next.region = "sidebar";
    else if (classes.has("runtime-layout-stage")) next.region = "stage";
    else if (classes.has("runtime-layout-header")) next.region = "header";
    else if (classes.has("flow-surface")) next.region = "canvas";
    else if (classes.has("editor-workspace-body")) next.region = "background";
    const owner = next.ghost ? "presentation/ghost"
      : next.tab ? `${next.tab}/${next.region || "general"}`
        : next.region ? `workspace/${next.region}` : "document/other";
    if (Number.isInteger(node.backendNodeId)) owners.set(node.backendNodeId, owner);
    for (const child of node.children || []) visit(child, next);
    for (const child of node.shadowRoots || []) visit(child, next);
    if (node.contentDocument) visit(node.contentDocument, next);
    if (node.templateContent) visit(node.templateContent, next);
  }
  visit(root, {});
  const groups = new Map();
  let matchedEvents = 0, unresolvedEvents = 0;
  for (const event of events) {
    if (!event.name?.endsWith("InvalidationTracking")) continue;
    const data = event.args?.data;
    const owner = owners.get(data?.nodeId);
    if (!owner) { unresolvedEvents++; continue; }
    matchedEvents++;
    if (!groups.has(owner)) groups.set(owner, { owner, count: 0, nodes: new Set(), reasons: {} });
    const group = groups.get(owner), reason = data.reason || event.name;
    group.count++;
    group.nodes.add(data.nodeId);
    group.reasons[reason] = (group.reasons[reason] || 0) + 1;
  }
  return {
    nodeCount: owners.size,
    totalEvents: matchedEvents + unresolvedEvents, matchedEvents, unresolvedEvents,
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner))
      .map(({ nodes, ...group }) => ({
        owner: group.owner, count: group.count, uniqueNodes: nodes.size, reasons: group.reasons,
      })),
  };
}

module.exports = { attributeStyleInvalidations };
