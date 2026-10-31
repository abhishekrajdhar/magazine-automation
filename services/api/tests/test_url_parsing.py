import pytest

from app.services.url_parsing import parse_media_url

VID = "dQw4w9WgXcQ"
FID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345"


@pytest.mark.parametrize("url", [
    f"https://www.youtube.com/watch?v={VID}",
    f"https://youtube.com/watch?v={VID}&t=42s&list=PL123",
    f"https://m.youtube.com/watch?feature=share&v={VID}",
    f"https://music.youtube.com/watch?v={VID}",
    f"https://youtu.be/{VID}",
    f"https://youtu.be/{VID}?si=abcDEF123",
    f"https://www.youtube.com/shorts/{VID}",
    f"https://www.youtube.com/live/{VID}?feature=shared",
    f"https://www.youtube.com/embed/{VID}?start=10",
    f"https://www.youtube-nocookie.com/embed/{VID}",
    f"https://www.youtube.com/v/{VID}",
    f"youtube.com/watch?v={VID}",
    f"  https://youtu.be/{VID}  ",
])
def test_youtube_variants(url):
    p = parse_media_url(url)
    assert p.valid, p.error
    assert p.source_type == "youtube"
    assert p.external_id == VID
    assert p.canonical_url == f"https://www.youtube.com/watch?v={VID}"


@pytest.mark.parametrize("url,folder", [
    (f"https://drive.google.com/file/d/{FID}/view?usp=sharing", False),
    (f"https://drive.google.com/file/d/{FID}/edit", False),
    (f"https://drive.google.com/file/d/{FID}", False),
    (f"https://drive.google.com/open?id={FID}", False),
    (f"https://drive.google.com/uc?id={FID}&export=download", False),
    (f"https://drive.google.com/uc?export=download&id={FID}", False),
    (f"https://docs.google.com/uc?id={FID}", False),
    (f"https://drive.google.com/drive/folders/{FID}", True),
    (f"https://drive.google.com/drive/folders/{FID}?usp=sharing", True),
    (f"https://drive.google.com/drive/u/0/folders/{FID}", True),
    (f"https://drive.google.com/drive/u/2/folders/{FID}", True),
])
def test_drive_variants(url, folder):
    p = parse_media_url(url)
    assert p.valid, p.error
    assert p.source_type == "google_drive"
    assert p.external_id == FID
    assert p.is_folder is folder


@pytest.mark.parametrize("url", [
    "",
    "not a url at all",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/playlist?list=PLabc",
    "https://www.youtube.com/@someChannel",
    "https://www.youtube.com/channel/UC123",
    "https://youtu.be/",
    "https://vimeo.com/123456",
    "https://drive.google.com/drive/my-drive",
    "https://drive.google.com/open",
    "https://drive.google.com/file/d/short/view",
    "https://example.com/watch?v=dQw4w9WgXcQ",
])
def test_invalid(url):
    p = parse_media_url(url)
    assert not p.valid
    assert p.error
