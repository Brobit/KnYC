def test_health(client):
    assert client.get("/health").json() == {"ok": True}


def test_creates_reads_updates_and_deletes_a_note(client):
    created = client.post("/notes", json={"text": "buy milk", "tags": ["Home"]})
    assert created.status_code == 201
    note = created.json()
    assert note["tags"] == ["home"] and note["done"] is False
    assert client.get(f"/notes/{note['id']}").json()["text"] == "buy milk"
    assert client.patch(f"/notes/{note['id']}", json={"done": True}).json()["done"] is True
    assert client.delete(f"/notes/{note['id']}").status_code == 204
    assert client.get(f"/notes/{note['id']}").status_code == 404


def test_filters_and_counts_tags(client):
    client.post("/notes", json={"text": "a", "tags": ["work"]})
    client.post("/notes", json={"text": "b", "tags": ["work", "urgent"]})
    assert [n["text"] for n in client.get("/notes", params={"tag": "urgent"}).json()] == ["b"]
    assert client.get("/notes/tags").json() == {"urgent": 1, "work": 2}


def test_rejects_bad_notes_and_a_full_store(client):
    assert client.post("/notes", json={"text": ""}).status_code == 422
    for i in range(3):
        client.post("/notes", json={"text": f"note {i}"})
    assert client.post("/notes", json={"text": "one too many"}).status_code == 409
