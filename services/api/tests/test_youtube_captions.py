import httpx
import pytest

from app.services import youtube


def _fake_youtube(monkeypatch, *, mine: list[str], owner: str):
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/captions"):
            return httpx.Response(200, json={"items": [{"id": "trk1", "snippet": {"language": "en", "trackKind": "standard"}}]})
        if path.endswith("/captions/trk1"):
            return httpx.Response(403, json={"error": {"code": 403}})
        if path.endswith("/channels"):
            return httpx.Response(200, json={"items": [{"snippet": {"title": t}} for t in mine]})
        if path.endswith("/videos"):
            return httpx.Response(200, json={"items": [{"snippet": {"channelTitle": owner}}]})
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(youtube.httpx, "get", lambda url, **kw: client.get(url, **kw))


def test_refusal_names_the_owning_and_connected_channels(monkeypatch):
    _fake_youtube(monkeypatch, mine=[], owner="elets Insights")
    with pytest.raises(youtube.CaptionsUnavailable) as e:
        youtube.download_captions_oauth("abc", "token")
    assert str(e.value) == ('captions.download was refused: the connected Google account does not own this video; '
                            'it belongs to the "elets Insights" channel, and the connected account manages no YouTube channel')


def test_refusal_lists_the_channels_the_account_manages(monkeypatch):
    _fake_youtube(monkeypatch, mine=["Personal", "Other Brand"], owner="elets Insights")
    with pytest.raises(youtube.CaptionsUnavailable) as e:
        youtube.download_captions_oauth("abc", "token")
    assert str(e.value).endswith('manages "Personal", "Other Brand"')
