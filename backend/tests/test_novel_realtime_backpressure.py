"""Slow display consumers must receive the same ordered text as the model."""
import asyncio

from app.services.novel_realtime import NovelRealtimeJob


def event(seq, text):
    return {"seq": seq, "type": "message_delta", "payload": {"delta": text}}


def test_slow_queue_preserves_json_order():
    queue = asyncio.Queue(maxsize=3)
    for i, text in enumerate(['{"chapters":', '[{"start_offset":0,', '"end_offset":100}'], 1):
        queue.put_nowait(event(i, text))
    NovelRealtimeJob._coalesce_slow_queue(queue, event(4, "]}"))
    assert queue.qsize() == 1
    result = queue.get_nowait()
    assert result["seq"] == 4
    assert result["payload"]["delta"] == '{"chapters":[{"start_offset":0,"end_offset":100}]}'


def test_repeated_backpressure_does_not_reverse_previous_merged_text():
    queue = asyncio.Queue(maxsize=2)
    queue.put_nowait(event(1, "一"))
    queue.put_nowait(event(2, "二"))
    NovelRealtimeJob._coalesce_slow_queue(queue, event(3, "三"))
    queue.put_nowait(event(4, "四"))
    NovelRealtimeJob._coalesce_slow_queue(queue, event(5, "五"))
    assert queue.get_nowait()["payload"]["delta"] == "一二三四五"
