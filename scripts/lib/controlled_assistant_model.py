"""Standalone, local-only HTTP model fixtures for installed acceptance.

Extracted from backend/tests/test_assistant_creation_{transport,agent}.py in
the retained D:/AgentVN checkout. No product imports, keys or paid requests.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread


@contextmanager
def _endpoint(respond, requests):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            message = respond(payload)
            body = json.dumps({
                "id": "controlled-completion", "object": "chat.completion",
                "created": 1, "model": "controlled-model",
                "choices": [{
                    "index": 0,
                    "finish_reason": "tool_calls" if message.get("tool_calls") else "stop",
                    "message": message,
                }],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive(), "Controlled HTTP model must stop"


@contextmanager
def model_endpoint(proposal):
    requests = []

    def respond(payload):
        requests.append({"path": "/v1/chat/completions", "body": payload})
        return {"role": "assistant", "content": None, "tool_calls": [{
            "id": "controlled-call", "type": "function",
            "function": {
                "name": "submit_assistant_component_draft",
                "arguments": json.dumps(proposal, ensure_ascii=False),
            },
        }]}

    with _endpoint(respond, requests) as endpoint:
        yield endpoint


@contextmanager
def agent_endpoint(sequence_override=None, *, batch_size=1):
    assert isinstance(batch_size, int) and 1 <= batch_size <= 12
    calls = []
    draft = {"components": [{
        "name": "工具循环组件",
        "html": '<div class="root"><span>构建结果</span></div>',
    }]}
    sequence = sequence_override or [
        ("read_assistant_context", {}), ("build_assistant_draft", draft),
        ("read_assistant_draft", {}), ("submit_assistant_component_draft", draft),
    ]

    def respond(payload):
        calls.append(payload)
        step = sum(message.get("role") == "tool" for message in payload.get("messages", []))
        batch = sequence[step:step + batch_size] or [sequence[-1]]
        if payload.get("tool_choice") == "auto":
            return {"role": "assistant", "content": "我可以提供创作建议。"}
        return {"role": "assistant", "content": None, "tool_calls": [{
            "id": f"call-{len(calls)}-{index}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
        } for index, (name, arguments) in enumerate(batch)]}

    with _endpoint(respond, calls) as endpoint:
        yield endpoint
