import asyncio
import server


def test_event_stream_releases_http_connection_and_preserves_reconnect(monkeypatch):
    class Request:
        async def is_disconnected(self):
            return False

    async def no_sleep(_):
        raise AssertionError("Compatibility events must not hold a connection")

    monkeypatch.setattr(server.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(server, "jobs", lambda: [{"id": "example", "state": "running"}])

    async def collect():
        response = await server.events(Request())
        return [part async for part in response.body_iterator]

    parts = asyncio.run(collect())
    assert parts[0] == "retry: 5000\n\n"
    assert '"state": "running"' in parts[1]
    assert len(parts) == 2  # snapshot completes immediately even for a connected tab
