"use strict";
const assert = require("node:assert/strict");
const selected = process.env.AGENTVN_ASSETS_CANDIDATE;
assert([undefined, "1.9.22", "1.9.30", "1.9.35"].includes(selected));
const current1930 = selected === "1.9.30";
const current1935 = selected === "1.9.35";
const current = current1935 || current1930 || selected === "1.9.22";
module.exports = {
  current,
  qaRoot: current1935 ? "F:/AgentVN/QA/Installed-Assets-20261021-01"
    : "F:/AgentVN/QA/Installed-Assets-20261021-01",
  checkpointRoot: current1935 ? "F:/AgentVN/Checkpoints/Installed-Assets-1.9.35-20261101-01"
    : "F:/AgentVN/Checkpoints/Installed-Assets-20261021-01",
  fixtureFile: current ? "D:/AgentVN/output/installed-assets-20261018-01/fixtures.json" : undefined,
  editor: current1935 ? { version: "1.9.35", sha256: "881377138f2bd2832a58b2ebc3da16fd9d250f8d4253f38cf53e936bd8c3dfb1" }
    : current1930 ? { version: "1.9.30", sha256: "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577" }
    : current ? { version: "1.9.22", sha256: "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc" }
    : { version: "1.9.14", sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af" },
  player: { sha256: current1935 ? "fac544554f6bfe3f0b57e16fe5bee8f44d8e60027ceb68d28967fcd457b32df5"
    : current1930 ? "296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa"
    : current ? "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59"
    : "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e", multiframeVideo: current },
  installationFile: current1935 ? "F:/AgentVN/QA/Editor-1.9.35-20261030-01/installation.json"
    : current1930 ? "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
    : current ? "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"
    : "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json",
  protectedSourceFile: current1935 ? "F:/AgentVN/QA/Editor-1.9.35-20261030-01/installation.json"
    : current1930 ? "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
    : current ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json"
    : "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-gallery-current-02/installed-session.json",
};
