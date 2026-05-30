"""
Auth flow tests â€” login, token validation, and /auth/me.
Tests run against the real database with the admin / ricotech_mobile users.
"""


class TestLogin:
    """POST /auth/login"""

    def test_login_success(self, client):
        """Valid credentials should return 200 with an access_token."""
        response = client.post(
            "/auth/login",
            data={"username": "admin", "password": "demo1234"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client):
        """Wrong password should return 401."""
        response = client.post(
            "/auth/login",
            data={"username": "admin", "password": "wrongpassword"},
        )
        assert response.status_code == 401


class TestMe:
    """GET /auth/me"""

    def test_me_with_valid_token(self, client, admin_token, auth_headers):
        """A valid admin token should return the admin user's profile."""
        response = client.get(
            "/auth/me",
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "admin"
        assert data["role"] == "Admin"

    def test_me_without_token(self, client):
        """Accessing /auth/me with no token should return 401."""
        response = client.get("/auth/me")
        assert response.status_code == 401
