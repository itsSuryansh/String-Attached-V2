from backend.sessions import SessionStore


def test_create_and_validate():
    store = SessionStore()
    session = store.create(ttl_seconds=60)
    assert store.validate(session.token) is True


def test_invalid_token():
    store = SessionStore()
    assert store.validate("not-a-real-token") is False


def test_expired_token():
    store = SessionStore()
    session = store.create(ttl_seconds=0)
    assert store.validate(session.token) is False
