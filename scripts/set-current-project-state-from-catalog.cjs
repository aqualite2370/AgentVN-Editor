const projectIdArg = process.argv[2];

async function main() {
  const catalogResponse = await fetch("http://127.0.0.1:8278/api/project/catalog");
  if (!catalogResponse.ok) throw new Error(`catalog failed: ${catalogResponse.status}`);
  const catalog = (await catalogResponse.json()).data;
  const target = projectIdArg
    ? catalog.find((item) => item.project_id === projectIdArg)
    : [...catalog].sort((a, b) => (b.node_count ?? 0) - (a.node_count ?? 0))[0];
  if (!target) throw new Error(`project not found: ${projectIdArg}`);

  const detailResponse = await fetch(`http://127.0.0.1:8278/api/project/projects/${encodeURIComponent(target.project_id)}`);
  if (!detailResponse.ok) throw new Error(`detail failed: ${detailResponse.status}`);
  const project = (await detailResponse.json()).data;

  const payload = {
    project_graph: {
      nodes: project.nodes ?? [],
      edges: project.edges ?? [],
      viewport: project.viewport ?? { x: 0, y: 0, zoom: 1 },
      memoryMode: project.memory_mode ?? "hybrid",
    },
    project_metadata: {
      projectId: project.project_id,
      title: project.title,
      author: project.author,
      createdAt: project.created_at,
      updatedAt: new Date().toISOString(),
      assetManifest: project.asset_manifest ?? [],
      settings: project.editor_settings ?? {},
    },
  };

  const saveResponse = await fetch("http://127.0.0.1:8278/api/project/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!saveResponse.ok) throw new Error(`state save failed: ${saveResponse.status} ${await saveResponse.text()}`);
  console.log(JSON.stringify({
    ok: true,
    projectId: project.project_id,
    title: project.title,
    nodeCount: payload.project_graph.nodes.length,
    edgeCount: payload.project_graph.edges.length,
    assetCount: payload.project_metadata.assetManifest.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
